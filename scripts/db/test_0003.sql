\set ON_ERROR_STOP off
insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('Emp','024','Tiling','Floor','Madina','Mon','quoted') returning id \gset r_
insert into quote(request_id,version,status,total_ghs,lines,sent_at,valid_until) values (:'r_id',1,'sent',500,'[{"description":"Labour","amountGhs":500}]',now(),now()+interval '3 days') returning id \gset q_
\echo second open quote (expect ERROR):
insert into quote(request_id,version,status,total_ghs,lines) values (:'r_id',2,'draft',100,'[]');
\echo accept (expect request accepted, payment created):
select quote_apply_response(:'q_id','sent','accepted','staff_logged','phone call',null);
select status from job_request; select status, amount_ghs from payment;
\echo stale accept (expect ERROR):
select quote_apply_response(:'q_id','sent','declined','staff_logged',null,null);
\echo duplicate momo reference (expect ERROR on second):
update payment set momo_reference='MP123456', status='received';
insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('E2','025','Tiling','Floor','Madina','Mon','quoted') returning id \gset s_
insert into quote(request_id,version,status,total_ghs,lines) values (:'s_id',1,'sent',300,'[]') returning id \gset t_
select quote_apply_response(:'t_id','sent','accepted','employer',null,null);
update payment set momo_reference='mp123456' where quote_id=:'t_id';
\echo hard delete (expect ERROR):
delete from quote;
\echo duplicate live benchmark (expect ERROR):
insert into benchmark_rate(category,unit,amount_ghs) values ('Tiling','per_job',100);
insert into benchmark_rate(category,unit,amount_ghs) values ('tiling','per_job',120);
\echo compose grants (expect ops, decision_maker, finance, super_admin):
select role from role_permission where permission='quotes.compose' order by 1;
select value from console_config where key='quotes.validityDays';
\echo send and withdraw:
insert into job_request(employer_name,employer_phone,category,description,location,timing) values ('E3','026','Tiling','Floor','Madina','Mon') returning id \gset u_
insert into quote(request_id,version,total_ghs,lines) values (:'u_id',1,200,'[]') returning id \gset v_
select quote_send(:'v_id',3,null);
select status from job_request where id=:'u_id';
select quote_send(:'v_id',3,null);
select quote_withdraw(:'v_id','Wrong price',null);
select status from job_request where id=:'u_id';
