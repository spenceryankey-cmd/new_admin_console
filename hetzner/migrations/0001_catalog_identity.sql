-- 0001_catalog_identity.sql (hetzner database)
-- NOT APPLIED. Read it, then run it yourself in the hetzner Postgres (Railway data tab or psql).
--
-- This is the system of record for people and the service catalogue. The console's own tables
-- (requests, quotes, jobs, flags, feedback and so on) stay in Supabase. Xpert ids point across
-- the two databases as plain text, with no foreign key (see docs/PHASE7.md).
--
-- It creates only new objects. Nothing existing is changed.
--
-- Contents
--   1. Three group roles, one per kind of caller
--   2. Helper functions (updated_at, blocked hard delete, audit)
--   3. audit_log (append only)
--   4. service_category and task_type (read only for every application role)
--   5. xpert, xpert_restricted, xpert_skill, employer
--   6. Row level security, audit and hard delete triggers, and grants
--
-- The login users are created by you, not here, so no password is ever written into a migration:
--   create user console_reader login password '...' in role console_read;
--   create user console_writer login password '...' in role console_write;
--   create user backend_user   login password '...' in role backend_app;
-- Put each connection string only in Railway variables.

begin;

-- 1. Roles --------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'console_read')  then create role console_read  nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'console_write') then create role console_write nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'backend_app')   then create role backend_app   nologin; end if;
end $$;

-- 2. Helper functions ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function block_hard_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Hard deletes are not allowed on %. Mark the record inactive instead.', tg_table_name
    using errcode = '42501';
end $$;

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception '% is append only', tg_table_name using errcode = '42501';
end $$;

-- 3. Audit log ----------------------------------------------------------------------------------
-- actor_id is the staff member's id in the console (a Supabase user id), as text. external_ref is
-- a unique key for rows that mirror a console action, so a retry never writes the same fact twice.
create table audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     text,
  action       text not null,
  entity_type  text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  reason       text,
  external_ref text unique
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, at desc);

create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();

-- One audit row per insert or update. Trigger arguments name the primary key column(s).
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_j jsonb := to_jsonb(new);
  old_j jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  col   text;
  parts text[] := '{}';
begin
  if tg_op = 'UPDATE' and (new_j - 'updated_at') = (old_j - 'updated_at') then
    return new;
  end if;
  foreach col in array tg_argv loop
    parts := parts || coalesce(new_j ->> col, '');
  end loop;
  -- Secrets never go into the audit trail.
  new_j := new_j - 'pin_hash' - 'password_hash';
  old_j := old_j - 'pin_hash' - 'password_hash';
  insert into audit_log (actor_id, action, entity_type, entity_id, before, after, reason)
  values (
    nullif(new_j ->> 'updated_by', ''),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    array_to_string(parts, ':'),
    old_j,
    new_j,
    new_j ->> 'change_reason'
  );
  return new;
end $$;
revoke execute on function audit_row_change() from public;

