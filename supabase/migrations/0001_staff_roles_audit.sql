-- 0001_staff_roles_audit.sql
--
-- BeyondX admin console, Phase 1.
-- ADDITIVE ONLY: creates three new tables and some helper functions. It does not
-- alter, read or drop any existing table, so it is safe to run on the shared
-- database. NOT APPLIED YET. Review it, then run it once in the Supabase SQL
-- editor (or with the Supabase CLI).
--
-- Conventions every later console table follows:
--   * updated_by (uuid) and change_reason (text) columns, filled by the API
--   * an AFTER INSERT OR UPDATE audit trigger that writes to audit_log
--   * a BEFORE DELETE trigger that blocks hard deletes
--   * RLS enabled, with access decided by has_permission(...)

begin;

-- Staff accounts -----------------------------------------------------------
create table public.staff_profile (
  user_id       uuid primary key references auth.users (id),
  email         text not null,
  full_name     text not null,
  role          text not null
                check (role in ('ops_reviewer', 'decision_maker', 'finance_approver', 'super_admin')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text
);
create unique index staff_profile_email_key on public.staff_profile (lower(email));

-- Which permissions each role holds. Editable by a super_admin. Revoking sets
-- granted = false; rows are never deleted.
create table public.role_permission (
  role          text not null
                check (role in ('ops_reviewer', 'decision_maker', 'finance_approver', 'super_admin')),
  permission    text not null,
  granted       boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text,
  primary key (role, permission)
);

-- Append only record of every action taken in the console.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  before      jsonb,
  after       jsonb,
  reason      text,
  metadata    jsonb
);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx  on public.audit_log (actor_id);

-- Default grants. quotes.compose is intentionally held by no role until a
-- super_admin decides who prepares and sends quotes. super_admin passes every
-- check in code, and is also listed here so the Roles screen shows it.
insert into public.role_permission (role, permission) values
  ('ops_reviewer', 'dashboard.view'),
  ('ops_reviewer', 'xperts.read'),
  ('ops_reviewer', 'guarantors.review'),
  ('ops_reviewer', 'evidence.review'),
  ('ops_reviewer', 'references.review'),
  ('ops_reviewer', 'reliability.read'),
  ('ops_reviewer', 'quotes.read'),
  ('ops_reviewer', 'dispatch.match'),
  ('ops_reviewer', 'jobs.monitor'),
  ('ops_reviewer', 'jobs.replace'),
  ('ops_reviewer', 'changeorders.manage'),
  ('ops_reviewer', 'coordinators.read'),
  ('ops_reviewer', 'feedback.read'),
  ('decision_maker', 'dashboard.view'),
  ('decision_maker', 'xperts.read'),
  ('decision_maker', 'xperts.approve'),
  ('decision_maker', 'xperts.status.decide'),
  ('decision_maker', 'flags.read'),
  ('decision_maker', 'flags.decide'),
  ('decision_maker', 'reliability.read'),
  ('decision_maker', 'coordinators.read'),
  ('decision_maker', 'feedback.read'),
  ('finance_approver', 'dashboard.view'),
  ('finance_approver', 'quotes.read'),
  ('finance_approver', 'quotes.signoff'),
  ('super_admin', 'dashboard.view'),
  ('super_admin', 'xperts.read'),
  ('super_admin', 'guarantors.review'),
  ('super_admin', 'evidence.review'),
  ('super_admin', 'references.review'),
  ('super_admin', 'xperts.approve'),
  ('super_admin', 'xperts.status.decide'),
  ('super_admin', 'flags.read'),
  ('super_admin', 'flags.decide'),
  ('super_admin', 'reliability.read'),
  ('super_admin', 'quotes.read'),
  ('super_admin', 'quotes.compose'),
  ('super_admin', 'quotes.signoff'),
  ('super_admin', 'pricing.bands.edit'),
  ('super_admin', 'benchmarks.edit'),
  ('super_admin', 'dispatch.match'),
  ('super_admin', 'jobs.monitor'),
  ('super_admin', 'jobs.replace'),
  ('super_admin', 'changeorders.manage'),
  ('super_admin', 'coordinators.read'),
  ('super_admin', 'feedback.read'),
  ('super_admin', 'settings.read'),
  ('super_admin', 'settings.edit'),
  ('super_admin', 'staff.read'),
  ('super_admin', 'staff.manage'),
  ('super_admin', 'audit.read')
on conflict (role, permission) do nothing;

-- Helper functions ----------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.block_hard_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Hard deletes are not allowed on %. Mark the record inactive instead.', tg_table_name
    using errcode = '42501';
end $$;

-- Writes one audit_log row per insert or update. Trigger arguments are the
-- primary key column names, joined with a colon to form entity_id.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_j jsonb := to_jsonb(new);
  old_j jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  actor uuid  := nullif(new_j ->> 'updated_by', '')::uuid;
  col   text;
  parts text[] := '{}';
begin
  if tg_op = 'UPDATE' and (new_j - 'updated_at') = (old_j - 'updated_at') then
    return new;
  end if;
  foreach col in array tg_argv loop
    parts := parts || coalesce(new_j ->> col, '');
  end loop;
  insert into public.audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after, reason)
  values (
    actor,
    (select sp.email from public.staff_profile sp where sp.user_id = actor),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    array_to_string(parts, ':'),
    old_j,
    new_j,
    new_j ->> 'change_reason'
  );
  return new;
end $$;

create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append only';
end $$;

-- True when the signed in user is an active staff member whose role holds the
-- permission. super_admin holds every permission.
create or replace function public.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.staff_profile sp
    where sp.user_id = auth.uid()
      and sp.is_active
      and (
        sp.role = 'super_admin'
        or exists (
          select 1 from public.role_permission rp
          where rp.role = sp.role and rp.permission = p and rp.granted
        )
      )
  );
$$;

create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.staff_profile sp where sp.user_id = auth.uid() and sp.is_active
  );
$$;

-- Triggers ------------------------------------------------------------------
create trigger staff_profile_touch before update on public.staff_profile
  for each row execute function public.touch_updated_at();
create trigger role_permission_touch before update on public.role_permission
  for each row execute function public.touch_updated_at();

create trigger staff_profile_audit after insert or update on public.staff_profile
  for each row execute function public.audit_row_change('user_id');
create trigger role_permission_audit after insert or update on public.role_permission
  for each row execute function public.audit_row_change('role', 'permission');

create trigger staff_profile_no_delete before delete on public.staff_profile
  for each row execute function public.block_hard_delete();
create trigger role_permission_no_delete before delete on public.role_permission
  for each row execute function public.block_hard_delete();

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- Row level security --------------------------------------------------------
-- The API uses the service role, which bypasses RLS, and enforces permissions in
-- code. These policies are the second layer: a signed in browser session can
-- read only what its role allows and can write nothing.
alter table public.staff_profile   enable row level security;
alter table public.role_permission enable row level security;
alter table public.audit_log       enable row level security;

create policy staff_profile_read on public.staff_profile
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('staff.read'));

create policy role_permission_read on public.role_permission
  for select to authenticated
  using (public.is_active_staff());

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (public.has_permission('audit.read'));

-- Supabase grants new tables to anon and authenticated by default. Remove that.
revoke all on public.staff_profile, public.role_permission, public.audit_log from anon, authenticated;
grant select on public.staff_profile, public.role_permission, public.audit_log to authenticated;

revoke execute on function public.has_permission(text), public.is_active_staff() from public, anon;
grant  execute on function public.has_permission(text), public.is_active_staff() to authenticated;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

commit;
