-- 0008_primary_backup.sql
-- NOT APPLIED. Run after 0007.
--
-- Decision: every job has a primary Xpert and a backup Xpert.
--  * A job cannot be dispatched without both. The rule is in the database, not only in the screen.
--  * The two must be different Xperts, and one Xpert cannot hold both places on a job.
--  * Promote backup: the backup becomes the primary, the old primary is kept in the history as replaced.
--  * No show: marking the primary as a no show promotes the backup in the same transaction. With no
--    backup, the job goes back to Needs an Xpert. The database reports how many no shows the Xpert has
--    inside the window. The API moves an Xpert to Under Review when the limit is reached
--    (the status lives in the hetzner database, so that move cannot be in this transaction).
--
-- Nothing is deleted. Old assignments become primary assignments. The old three argument job_dispatch
-- is dropped on purpose, so no caller can dispatch a job without a backup.
-- Existing live jobs with no backup are not broken: they show as Backup needed and ops adds one.

begin;

alter table public.assignment add column role text not null default 'primary' check (role in ('primary', 'backup'));

alter table public.assignment drop constraint assignment_status_check;
alter table public.assignment add constraint assignment_status_check
  check (status in ('active', 'replaced', 'completed', 'withdrawn', 'no_show'));

drop index public.assignment_one_active_per_job;
create unique index assignment_one_active_per_role on public.assignment (job_id, role) where status = 'active';
create unique index assignment_xpert_once_per_job on public.assignment (job_id, xpert_id) where status = 'active';
create index assignment_no_show_idx on public.assignment (xpert_id, ended_at) where status = 'no_show';

alter table public.job add column backup_xpert_id text;
alter table public.job add constraint job_backup_differs check (backup_xpert_id is null or backup_xpert_id <> xpert_id);

