-- Checks for 0012 (inbox state and notification log). Raises on any failure.
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_fail(sql text, why text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'expected an error but it succeeded: %', why;
end $$;

insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000c0001','inbox-ops@x.com'), ('00000000-0000-0000-0000-0000000c0002','inbox-fin@x.com');
insert into staff_profile(user_id,email,full_name,role) values
  ('00000000-0000-0000-0000-0000000c0001','inbox-ops@x.com','OPS','ops_reviewer'),
  ('00000000-0000-0000-0000-0000000c0002','inbox-fin@x.com','FIN','finance_approver');

do $$
declare a uuid := '00000000-0000-0000-0000-0000000c0001'; n int;
begin
  -- Handling a message: open by default, handled needs who and when, reopening clears them.
  insert into inbox_state(message_ref, updated_by, change_reason) values ('msg-1', a, 'Seen');
  if (select status from inbox_state where message_ref = 'msg-1') <> 'open' then raise exception 'new state should be open'; end if;
  update inbox_state set status = 'handled', handled_by = a, handled_at = now(), note = 'Called back', updated_by = a, change_reason = 'Dealt with' where message_ref = 'msg-1';
  perform pg_temp.expect_fail($f$update inbox_state set handled_by = null where message_ref = 'msg-1'$f$, 'handled without who');
  perform pg_temp.expect_fail($f$update inbox_state set status = 'open' where message_ref = 'msg-1'$f$, 'open but still carrying handled fields');
  update inbox_state set status = 'open', handled_by = null, handled_at = null, updated_by = a, change_reason = 'Reopened' where message_ref = 'msg-1';
  perform pg_temp.expect_fail($f$insert into inbox_state(message_ref, status) values ('msg-2', 'archived')$f$, 'unknown status');
  perform pg_temp.expect_fail($f$insert into inbox_state(message_ref) values ('')$f$, 'empty ref');
  perform pg_temp.expect_fail($f$insert into inbox_state(message_ref, note) values ('msg-3', repeat('x', 1001))$f$, 'note too long');
  perform pg_temp.expect_fail($f$delete from inbox_state$f$, 'hard delete of inbox state');
  select count(*) into n from audit_log where entity_type = 'inbox_state' and entity_id = 'msg-1';
  if n < 3 then raise exception 'inbox changes must be audited (found %)', n; end if;

  -- The notification log.
  insert into notification_send(audience_kind, body, recipient_count, delivered_count, status, sent_by, updated_by, change_reason)
    values ('all_xperts', 'Rain expected tomorrow. Check your jobs.', 40, 40, 'sent', a, a, 'Sent from the console');
  insert into notification_send(audience_kind, audience_detail, body, recipient_count, delivered_count, status, error, sent_by, updated_by)
    values ('xperts_in_category', 'Skilled Trades', 'Hello', 10, 4, 'partial', 'Some bells failed', a, a);
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, status, sent_by) values ('everyone', 'Hello', 1, 'sent', '00000000-0000-0000-0000-0000000c0001')$f$, 'unknown audience');
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, status, sent_by) values ('xpert', 'Hi', 0, 'sent', '00000000-0000-0000-0000-0000000c0001')$f$, 'a send to nobody');
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, delivered_count, status, sent_by) values ('xpert', 'Hello', 1, 2, 'sent', '00000000-0000-0000-0000-0000000c0001')$f$, 'delivered more than sent');
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, status, sent_by) values ('xpert', 'Hello', 1, 'queued', '00000000-0000-0000-0000-0000000c0001')$f$, 'unknown status');
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, status, sent_by) values ('xpert', 'x', 1, 'sent', '00000000-0000-0000-0000-0000000c0001')$f$, 'message too short');
  perform pg_temp.expect_fail($f$insert into notification_send(audience_kind, body, recipient_count, status) values ('xpert', 'Hello', 1, 'sent')$f$, 'no sender');
  perform pg_temp.expect_fail($f$delete from notification_send$f$, 'hard delete of the send log');
  if (select count(*) from audit_log where entity_type = 'notification_send') < 2 then raise exception 'sends must be audited'; end if;
end $$;

-- Who can see what, from a browser session (row level security).
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0001', false);
  perform set_config('request.jwt.claims', '{"aal":"aal1"}', false);
  if not has_permission('inbox.read') or not has_permission('inbox.handle') then raise exception 'ops reviewer should read and handle the inbox'; end if;
  if has_permission('notifications.send') then raise exception 'ops reviewer must not send notifications'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000c0002', false);
  if has_permission('inbox.read') or has_permission('notifications.send') then raise exception 'finance must have neither by default'; end if;
  if has_table_privilege('authenticated', 'inbox_state', 'insert') or has_table_privilege('authenticated', 'inbox_state', 'update') then raise exception 'browser roles must not write inbox state'; end if;
  if has_table_privilege('authenticated', 'notification_send', 'insert') then raise exception 'browser roles must not write the send log'; end if;
  if has_table_privilege('anon', 'inbox_state', 'select') or has_table_privilege('anon', 'notification_send', 'select') then raise exception 'anon must read nothing'; end if;
end $$;
\echo test_0012 passed