-- 4. Catalogue (read only) ----------------------------------------------------------------------
create table service_category (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  label       text not null unique,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table task_type (
  code           text primary key check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  category_code  text not null references service_category (code),
  label          text not null,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (category_code, label),
  unique (code, category_code)
);

-- 5. People -------------------------------------------------------------------------------------
-- Xpert: the applicant and profile fields the main site collects, plus five columns that only the
-- console changes, through xpert_apply_transition (migration 0003). Rating, tasks completed and
-- total earned are not stored: the console derives them from jobs and feedback.
create table xpert (
  id                      uuid primary key default gen_random_uuid(),
  xpert_code              text not null unique,
  full_name               text not null,
  phone                   text,
  pin_hash                text not null,
  bio                     text,
  photo_url               text,
  home_area               text,
  home_lat                double precision,
  home_lng                double precision,
  daily_charge            numeric(10, 2) not null default 80 check (daily_charge >= 0),
  has_tools               boolean not null default false,
  gps_verified            boolean not null default false,
  id_verified             boolean not null default false,
  last_active_at          timestamptz,
  -- As entered on the application. The console copies these into its guarantor record.
  guarantor_name          text,
  guarantor_phone         text,
  guarantor_relationship  text,
  -- Changed only by the console (see the guard trigger below).
  xpert_status            text not null default 'applied' check (xpert_status in (
    'applied', 'guarantor_pending', 'guarantor_confirmed', 'skill_verification', 'provisional_active',
    'full_active', 'under_review', 'suspended', 'inactive', 'removed', 'blocked_closed')),
  account_active          boolean not null default false,
  activated_by            text,
  activated_at            timestamptz,
  verification_source     text check (verification_source in ('direct_beyondx', 'coordinator')),
  -- Housekeeping.
  updated_by              text,
  change_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create index xpert_status_idx on xpert (xpert_status) where deleted_at is null;
create index xpert_created_idx on xpert (created_at desc);
create unique index xpert_phone_idx on xpert (phone) where phone is not null and deleted_at is null;

-- Only a transition function (or a deliberate import) may touch the five status columns. The
-- function and the import both set bx.status_write for their own transaction.
create or replace function xpert_status_guard() returns trigger
language plpgsql as $$
declare
  allowed boolean := coalesce(current_setting('bx.status_write', true), '') = 'on';
begin
  if allowed then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.xpert_status <> 'applied' or new.account_active or new.activated_by is not null
       or new.activated_at is not null or new.verification_source is not null then
      raise exception 'A new Xpert always starts as applied and inactive. Only the console changes status.' using errcode = '42501';
    end if;
  elsif new.xpert_status is distinct from old.xpert_status
     or new.account_active is distinct from old.account_active
     or new.activated_by is distinct from old.activated_by
     or new.activated_at is distinct from old.activated_at
     or new.verification_source is distinct from old.verification_source then
    raise exception 'Only the console changes an Xpert''s status or approval.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Sensitive fields. No console role can read this table. The Ghana Card number is never stored:
-- only its type, its last four characters and a keyed hash (made by the backend with a secret that
-- is not in the database) so duplicates can be found.
create table xpert_restricted (
  xpert_id             uuid primary key references xpert (id),
  id_type              text,
  id_last4             text check (id_last4 is null or char_length(id_last4) = 4),
  id_hash              text,
  id_verification_ref  text,
  prison_facility      text,
  release_date         date,
  offense_level        text check (offense_level in ('none', 'minor', 'major')),
  offense_notes        text,
  updated_by           text,
  change_reason        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- What an Xpert can do. A row names a category, and optionally one of its task types.
create table xpert_skill (
  id             bigint generated always as identity primary key,
  xpert_id       uuid not null references xpert (id),
  category_code  text not null references service_category (code),
  task_type_code text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  foreign key (task_type_code, category_code) references task_type (code, category_code)
);
create unique index xpert_skill_unique_idx on xpert_skill (xpert_id, category_code, coalesce(task_type_code, ''))
  where deleted_at is null;
create index xpert_skill_category_idx on xpert_skill (category_code) where deleted_at is null;

create table employer (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  password_hash    text not null,
  org_name         text not null,
  contact_person   text,
  phone            text,
  address          text,
  region           text,
  is_verified      boolean not null default false,
  logo_url         text,
  acknowledged_at  timestamptz,
  updated_by       text,
  change_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create unique index employer_email_idx on employer (lower(email)) where deleted_at is null;

-- 6. Triggers, row level security and grants ----------------------------------------------------
do $$
declare
  t text;
  pk text;
begin
  for t, pk in
    select * from (values
      ('service_category', 'code'), ('task_type', 'code'), ('xpert', 'id'),
      ('xpert_restricted', 'xpert_id'), ('xpert_skill', 'id'), ('employer', 'id')
    ) as v(t, pk)
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'updated_at') then
      execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
    end if;
    execute format('create trigger %I after insert or update on %I for each row execute function audit_row_change(%L)', t || '_audit', t, pk);
    execute format('create trigger %I before delete on %I for each row execute function block_hard_delete()', t || '_no_delete', t);
    execute format('create trigger %I before truncate on %I for each statement execute function block_hard_delete()', t || '_no_truncate', t);
  end loop;
end $$;

create trigger xpert_status_guard_trg before insert or update on xpert
  for each row execute function xpert_status_guard();

alter table audit_log         enable row level security;
alter table service_category  enable row level security;
alter table task_type         enable row level security;
alter table xpert             enable row level security;
alter table xpert_restricted  enable row level security;
alter table xpert_skill       enable row level security;
alter table employer          enable row level security;

-- Row level security is on for every table. The roles below are allowed every row of the tables
-- they can reach at all; what they may do is decided by the grants.
create policy audit_read        on audit_log        for select to console_read, backend_app using (true);
create policy catalog_read_sc   on service_category for select to console_read, backend_app using (true);
create policy catalog_read_tt   on task_type        for select to console_read, backend_app using (true);
create policy xpert_read        on xpert            for select to console_read using (true);
create policy xpert_app         on xpert            for all    to backend_app  using (true) with check (true);
create policy restricted_app    on xpert_restricted for all    to backend_app  using (true) with check (true);
create policy skill_read        on xpert_skill      for select to console_read using (true);
create policy skill_app         on xpert_skill      for all    to backend_app  using (true) with check (true);
create policy employer_read     on employer         for select to console_read using (true);
create policy employer_app      on employer         for all    to backend_app  using (true) with check (true);

revoke all on all tables in schema public from public;
grant usage on schema public to console_read, console_write, backend_app;

-- The console reads. It can never read pin_hash or password_hash, and has no access to xpert_restricted.
grant select on service_category, task_type, xpert_skill to console_read;
grant select (id, xpert_code, full_name, phone, bio, photo_url, home_area, home_lat, home_lng, daily_charge, has_tools,
              gps_verified, id_verified, last_active_at, guarantor_name, guarantor_phone, guarantor_relationship,
              xpert_status, account_active, activated_by, activated_at, verification_source, created_at, updated_at, deleted_at)
  on xpert to console_read;
grant select (id, email, org_name, contact_person, phone, address, region, is_verified, created_at, updated_at, deleted_at)
  on employer to console_read;
grant select on audit_log to console_read;

-- The main backend reads the catalogue and runs registration and profile screens. It can insert and
-- update Xpert rows, but cannot set the five status columns, and it cannot delete anything.
grant select on service_category, task_type to backend_app;
grant select on audit_log to backend_app;
grant select on xpert to backend_app;
grant insert (xpert_code, full_name, phone, pin_hash, bio, photo_url, home_area, home_lat, home_lng, daily_charge,
              has_tools, gps_verified, id_verified, last_active_at, guarantor_name, guarantor_phone,
              guarantor_relationship, updated_by, change_reason, deleted_at)
  on xpert to backend_app;
grant update (xpert_code, full_name, phone, pin_hash, bio, photo_url, home_area, home_lat, home_lng, daily_charge,
              has_tools, gps_verified, id_verified, last_active_at, guarantor_name, guarantor_phone,
              guarantor_relationship, updated_by, change_reason, deleted_at)
  on xpert to backend_app;
grant select, insert, update on xpert_restricted, xpert_skill, employer to backend_app;
grant usage, select on all sequences in schema public to backend_app;

commit;
