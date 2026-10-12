-- Database tests for the hetzner migrations. Every check raises on failure, so a clean run means all passed.
\set ON_ERROR_STOP on

create or replace function pg_temp.expect_error(stmt text, want_state text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = want_state then return; end if;
    raise exception 'expected % but got % (%) for: %', want_state, sqlstate, sqlerrm, stmt;
  end;
  raise exception 'expected % but the statement succeeded: %', want_state, stmt;
end $$;
grant execute on function pg_temp.expect_error(text, text) to public;

create or replace function pg_temp.assert_true(ok boolean, what text) returns void
language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
end $$;
grant execute on function pg_temp.assert_true(boolean, text) to public;

\echo 1. catalogue is seeded exactly
select pg_temp.assert_true((select count(*) from service_category) = 10, '10 categories');
select pg_temp.assert_true((select count(*) from task_type) = 40, '40 task types');
select pg_temp.assert_true((select count(distinct category_code) from task_type) = 10, 'every category has task types');
select pg_temp.assert_true((select bool_and(n = 4) from (select count(*) n from task_type group by category_code) s), 'four task types per category');
select pg_temp.assert_true(exists (select 1 from task_type where label = 'Goods offloading — Tema Port'), 'labels are exact');
select pg_temp.assert_true(not exists (select 1 from service_category where label ~* '(data entry|customer support|virtual|transcription|social media|online research)'), 'no remote categories');

\echo 2. structure: row level security, audit and no hard delete on every table
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'row level security is on for every table');
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('audit_log', 'xpert_status_history')
    and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal and t.tgfoid = 'audit_row_change'::regproc)),
  'every table has the audit trigger');
select pg_temp.assert_true(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('audit_log', 'xpert_status_history')
    and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal and t.tgfoid = 'block_hard_delete'::regproc)),
  'every table blocks hard deletes');
select pg_temp.assert_true(not exists (select 1 from pg_roles where rolname in ('console_read', 'console_write', 'backend_app') and rolcanlogin),
  'the three group roles cannot log in themselves');

\echo 3. a new Xpert starts applied and inactive
insert into xpert (xpert_code, full_name, phone, pin_hash) values ('BX-1', 'Ama Test', '0241', 'x') returning id \gset a_
insert into xpert (xpert_code, full_name, phone, pin_hash) values ('BX-2', 'Kofi Test', '0242', 'x') returning id \gset b_
select pg_temp.assert_true((select xpert_status = 'applied' and account_active = false from xpert where id = :'a_id'), 'defaults');
select pg_temp.expect_error($$insert into xpert (xpert_code, full_name, pin_hash, xpert_status) values ('BX-9', 'Bad', 'x', 'full_active')$$, '42501');
select pg_temp.expect_error($$insert into xpert (xpert_code, full_name, pin_hash, account_active) values ('BX-9', 'Bad', 'x', true)$$, '42501');
select pg_temp.expect_error($$update xpert set xpert_status = 'full_active' where xpert_code = 'BX-1'$$, '42501');
select pg_temp.expect_error($$update xpert set account_active = true where xpert_code = 'BX-1'$$, '42501');
select pg_temp.expect_error($$delete from xpert where xpert_code = 'BX-1'$$, '42501');
select pg_temp.expect_error($$insert into xpert (xpert_code, full_name, pin_hash, phone) values ('BX-9', 'Dup', 'x', '0241')$$, '23505');

\echo 4. the main backend can register and edit, but not touch status or delete
set role backend_app;
insert into xpert (xpert_code, full_name, phone, pin_hash) values ('BX-3', 'Via Backend', '0243', 'x');
update xpert set full_name = 'Via Backend Two', bio = 'hello' where xpert_code = 'BX-3';
select pg_temp.expect_error($$update xpert set xpert_status = 'full_active' where xpert_code = 'BX-3'$$, '42501');
select pg_temp.expect_error($$update xpert set account_active = true where xpert_code = 'BX-3'$$, '42501');
select pg_temp.expect_error($$insert into xpert (xpert_code, full_name, pin_hash, xpert_status) values ('BX-8', 'Bad', 'x', 'full_active')$$, '42501');
select pg_temp.expect_error($$delete from xpert where xpert_code = 'BX-3'$$, '42501');
select pg_temp.expect_error($$insert into service_category (code, label) values ('x', 'X')$$, '42501');
select pg_temp.expect_error($$update service_category set label = 'Renamed' where code = 'skilled_trades'$$, '42501');
select pg_temp.expect_error($$select xpert_apply_transition(gen_random_uuid(), 'applied', 'guarantor_pending', null, null, null, true, null)$$, '42501');
reset role;

