\set ON_ERROR_STOP off
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','s@x.com');
insert into staff_profile(user_id,email,full_name,role) values ('00000000-0000-0000-0000-0000000000a1','s@x.com','S','ops_reviewer');
insert into guarantor(xpert_id,name,contact,updated_by) values ('x1','G','024','00000000-0000-0000-0000-0000000000a1');
\echo expect ERROR duplicate live guarantor:
insert into guarantor(xpert_id,name,contact) values ('x1','G2','025');
update guarantor set retracted_at=now() where xpert_id='x1';
insert into guarantor(xpert_id,name,contact) values ('x1','G3','026');
\echo expect ERROR hard delete:
delete from guarantor;
insert into status_history(xpert_id,old_status,new_status) values ('x1',null,'applied');
\echo expect ERROR append only:
update status_history set reason='x';
\echo expect ERROR bad status:
insert into status_history(xpert_id,new_status) values ('x1','bogus');
\echo expect ERROR no link or file:
insert into skill_evidence(xpert_id,task_type,evidence_type) values ('x1','t','certification');
\echo audit rows for guarantor (expect 3):
select count(*) from audit_log where entity_type='guarantor';
\echo rls: ops reviewer reads config? (expect 0, no settings.read) then guarantors (expect 2)
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
select count(*) from console_config;
select count(*) from guarantor;
\echo write from browser (expect ERROR):
insert into guarantor(xpert_id,name,contact) values ('x9','a','b');
reset role;
select role, permission from role_permission where permission='xperts.status.voluntary' order by 1;
select storage.buckets.id, public from storage.buckets;
