\set ON_ERROR_STOP off
insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('Emp','024','Skilled Trades','Floor','Madina','Mon','quoted') returning id \gset r_
insert into quote(request_id,version,status,total_ghs,lines,sent_at,valid_until) values (:'r_id',1,'sent',500,'[]',now(),now()+interval '3 days') returning id \gset q_
select quote_apply_response(:'q_id','sent','accepted','employer',null,null);
\echo no job yet (expect 0):
select count(*) from job;
update payment set status='received', momo_reference='MP1', received_at=now();
\echo job created (expect 1 awaiting_dispatch):
select status, amount_ghs from job;
select id from job \gset j_
\echo start before dispatch (expect ERROR):
select job_start(:'j_id',null);
select job_dispatch(:'j_id','x1','b1',null);
\echo second dispatch (expect ERROR):
select job_dispatch(:'j_id','x2','b2',null);
select job_start(:'j_id',null);
\echo replace without reason (expect ERROR):
select job_replace(:'j_id','x2','',null);
select job_replace(:'j_id','x2','No show',null);
\echo assignments (expect replaced x1, active x2):
select xpert_id,status from assignment order by assigned_at;
\echo one side confirms (expect not completed, payment received):
select job_confirm(:'j_id','employer',null);
select status from job; select status from payment;
\echo both confirm (expect completed, payment released):
select job_confirm(:'j_id','xpert',null);
select status from job; select status, released_at is not null from payment;
\echo cancel completed (expect ERROR):
select job_cancel(:'j_id','x y z',null);
\echo hard delete (expect ERROR):
delete from job;
\echo change order both sides:
insert into change_order(job_id,description,amount_delta_ghs) values (:'j_id','Extra tiles',50) returning id \gset c_
select change_order_confirm(:'c_id','employer',null);
select status from change_order;
select change_order_confirm(:'c_id','xpert',null);
select status from change_order;
select change_order_reject(:'c_id','xpert','no',null);
\echo recurring:
insert into recurring_service(employer_name,employer_phone,category,description,location,timing,frequency,next_due) values ('E','1','Facility & Cleaning','Deep','East','Mon','weekly',current_date) returning id \gset s_
select recurring_generate(:'s_id',null);
\echo again same day (expect ERROR):
select recurring_generate(:'s_id',null);
select count(*) from job_request where recurring_id is not null;
