-- 0003_xpert_status.sql (hetzner database)
-- NOT APPLIED. Run after 0001 and 0002.
--
-- The one place an Xpert's status changes. The console API has already decided the move is legal
-- (packages/shared/src/xpertStatus.ts). This function makes it atomic: it locks the row, refuses if
-- the status moved since the screen was loaded, then updates the Xpert, writes the history row and
-- writes the audit row in ONE transaction, in this one database. That is why the status and its
-- history live here and not in the console's Supabase project.
--
-- The console then records the same change in its own audit log, using the returned history id as
-- the unique key, so a retry never writes it twice (see docs/PHASE7.md).

begin;

create table xpert_status_history (
  id           bigint generated always as identity primary key,
  xpert_id     uuid not null references xpert (id),
  old_status   text,
  new_status   text not null,
  changed_by   text,
  automatic    boolean not null default false,
  trigger      text check (trigger is null or trigger in (
    'guarantor_named', 'guarantor_confirmed', 'guarantor_declined', 'guarantor_deadline_passed', 'screening_started',
    'admin_approved', 'reference_confirmed', 'certification_verified', 'clean_jobs_completed', 'flag_named_incident',
    'no_shows', 'guarantor_retracted', 'conflicting_accounts', 'safety_concern', 'review_outcome', 'suspension_outcome',
    'voluntary_inactive', 'voluntary_return')),
  reason       text,
  changed_at   timestamptz not null default now()
);
create index xpert_status_history_xpert_idx on xpert_status_history (xpert_id, id desc);
create index xpert_status_history_entered_idx on xpert_status_history (new_status, xpert_id);

-- Append only: no edits, no deletes.
create trigger xpert_status_history_immutable before update or delete on xpert_status_history
  for each row execute function audit_log_immutable();
create trigger xpert_status_history_no_truncate before truncate on xpert_status_history
  for each statement execute function audit_log_immutable();

alter table xpert_status_history enable row level security;
create policy status_history_read on xpert_status_history for select to console_read, backend_app using (true);
grant select on xpert_status_history to console_read, backend_app;

create or replace function xpert_apply_transition(
  p_xpert_id          uuid,
  p_expected_from     text,
  p_to                text,
  p_trigger           text,
  p_reason            text,
  p_actor             text,
  p_automatic         boolean,
  p_set_active        boolean,
  p_verification_src  text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur text;
  became_active boolean := p_set_active is true;
  hist_id bigint;
begin
  select xpert_status into cur from xpert where id = p_xpert_id and deleted_at is null for update;
  if not found then
    raise exception 'Xpert not found' using errcode = 'P0002';
  end if;
  if cur is distinct from p_expected_from then
    raise exception 'Status changed from % to % since you opened this Xpert. Reload and try again.', p_expected_from, cur
      using errcode = '40001';
  end if;

  -- Lets the guard trigger on xpert allow this write, for this transaction only.
  perform set_config('bx.status_write', 'on', true);

  update xpert set
    xpert_status        = p_to,
    account_active      = coalesce(p_set_active, account_active),
    activated_by        = case when became_active then p_actor else activated_by end,
    activated_at        = case when became_active then now() else activated_at end,
    verification_source = coalesce(p_verification_src, verification_source),
    updated_by          = p_actor,
    change_reason       = p_reason
  where id = p_xpert_id;

  insert into xpert_status_history (xpert_id, old_status, new_status, changed_by, automatic, trigger, reason)
  values (p_xpert_id, cur, p_to, p_actor, coalesce(p_automatic, false), p_trigger, p_reason)
  returning id into hist_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, before, after, reason, external_ref)
  values (
    p_actor, 'xpert.status_change', 'xpert', p_xpert_id::text,
    jsonb_build_object('xpert_status', cur),
    jsonb_build_object('xpert_status', p_to, 'account_active', p_set_active, 'trigger', p_trigger),
    p_reason,
    'xpert_status:' || hist_id
  );

  perform set_config('bx.status_write', 'off', true);
  return hist_id;
end $$;

revoke execute on function xpert_apply_transition(uuid, text, text, text, text, text, boolean, boolean, text) from public;
grant execute on function xpert_apply_transition(uuid, text, text, text, text, text, boolean, boolean, text) to console_write;
-- Reading needs a connection too: console_write is a login of its own, so it can see the row it is changing.
grant usage on schema public to console_write;

commit;
