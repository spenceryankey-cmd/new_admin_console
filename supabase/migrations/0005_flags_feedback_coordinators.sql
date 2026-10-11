-- 0005_flags_feedback_coordinators.sql
--
-- BeyondX admin console, Phase 5 (flags and counter flags, feedback, the reliability
-- record, coordinators). ADDITIVE ONLY: new tables, one view, new functions and grants.
-- The only earlier objects touched are public.job_request and public.job (made in 0003
-- and 0004), which each get one new nullable column. Run once after 0004.
--
-- Ids that point at existing records (xpert_id) are plain text with no foreign key.

begin;

-- Coordinators and their rosters -----------------------------------------------------------
create table public.coordinator (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text,
  area          text,
  active        boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text
);

-- Which Xperts a coordinator vouches for. One current coordinator per Xpert; the history stays. --
create table public.coordinator_xpert (
  id             uuid primary key default gen_random_uuid(),
  coordinator_id uuid not null references public.coordinator (id),
  xpert_id       text not null,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  change_reason  text
);
create unique index coordinator_xpert_one_current on public.coordinator_xpert (xpert_id) where active;

alter table public.job_request add column coordinator_id uuid references public.coordinator (id);
alter table public.job         add column coordinator_id uuid references public.coordinator (id);

-- A job inherits the coordinator of its request. Rebuilds the trigger function from 0004 so new
-- jobs carry it; existing rows are untouched.
create or replace function public.job_from_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.job_request%rowtype;
begin
  if new.status = 'received' and (tg_op = 'INSERT' or old.status is distinct from 'received') then
    select * into r from public.job_request where id = new.request_id;
    insert into public.job (request_id, payment_id, recurring_id, coordinator_id, category, location, timing, amount_ghs, updated_by, change_reason)
    values (r.id, new.id, r.recurring_id, r.coordinator_id, r.category, r.location, r.timing, new.amount_ghs, new.updated_by, 'Created when the payment was received')
    on conflict (request_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.job_from_payment() from public, anon, authenticated;

-- Flags and counter flags --------------------------------------------------------------------
-- A flag is a concern about an Xpert. A counter flag is the other side's account, attached to a
-- flag. Decision makers decide the flag; deciding it closes the counter flags attached to it.
create table public.flag (
  id             uuid primary key default gen_random_uuid(),
  xpert_id       text not null,
  job_id         uuid references public.job (id),
  kind           text not null default 'flag' check (kind in ('flag', 'counter_flag')),
  parent_flag_id uuid references public.flag (id),
  raised_by_type text not null check (raised_by_type in ('employer', 'xpert', 'staff', 'system')),
  raised_by      uuid references auth.users (id),
  category       text not null check (category in ('no_show', 'conduct', 'quality', 'safety', 'pricing', 'other')),
  detail         text not null check (length(trim(detail)) >= 5),
  status         text not null default 'open' check (status in ('open', 'investigating', 'upheld', 'dismissed', 'reviewed')),
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  change_reason  text,
  check ((kind = 'counter_flag') = (parent_flag_id is not null))
);
create index flag_xpert_idx on public.flag (xpert_id, status);
create index flag_status_idx on public.flag (status, created_at) where kind = 'flag';

create or replace function public.flag_investigate(p_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.flag%rowtype;
begin
  select * into f from public.flag where id = p_id for update;
  if not found then raise exception 'Flag not found' using errcode = 'P0002'; end if;
  if f.kind <> 'flag' or f.status <> 'open' then raise exception 'This flag is now %.', f.status using errcode = '40001'; end if;
  update public.flag set status = 'investigating', updated_by = p_actor, change_reason = 'Investigation started' where id = f.id;
  return jsonb_build_object('flag', f.id);
end $$;

create or replace function public.flag_decide(p_id uuid, p_outcome text, p_note text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.flag%rowtype;
begin
  if p_outcome not in ('upheld', 'dismissed') then raise exception 'Bad outcome'; end if;
  if coalesce(length(trim(p_note)), 0) < 3 then raise exception 'A note is required.'; end if;
  select * into f from public.flag where id = p_id for update;
  if not found then raise exception 'Flag not found' using errcode = 'P0002'; end if;
  if f.kind <> 'flag' or f.status not in ('open', 'investigating') then raise exception 'This flag is now %.', f.status using errcode = '40001'; end if;
  update public.flag set status = p_outcome, decided_by = p_actor, decided_at = now(), decision_note = p_note, updated_by = p_actor, change_reason = 'Decided: ' || p_outcome where id = f.id;
  update public.flag set status = 'reviewed', decided_by = p_actor, decided_at = now(), updated_by = p_actor, change_reason = 'Reviewed with the flag' where parent_flag_id = f.id and status = 'open';
  return jsonb_build_object('flag', f.id, 'xpert', f.xpert_id, 'outcome', p_outcome);
end $$;

-- Feedback: one per side per job -------------------------------------------------------------
create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.job (id),
  side          text not null check (side in ('employer', 'xpert')),
  rating        smallint not null check (rating between 1 and 5),
  on_time       boolean,
  would_repeat  boolean,
  comment       text,
  logged_by     uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text,
  unique (job_id, side)
);

-- The reliability record, computed from the records. Nothing here is typed in by hand. ----------
-- A clean job: completed, employer rated 4 or more, not marked late, and no upheld flag on that job.
create or replace view public.job_clean as
select j.id as job_id, j.xpert_id,
       (fb.rating >= 4 and fb.on_time is not false
        and not exists (select 1 from public.flag fl where fl.job_id = j.id and fl.kind = 'flag' and fl.status = 'upheld')) as clean
  from public.job j
  join public.feedback fb on fb.job_id = j.id and fb.side = 'employer'
 where j.status = 'completed';

create or replace view public.xpert_reliability as
select x.xpert_id,
       coalesce(c.completed, 0)  as jobs_completed,
       coalesce(c.clean, 0)      as clean_jobs,
       c.avg_rating,
       c.on_time_rate,
       coalesce(a.replaced_off, 0) as times_replaced,
       coalesce(a.withdrawn, 0)    as jobs_withdrawn,
       coalesce(f.upheld, 0)       as flags_upheld,
       coalesce(f.open, 0)         as flags_open
  from (select distinct xpert_id from public.assignment union select distinct xpert_id from public.flag where kind = 'flag') x
  left join (
    select j.xpert_id, count(*) as completed,
           count(*) filter (where jc.clean) as clean,
           round(avg(fb.rating)::numeric, 2) as avg_rating,
           round(avg(case when fb.on_time then 1 when fb.on_time is false then 0 end)::numeric, 2) as on_time_rate
      from public.job j
      left join public.feedback fb on fb.job_id = j.id and fb.side = 'employer'
      left join public.job_clean jc on jc.job_id = j.id
     where j.status = 'completed' group by j.xpert_id) c on c.xpert_id = x.xpert_id
  left join (
    select xpert_id,
           count(*) filter (where status = 'replaced')  as replaced_off,
           count(*) filter (where status = 'withdrawn') as withdrawn
      from public.assignment group by xpert_id) a on a.xpert_id = x.xpert_id
  left join (
    select xpert_id,
           count(*) filter (where status = 'upheld') as upheld,
           count(*) filter (where status in ('open', 'investigating')) as open
      from public.flag where kind = 'flag' group by xpert_id) f on f.xpert_id = x.xpert_id;

revoke execute on function public.flag_investigate(uuid, uuid), public.flag_decide(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on public.job_clean, public.xpert_reliability from anon, authenticated;

-- Permissions ---------------------------------------------------------------------------------------
-- Raising a flag is for anyone who watches jobs; deciding stays with decision makers. Seeing flags is
-- allowed to ops so they can follow what happened to what they raised.
insert into public.role_permission (role, permission) values
  ('ops_reviewer',   'flags.raise'),
  ('ops_reviewer',   'flags.read'),
  ('decision_maker', 'flags.raise'),
  ('decision_maker', 'coordinators.manage'),
  ('decision_maker', 'reliability.read'),
  ('finance_approver', 'reliability.read'),
  ('super_admin',   'flags.raise'),
  ('super_admin',   'coordinators.manage')
on conflict (role, permission) do nothing;

-- Standard conventions ---------------------------------------------------------------------------------
create trigger coordinator_touch         before update on public.coordinator         for each row execute function public.touch_updated_at();
create trigger coordinator_xpert_touch   before update on public.coordinator_xpert   for each row execute function public.touch_updated_at();
create trigger flag_touch                before update on public.flag                for each row execute function public.touch_updated_at();
create trigger feedback_touch            before update on public.feedback            for each row execute function public.touch_updated_at();

create trigger coordinator_audit         after insert or update on public.coordinator         for each row execute function public.audit_row_change('id');
create trigger coordinator_xpert_audit   after insert or update on public.coordinator_xpert   for each row execute function public.audit_row_change('id');
create trigger flag_audit                after insert or update on public.flag                for each row execute function public.audit_row_change('id');
create trigger feedback_audit            after insert or update on public.feedback            for each row execute function public.audit_row_change('id');

create trigger coordinator_no_delete       before delete on public.coordinator       for each row execute function public.block_hard_delete();
create trigger coordinator_xpert_no_delete before delete on public.coordinator_xpert for each row execute function public.block_hard_delete();
create trigger flag_no_delete              before delete on public.flag              for each row execute function public.block_hard_delete();
create trigger feedback_no_delete          before delete on public.feedback          for each row execute function public.block_hard_delete();

alter table public.coordinator       enable row level security;
alter table public.coordinator_xpert enable row level security;
alter table public.flag              enable row level security;
alter table public.feedback          enable row level security;

create policy coordinator_read       on public.coordinator       for select to authenticated using (public.has_permission('coordinators.read'));
create policy coordinator_xpert_read on public.coordinator_xpert for select to authenticated using (public.has_permission('coordinators.read'));
create policy flag_read              on public.flag              for select to authenticated using (public.has_permission('flags.read'));
create policy feedback_read          on public.feedback          for select to authenticated using (public.has_permission('feedback.read'));

revoke all on public.coordinator, public.coordinator_xpert, public.flag, public.feedback from anon, authenticated;
grant select on public.coordinator, public.coordinator_xpert, public.flag, public.feedback to authenticated;

commit;