\echo 5. the console reads, never secrets, never the restricted table
insert into xpert_restricted (xpert_id, id_type, id_last4) values (:'a_id', 'ghana_card', '1234');
set role console_read;
select pg_temp.assert_true((select count(*) from xpert where deleted_at is null) >= 3, 'can read Xperts');
select id, xpert_code, full_name, xpert_status, account_active from xpert limit 1;
select pg_temp.expect_error($$select pin_hash from xpert$$, '42501');
select pg_temp.expect_error($$select * from xpert$$, '42501');
select pg_temp.expect_error($$select * from xpert_restricted$$, '42501');
select pg_temp.expect_error($$select password_hash from employer$$, '42501');
select pg_temp.expect_error($$update xpert set full_name = 'x'$$, '42501');
select pg_temp.expect_error($$insert into service_category (code, label) values ('x', 'X')$$, '42501');
reset role;

\echo 6. the console writer can only run the transition function
set role console_write;
select pg_temp.expect_error($$select * from xpert$$, '42501');
select pg_temp.expect_error($$update xpert set xpert_status = 'full_active'$$, '42501');
select xpert_apply_transition(:'a_id'::uuid, 'applied', 'guarantor_pending', 'guarantor_named', 'Guarantor named', 'staff-1', true, null, null) as h1 \gset
reset role;
select pg_temp.assert_true((select xpert_status = 'guarantor_pending' and account_active = false from xpert where id = :'a_id'), 'status moved, still inactive');
select pg_temp.assert_true((select count(*) = 1 from xpert_status_history where xpert_id = :'a_id' and old_status = 'applied' and new_status = 'guarantor_pending' and trigger = 'guarantor_named' and automatic), 'history row written');
select pg_temp.assert_true(exists (select 1 from audit_log where external_ref = 'xpert_status:' || :'h1'), 'audit row written with its unique key');

set role console_write;
select pg_temp.expect_error(format($$select xpert_apply_transition(%L::uuid, 'applied', 'guarantor_pending', null, null, 'staff-1', false, null, null)$$, :'a_id'), '40001');
select pg_temp.expect_error($$select xpert_apply_transition(gen_random_uuid(), 'applied', 'guarantor_pending', null, null, 'staff-1', false, null, null)$$, 'P0002');
select pg_temp.expect_error(format($$select xpert_apply_transition(%L::uuid, 'guarantor_pending', 'not_a_status', null, null, 'staff-1', false, null, null)$$, :'a_id'), '23514');
select pg_temp.expect_error(format($$select xpert_apply_transition(%L::uuid, 'guarantor_pending', 'guarantor_confirmed', 'made_up', null, 'staff-1', false, null, null)$$, :'a_id'), '23514');
select xpert_apply_transition(:'a_id'::uuid, 'guarantor_pending', 'provisional_active', 'admin_approved', 'Approved', 'staff-2', false, true, 'direct_beyondx');
reset role;
select pg_temp.assert_true((select account_active and activated_by = 'staff-2' and activated_at is not null and verification_source = 'direct_beyondx' from xpert where id = :'a_id'), 'approval switches the account on');
select pg_temp.assert_true((select count(*) = 2 from xpert_status_history where xpert_id = :'a_id'), 'two history rows');
select pg_temp.assert_true((select xpert_status = 'applied' from xpert where id = :'b_id'), 'other Xperts untouched');

\echo 7. a failed move changes nothing
select pg_temp.assert_true((select xpert_status = 'provisional_active' from xpert where id = :'a_id'), 'rejected moves left the status alone');
select pg_temp.expect_error($$update xpert_status_history set reason = 'x'$$, '42501');
select pg_temp.expect_error($$delete from xpert_status_history$$, '42501');
select pg_temp.expect_error($$update audit_log set reason = 'x'$$, '42501');
select pg_temp.expect_error($$delete from audit_log$$, '42501');
select pg_temp.expect_error($$truncate xpert_status_history$$, '42501');
select pg_temp.assert_true(not exists (select 1 from audit_log where after::text ~ 'pin_hash' or before::text ~ 'pin_hash'), 'pin hashes never reach the audit trail');

\echo 8. skills must use real catalogue codes
insert into xpert_skill (xpert_id, category_code, task_type_code) values (:'a_id', 'skilled_trades', 'skilled_trades.carpentry_joinery');
insert into xpert_skill (xpert_id, category_code) values (:'a_id', 'painting_finishing');
select pg_temp.expect_error(format($$insert into xpert_skill (xpert_id, category_code, task_type_code) values (%L, 'painting_finishing', 'skilled_trades.carpentry_joinery')$$, :'a_id'), '23503');
select pg_temp.expect_error(format($$insert into xpert_skill (xpert_id, category_code) values (%L, 'made_up')$$, :'a_id'), '23503');
select pg_temp.expect_error(format($$insert into xpert_skill (xpert_id, category_code) values (%L, 'painting_finishing')$$, :'a_id'), '23505');

\echo 9. an Xpert id that does not exist cannot be given history or skills
select pg_temp.expect_error($$insert into xpert_skill (xpert_id, category_code) values (gen_random_uuid(), 'skilled_trades')$$, '23503');

\echo ALL HETZNER CHECKS PASSED
