\set ON_ERROR_STOP off
insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('Emp','024','Skilled Trades','Floor','Madina','Mon','quoted') returning id \gset r_
insert into quote(request_id,version,status,total_ghs,lines,sent_at,valid_until) values (:'r_id',1,'sent',500,'[]',now(),now()+interval '3 days') returning id \gset q_
select quote_apply_response(:'q_id','sent','accepted','employer',null,null);
update payment set status='received', momo_reference='MP1', received_at=now();
select id from job \gset j_
select job_dispatch(:'j_id','x1','b1',null); select job_start(:'j_id',null);
select job_confirm(:'j_id','employer',null); select job_confirm(:'j_id','xpert',null);
\echo no feedback yet (expect clean_jobs 0, completed 1):
select xpert_id, jobs_completed, clean_jobs from xpert_reliability;
insert into feedback(job_id,side,rating,on_time) values (:'j_id','employer',5,true);
\echo duplicate feedback (expect ERROR):
insert into feedback(job_id,side,rating) values (:'j_id','employer',4);
\echo clean (expect clean_jobs 1, avg 5.00):
select xpert_id, jobs_completed, clean_jobs, avg_rating, on_time_rate from xpert_reliability;
insert into flag(xpert_id,job_id,raised_by_type,category,detail) values ('x1',:'j_id','employer','quality','Left a mess behind') returning id \gset f_
\echo counter flag needs a parent (expect ERROR):
insert into flag(xpert_id,kind,raised_by_type,category,detail) values ('x1','counter_flag','xpert','quality','It was not me');
insert into flag(xpert_id,job_id,kind,parent_flag_id,raised_by_type,category,detail) values ('x1',:'j_id','counter_flag',:'f_id','xpert','quality','The mess was there already');
select flag_investigate(:'f_id',null);
\echo decide without a note (expect ERROR):
select flag_decide(:'f_id','upheld','',null);
select flag_decide(:'f_id','upheld','Photos confirm it',null);
\echo decide twice (expect ERROR):
select flag_decide(:'f_id','dismissed','changed my mind',null);
\echo counter flag reviewed, job no longer clean (expect reviewed, clean_jobs 0, flags_upheld 1):
select status from flag where kind='counter_flag';
select clean_jobs, flags_upheld, flags_open from xpert_reliability;
\echo one current coordinator per Xpert:
insert into coordinator(full_name) values ('C1') returning id \gset c1_
insert into coordinator(full_name) values ('C2') returning id \gset c2_
insert into coordinator_xpert(coordinator_id,xpert_id) values (:'c1_id','x1');
insert into coordinator_xpert(coordinator_id,xpert_id) values (:'c2_id','x1');
\echo hard delete (expect ERROR):
delete from flag;
\echo browser roles cannot call the functions (expect ERROR):
set role authenticated; select flag_decide(:'f_id','upheld','x y z',null);