-- Dispatch now needs both. -----------------------------------------------------------------------------
drop function public.job_dispatch(uuid, text, uuid);
create function public.job_dispatch(p_job_id uuid, p_xpert_id text, p_backup_xpert_id text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  if coalesce(trim(p_backup_xpert_id), '') = '' then raise exception 'Every job needs a backup Xpert as well as a primary Xpert.'; end if;
  if p_xpert_id = p_backup_xpert_id then raise exception 'The primary and the backup must be different Xperts.'; end if;
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status <> 'awaiting_dispatch' then raise exception 'This job is now %. Reload and try again.', j.status using errcode = '40001'; end if;
  insert into public.assignment (job_id, xpert_id, role, assigned_by, updated_by, change_reason)
  values (j.id, p_xpert_id, 'primary', p_actor, p_actor, 'Dispatched as primary'),
         (j.id, p_backup_xpert_id, 'backup', p_actor, p_actor, 'Dispatched as backup');
  update public.job set status = 'dispatched', xpert_id = p_xpert_id, backup_xpert_id = p_backup_xpert_id, dispatched_at = now(), updated_by = p_actor, change_reason = 'Dispatched' where id = j.id;
  return jsonb_build_object('job', j.id);
end $$;

-- Adding or changing the backup on a live job. A reason is needed only when one is being replaced. ---
create function public.job_set_backup(p_job_id uuid, p_backup_xpert_id text, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status not in ('dispatched', 'in_progress') then raise exception 'A % job cannot take a backup.', j.status using errcode = '40001'; end if;
  if p_backup_xpert_id = j.xpert_id then raise exception 'The backup must be a different Xpert from the primary.' using errcode = '40001'; end if;
  if p_backup_xpert_id is not distinct from j.backup_xpert_id then raise exception 'That Xpert is already the backup.' using errcode = '40001'; end if;
  if j.backup_xpert_id is not null then
    if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required to change the backup.'; end if;
    update public.assignment set status = 'replaced', ended_at = now(), end_reason = p_reason, updated_by = p_actor, change_reason = 'Backup changed: ' || p_reason
     where job_id = j.id and role = 'backup' and status = 'active';
  end if;
  insert into public.assignment (job_id, xpert_id, role, assigned_by, updated_by, change_reason)
  values (j.id, p_backup_xpert_id, 'backup', p_actor, p_actor, case when j.backup_xpert_id is null then 'Backup added' else 'Backup changed: ' || p_reason end);
  update public.job set backup_xpert_id = p_backup_xpert_id, updated_by = p_actor, change_reason = 'Backup set' where id = j.id;
  return jsonb_build_object('job', j.id);
end $$;

-- Replacing the primary now leaves the backup alone, and the new primary cannot be the backup. -------
create or replace function public.job_replace(p_job_id uuid, p_new_xpert text, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status not in ('dispatched', 'in_progress') then raise exception 'A % job has no Xpert to replace.', j.status using errcode = '40001'; end if;
  if j.xpert_id = p_new_xpert then raise exception 'That Xpert is already on the job.' using errcode = '40001'; end if;
  if j.backup_xpert_id = p_new_xpert then raise exception 'That Xpert is the backup. Use Promote backup instead.' using errcode = '40001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required.'; end if;
  update public.assignment set status = 'replaced', ended_at = now(), end_reason = p_reason, updated_by = p_actor, change_reason = 'Replaced: ' || p_reason
   where job_id = j.id and role = 'primary' and status = 'active';
  insert into public.assignment (job_id, xpert_id, role, assigned_by, updated_by, change_reason) values (j.id, p_new_xpert, 'primary', p_actor, p_actor, 'Replacement: ' || p_reason);
  update public.job set xpert_id = p_new_xpert, xpert_confirmed_at = null, updated_by = p_actor, change_reason = 'Xpert replaced: ' || p_reason where id = j.id;
  return jsonb_build_object('job', j.id, 'replaced', j.xpert_id);
end $$;

-- Promote backup. ------------------------------------------------------------------------------------
create function public.job_promote_backup(p_job_id uuid, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status not in ('dispatched', 'in_progress') then raise exception 'A % job has no primary Xpert to replace.', j.status using errcode = '40001'; end if;
  if j.backup_xpert_id is null then raise exception 'This job has no backup to promote.' using errcode = '40001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required.'; end if;
  update public.assignment set status = 'replaced', ended_at = now(), end_reason = p_reason, updated_by = p_actor, change_reason = 'Replaced by the backup: ' || p_reason
   where job_id = j.id and role = 'primary' and status = 'active';
  update public.assignment set role = 'primary', updated_by = p_actor, change_reason = 'Backup promoted: ' || p_reason
   where job_id = j.id and role = 'backup' and status = 'active';
  update public.job set xpert_id = j.backup_xpert_id, backup_xpert_id = null, xpert_confirmed_at = null, updated_by = p_actor, change_reason = 'Backup promoted: ' || p_reason where id = j.id;
  return jsonb_build_object('job', j.id, 'promoted', j.backup_xpert_id, 'replaced', j.xpert_id);
end $$;

-- No show. The primary did not turn up. -----------------------------------------------------------------
create function public.job_no_show(p_job_id uuid, p_note text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.job%rowtype;
  window_days int := coalesce((select (value #>> '{}')::int from public.console_config where key = 'jobs.noShowWindowDays'), 42);
  lim int := coalesce((select (value #>> '{}')::int from public.console_config where key = 'jobs.noShowLimit'), 2);
  n int;
  promoted text;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status not in ('dispatched', 'in_progress') then raise exception 'A % job has no primary Xpert.', j.status using errcode = '40001'; end if;
  update public.assignment set status = 'no_show', ended_at = now(), end_reason = coalesce(nullif(trim(p_note), ''), 'Did not turn up'), updated_by = p_actor, change_reason = 'No show'
   where job_id = j.id and role = 'primary' and status = 'active';
  if j.backup_xpert_id is not null then
    update public.assignment set role = 'primary', updated_by = p_actor, change_reason = 'Backup promoted after a no show'
     where job_id = j.id and role = 'backup' and status = 'active';
    update public.job set xpert_id = j.backup_xpert_id, backup_xpert_id = null, xpert_confirmed_at = null, updated_by = p_actor, change_reason = 'Backup promoted after a no show' where id = j.id;
    promoted := j.backup_xpert_id;
  else
    update public.job set status = 'awaiting_dispatch', xpert_id = null, dispatched_at = null, started_at = null,
           employer_confirmed_at = null, xpert_confirmed_at = null, updated_by = p_actor, change_reason = 'No show and no backup' where id = j.id;
  end if;
  select count(*) into n from public.assignment
   where xpert_id = j.xpert_id and status = 'no_show' and ended_at >= now() - make_interval(days => window_days);
  return jsonb_build_object('job', j.id, 'noShowXpert', j.xpert_id, 'promoted', promoted, 'noShowsInWindow', n, 'limit', lim, 'windowDays', window_days);
end $$;

-- Completing a job: the primary is completed. A backup that was never needed is withdrawn. ---------------
create or replace function public.job_confirm(p_job_id uuid, p_side text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype; done boolean;
begin
  if p_side not in ('employer', 'xpert') then raise exception 'Bad side'; end if;
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status <> 'in_progress' then raise exception 'This job is now %. Only a job in progress can be confirmed.', j.status using errcode = '40001'; end if;
  if p_side = 'employer' then
    update public.job set employer_confirmed_at = coalesce(employer_confirmed_at, now()), updated_by = p_actor, change_reason = 'Employer confirmed' where id = j.id returning * into j;
  else
    update public.job set xpert_confirmed_at = coalesce(xpert_confirmed_at, now()), updated_by = p_actor, change_reason = 'Xpert confirmed' where id = j.id returning * into j;
  end if;
  done := j.employer_confirmed_at is not null and j.xpert_confirmed_at is not null;
  if done then
    update public.job set status = 'completed', completed_at = now(), updated_by = p_actor, change_reason = 'Both sides confirmed' where id = j.id;
    update public.assignment set status = 'completed', ended_at = now(), updated_by = p_actor, change_reason = 'Job completed' where job_id = j.id and status = 'active' and role = 'primary';
    update public.assignment set status = 'withdrawn', ended_at = now(), end_reason = 'Job completed, the backup was not needed', updated_by = p_actor, change_reason = 'Job completed' where job_id = j.id and status = 'active' and role = 'backup';
    update public.payment set status = 'released', released_at = now(), updated_by = p_actor, change_reason = 'Both sides confirmed the job' where id = j.payment_id and status = 'received';
  end if;
  return jsonb_build_object('job', j.id, 'completed', done);
end $$;

revoke execute on function public.job_dispatch(uuid, text, text, uuid), public.job_set_backup(uuid, text, text, uuid),
  public.job_promote_backup(uuid, text, uuid), public.job_no_show(uuid, text, uuid), public.job_replace(uuid, text, text, uuid),
  public.job_confirm(uuid, text, uuid) from public, anon, authenticated;

-- Settings, marked Pending, with working values. -----------------------------------------------------------------
insert into public.console_config (key, value, pending, note) values
  ('jobs.noShowWindowDays', '42'::jsonb, true, 'Pending: how many days a no show counts towards the limit (42 is six weeks).'),
  ('jobs.noShowLimit',      '2'::jsonb,  true, 'Pending: how many no shows inside the window send an Xpert to Under Review.')
on conflict (key) do nothing;

-- Permission: promote a backup and mark no shows. Same roles as dispatch. ---------------------------------------
insert into public.role_permission (role, permission) values
  ('ops_reviewer',   'dispatch.promote'),
  ('decision_maker', 'dispatch.promote'),
  ('super_admin',    'dispatch.promote')
on conflict (role, permission) do nothing;

commit;
