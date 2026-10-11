-- 0004_jobs_dispatch.sql
--
-- BeyondX admin console, Phase 4 (job board, dispatch, replacement, change orders,
-- recurring services). ADDITIVE ONLY: new tables, new functions, new grants and config.
-- The only existing object touched is public.payment (made in 0003), which gets two
-- new nullable columns. Run once after 0003.
--
-- Ids that point at existing records (xpert_id) are plain text with no foreign key,
-- for the same reason as in 0002a and 0003.

begin;

alter table public.payment
  add column released_at timestamptz,
  add column release_note text;

-- Jobs: created automatically when a payment is recorded as received. -------------------
create table public.job (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null unique references public.job_request (id),
  payment_id            uuid not null unique references public.payment (id),
  recurring_id          uuid,
  category              text not null,
  location              text not null,
  timing                text not null,
  amount_ghs            numeric(12,2) not null check (amount_ghs > 0),
  status                text not null default 'awaiting_dispatch'
                        check (status in ('awaiting_dispatch', 'dispatched', 'in_progress', 'completed', 'cancelled')),
  xpert_id              text,
  dispatched_at         timestamptz,
  started_at            timestamptz,
  employer_confirmed_at timestamptz,
  xpert_confirmed_at    timestamptz,
  completed_at          timestamptz,
  cancelled_reason      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id),
  change_reason         text,
  check (status not in ('dispatched', 'in_progress', 'completed') or xpert_id is not null)
);
create index job_status_idx on public.job (status, created_at desc);
create index job_xpert_idx on public.job (xpert_id) where xpert_id is not null;

-- Assignments: every Xpert who held a job, so replacement history is never lost. ---------
create table public.assignment (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.job (id),
  xpert_id      text not null,
  status        text not null default 'active' check (status in ('active', 'replaced', 'completed', 'withdrawn')),
  assigned_by   uuid references auth.users (id),
  assigned_at   timestamptz not null default now(),
  ended_at      timestamptz,
  end_reason    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text
);
create unique index assignment_one_active_per_job on public.assignment (job_id) where status = 'active';
create index assignment_xpert_idx on public.assignment (xpert_id, status);

-- Change orders: scope changes logged against a job. Both sides must confirm. -----------
create table public.change_order (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references public.job (id),
  description           text not null,
  amount_delta_ghs      numeric(12,2) not null default 0,
  status                text not null default 'logged' check (status in ('logged', 'confirmed', 'rejected', 'cancelled')),
  employer_confirmed_at timestamptz,
  xpert_confirmed_at    timestamptz,
  rejected_by           text check (rejected_by in ('employer', 'xpert')),
  logged_by             uuid references auth.users (id),
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id),
  change_reason         text
);
create index change_order_job_idx on public.change_order (job_id);

-- Recurring services: an employer's standing request that generates new requests. -------
create table public.recurring_service (
  id                 uuid primary key default gen_random_uuid(),
  employer_id        text,
  employer_name      text not null,
  employer_phone     text not null,
  category           text not null,
  description        text not null,
  location           text not null,
  timing             text not null,
  frequency          text not null check (frequency in ('weekly', 'fortnightly', 'monthly')),
  next_due           date not null,
  active             boolean not null default true,
  last_generated_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id),
  change_reason      text
);
alter table public.job add constraint job_recurring_fk foreign key (recurring_id) references public.recurring_service (id);
alter table public.job_request add column recurring_id uuid references public.recurring_service (id);

-- A job exists as soon as a payment is received. Safe to repeat: one job per request. ---
create or replace function public.job_from_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.job_request%rowtype;
begin
  if new.status = 'received' and (tg_op = 'INSERT' or old.status is distinct from 'received') then
    select * into r from public.job_request where id = new.request_id;
    insert into public.job (request_id, payment_id, recurring_id, category, location, timing, amount_ghs, updated_by, change_reason)
    values (r.id, new.id, r.recurring_id, r.category, r.location, r.timing, new.amount_ghs, new.updated_by, 'Created when the payment was received')
    on conflict (request_id) do nothing;
  end if;
  return new;
end $$;
create trigger payment_creates_job after insert or update of status on public.payment for each row execute function public.job_from_payment();

