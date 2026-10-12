-- Checks for 0006 (audit external ref) and 0007 (quote sign off removed). Raises on failure.
\set ON_ERROR_STOP on
do $$
begin
  if exists (select 1 from role_permission where permission = 'quotes.signoff' and granted) then raise exception 'quotes.signoff is still granted'; end if;
  if (select count(*) from role_permission where permission = 'quotes.signoff') = 0 then raise exception 'the revoked rows should be kept, not deleted'; end if;
  if (select count(*) from role_permission where permission = 'quotes.compose' and granted and role in ('ops_reviewer','decision_maker','finance_approver','super_admin')) <> 4 then
    raise exception 'quotes.compose must stay with every role that can see the dashboard, including finance';
  end if;
end $$;

insert into audit_log (action, entity_type, entity_id, metadata) values ('xpert.status_change', 'xpert', 'x', '{"external_ref":"xpert_status:1"}');
do $$
begin
  begin
    insert into audit_log (action, entity_type, entity_id, metadata) values ('xpert.status_change', 'xpert', 'x', '{"external_ref":"xpert_status:1"}');
  exception when unique_violation then
    return;
  end;
  raise exception 'a second copy of the same hetzner audit row was accepted';
end $$;
-- Rows without a reference are unaffected.
insert into audit_log (action, entity_type, entity_id) values ('a', 'b', 'c');
insert into audit_log (action, entity_type, entity_id) values ('a', 'b', 'c');
\echo 0006 and 0007 checks passed