-- Dispatch ---------------------------------------------------------------------------------------
create or replace function public.job_dispatch(p_job_id uuid, p_xpert_id text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status <> 'awaiting_dispatch' then raise exception 'This job is now %. Reload and try again.', j.status using errcode = '40001'; end if;
  insert into public.assignment (job_id, xpert_id, assigned_by, updated_by, change_reason) values (j.id, p_xpert_id, p_actor, p_actor, 'Dispatched');
  update public.job set status = 'dispatched', xpert_id = p_xpert_id, dispatched_at = now(), updated_by = p_actor, change_reason = 'Dispatched' where id = j.id;
  return jsonb_build_object('job', j.id);
end $$;

create or replace function public.job_start(p_job_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status <> 'dispatched' then raise exception 'This job is now %. Reload and try again.', j.status using errcode = '40001'; end if;
  update public.job set status = 'in_progress', started_at = now(), updated_by = p_actor, change_reason = 'Work started' where id = j.id;
  return jsonb_build_object('job', j.id);
end $$;

-- Replacing an Xpert: the old assignment is closed with the reason, a new one opens. -------------
create or replace function public.job_replace(p_job_id uuid, p_new_xpert text, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status not in ('dispatched', 'in_progress') then raise exception 'A % job has no Xpert to replace.', j.status using errcode = '40001'; end if;
  if j.xpert_id = p_new_xpert then raise exception 'That Xpert is already on the job.' using errcode = '40001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required.'; end if;
  update public.assignment set status = 'replaced', ended_at = now(), end_reason = p_reason, updated_by = p_actor, change_reason = 'Replaced: ' || p_reason
   where job_id = j.id and status = 'active';
  insert into public.assignment (job_id, xpert_id, assigned_by, updated_by, change_reason) values (j.id, p_new_xpert, p_actor, p_actor, 'Replacement: ' || p_reason);
  -- Confirmations belong to the work, not the person, but the old Xpert's confirmation does not carry over.
  update public.job set xpert_id = p_new_xpert, xpert_confirmed_at = null, updated_by = p_actor, change_reason = 'Xpert replaced: ' || p_reason where id = j.id;
  return jsonb_build_object('job', j.id, 'replaced', j.xpert_id);
end $$;

-- Confirming completion. The job completes, and the payment is marked released, only when
-- BOTH the employer and the Xpert have confirmed. The console records state; the MoMo payout is made by finance. --
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
    update public.assignment set status = 'completed', ended_at = now(), updated_by = p_actor, change_reason = 'Job completed' where job_id = j.id and status = 'active';
    update public.payment set status = 'released', released_at = now(), updated_by = p_actor, change_reason = 'Both sides confirmed the job' where id = j.payment_id and status = 'received';
  end if;
  return jsonb_build_object('job', j.id, 'completed', done);
end $$;

create or replace function public.job_cancel(p_job_id uuid, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.job%rowtype;
begin
  select * into j from public.job where id = p_job_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if j.status in ('completed', 'cancelled') then raise exception 'This job is already %.', j.status using errcode = '40001'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'A reason is required.'; end if;
  update public.assignment set status = 'withdrawn', ended_at = now(), end_reason = p_reason, updated_by = p_actor, change_reason = 'Job cancelled' where job_id = j.id and status = 'active';
  -- The payment is left as received. Whether it is refunded is a decision for finance (rules still open).
  update public.job set status = 'cancelled', cancelled_reason = p_reason, updated_by = p_actor, change_reason = 'Cancelled: ' || p_reason where id = j.id;
  return jsonb_build_object('job', j.id);
end $$;

-- Change orders: logging, confirming from each side, rejecting. -------------------------------------
create or replace function public.change_order_confirm(p_id uuid, p_side text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.change_order%rowtype; js text;
begin
  if p_side not in ('employer', 'xpert') then raise exception 'Bad side'; end if;
  select * into c from public.change_order where id = p_id for update;
  if not found then raise exception 'Change order not found' using errcode = 'P0002'; end if;
  if c.status <> 'logged' then raise exception 'This change order is now %.', c.status using errcode = '40001'; end if;
  if p_side = 'employer' then c.employer_confirmed_at := coalesce(c.employer_confirmed_at, now()); else c.xpert_confirmed_at := coalesce(c.xpert_confirmed_at, now()); end if;
  update public.change_order set employer_confirmed_at = c.employer_confirmed_at, xpert_confirmed_at = c.xpert_confirmed_at,
         status = case when c.employer_confirmed_at is not null and c.xpert_confirmed_at is not null then 'confirmed' else 'logged' end,
         updated_by = p_actor, change_reason = initcap(p_side) || ' confirmed' where id = c.id;
  return jsonb_build_object('change_order', c.id);
end $$;

create or replace function public.change_order_reject(p_id uuid, p_side text, p_note text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.change_order%rowtype;
begin
  if p_side not in ('employer', 'xpert') then raise exception 'Bad side'; end if;
  select * into c from public.change_order where id = p_id for update;
  if not found then raise exception 'Change order not found' using errcode = 'P0002'; end if;
  if c.status <> 'logged' then raise exception 'This change order is now %.', c.status using errcode = '40001'; end if;
  update public.change_order set status = 'rejected', rejected_by = p_side, note = p_note, updated_by = p_actor, change_reason = 'Rejected by ' || p_side where id = c.id;
  return jsonb_build_object('change_order', c.id);
end $$;

-- Recurring: generate the next request and move the due date forward. Repeats are harmless
-- because the due date moves, so a second call the same day finds nothing due. -------------------
create or replace function public.recurring_generate(p_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.recurring_service%rowtype; new_id uuid; step interval;
begin
  select * into s from public.recurring_service where id = p_id for update;
  if not found then raise exception 'Recurring service not found' using errcode = 'P0002'; end if;
  if not s.active then raise exception 'This recurring service is paused.' using errcode = '40001'; end if;
  if s.next_due > current_date then raise exception 'Nothing is due yet.' using errcode = '40001'; end if;
  step := case s.frequency when 'weekly' then interval '7 days' when 'fortnightly' then interval '14 days' else interval '1 month' end;
  insert into public.job_request (employer_id, employer_name, employer_phone, category, description, location, timing, recurring_id, updated_by, change_reason)
  values (s.employer_id, s.employer_name, s.employer_phone, s.category, s.description, s.location, s.timing, s.id, p_actor, 'Generated from a recurring service')
  returning id into new_id;
  update public.recurring_service set next_due = (s.next_due + step)::date, last_generated_at = now(), updated_by = p_actor, change_reason = 'Request generated' where id = s.id;
  return jsonb_build_object('request', new_id);
end $$;

revoke execute on function public.job_from_payment(), public.job_dispatch(uuid, text, uuid), public.job_start(uuid, uuid),
  public.job_replace(uuid, text, text, uuid), public.job_confirm(uuid, text, uuid), public.job_cancel(uuid, text, uuid),
  public.change_order_confirm(uuid, text, uuid), public.change_order_reject(uuid, text, text, uuid),
  public.recurring_generate(uuid, uuid) from public, anon, authenticated;

-- Settings that are not decided yet are stored as pending, with a working value. ---------------------
insert into public.console_config (key, value, pending, note) values
  ('jobs.startOverdueHours',     '24'::jsonb, true, 'Pending: hours after dispatch before a job that has not started is flagged on the monitor.'),
  ('jobs.confirmationOverdueHours', '48'::jsonb, true, 'Pending: hours one side may wait for the other to confirm completion before the job is flagged.')
on conflict (key) do nothing;

-- Permissions: monitoring is visible to every dashboard role; dispatching stays with ops. --------------
insert into public.role_permission (role, permission) values
  ('decision_maker',   'jobs.monitor'),
  ('finance_approver', 'jobs.monitor'),
  ('decision_maker',   'dispatch.match')
on conflict (role, permission) do nothing;

-- Standard conventions --------------------------------------------------------------------------------
create trigger job_touch               before update on public.job               for each row execute function public.touch_updated_at();
create trigger assignment_touch        before update on public.assignment        for each row execute function public.touch_updated_at();
create trigger change_order_touch      before update on public.change_order      for each row execute function public.touch_updated_at();
create trigger recurring_service_touch before update on public.recurring_service for each row execute function public.touch_updated_at();

create trigger job_audit               after insert or update on public.job               for each row execute function public.audit_row_change('id');
create trigger assignment_audit        after insert or update on public.assignment        for each row execute function public.audit_row_change('id');
create trigger change_order_audit      after insert or update on public.change_order      for each row execute function public.audit_row_change('id');
create trigger recurring_service_audit after insert or update on public.recurring_service for each row execute function public.audit_row_change('id');

create trigger job_no_delete               before delete on public.job               for each row execute function public.block_hard_delete();
create trigger assignment_no_delete        before delete on public.assignment        for each row execute function public.block_hard_delete();
create trigger change_order_no_delete      before delete on public.change_order      for each row execute function public.block_hard_delete();
create trigger recurring_service_no_delete before delete on public.recurring_service for each row execute function public.block_hard_delete();

alter table public.job               enable row level security;
alter table public.assignment        enable row level security;
alter table public.change_order      enable row level security;
alter table public.recurring_service enable row level security;

create policy job_read               on public.job               for select to authenticated using (public.has_permission('jobs.monitor') or public.has_permission('dispatch.match'));
create policy assignment_read        on public.assignment        for select to authenticated using (public.has_permission('jobs.monitor') or public.has_permission('dispatch.match'));
create policy change_order_read      on public.change_order      for select to authenticated using (public.has_permission('changeorders.manage') or public.has_permission('jobs.monitor'));
create policy recurring_service_read on public.recurring_service for select to authenticated using (public.has_permission('quotes.read'));

revoke all on public.job, public.assignment, public.change_order, public.recurring_service from anon, authenticated;
grant select on public.job, public.assignment, public.change_order, public.recurring_service to authenticated;

commit;
