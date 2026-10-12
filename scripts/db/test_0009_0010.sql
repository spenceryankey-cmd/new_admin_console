-- Checks for 0009 (catalogue) and 0010 (category links, structured feedback). Raises on any failure.
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_fail(sql text, why text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'expected an error but it succeeded: %', why;
end $$;

-- The catalogue is exactly ten categories and forty task types, and nothing can change it.
do $$
begin
  if (select count(*) from service_category) <> 10 then raise exception 'expected 10 categories'; end if;
  if (select count(*) from task_type) <> 40 then raise exception 'expected 40 task types'; end if;
  perform pg_temp.expect_fail($f$insert into service_category(code,label,sort_order) values ('x','Remote Work',11)$f$, 'adding a category');
  perform pg_temp.expect_fail($f$update service_category set label = 'Renamed' where code = 'skilled_trades'$f$, 'renaming a category');
  perform pg_temp.expect_fail($f$delete from service_category where code = 'skilled_trades'$f$, 'removing a category');
  perform pg_temp.expect_fail($f$insert into task_type(code,category_code,label,sort_order) values ('skilled_trades.x','skilled_trades','Extra',9)$f$, 'adding a task type');
  perform pg_temp.expect_fail($f$update task_type set label = 'Renamed' where code = 'skilled_trades.carpentry_joinery'$f$, 'renaming a task type');
  perform pg_temp.expect_fail($f$delete from task_type$f$, 'removing task types');
  perform pg_temp.expect_fail($f$truncate task_type$f$, 'truncating task types');
  perform pg_temp.expect_fail($f$truncate service_category cascade$f$, 'truncating categories');
  if not exists (select 1 from service_category where label = 'Facility & Cleaning') then raise exception 'label with an ampersand is missing'; end if;
  if not exists (select 1 from task_type where label like 'Goods offloading%Tema Port') then raise exception 'the Tema Port task type is missing'; end if;
  if has_table_privilege('authenticated', 'service_category', 'insert') or has_table_privilege('authenticated', 'task_type', 'update') then raise exception 'browser roles must not write the catalogue'; end if;
end $$;

-- A category must be one of the ten, in every table that holds one.
do $$
declare j uuid;
begin
  perform pg_temp.expect_fail($f$insert into job_request(employer_name,employer_phone,category,description,location,timing) values ('E','1','Tiling','d','l','t')$f$, 'free text category on a request');
  perform pg_temp.expect_fail($f$insert into job_request(employer_name,employer_phone,category,description,location,timing) values ('E','1','Remote Support','d','l','t')$f$, 'a remote category on a request');
  perform pg_temp.expect_fail($f$insert into recurring_service(employer_name,employer_phone,category,description,location,timing,frequency,next_due) values ('E','1','Gardening','d','l','t','weekly',current_date)$f$, 'free text category on a recurring service');
  perform pg_temp.expect_fail($f$insert into benchmark_rate(category,unit,amount_ghs) values ('Gardening','per_job',50)$f$, 'free text category on a benchmark');
  perform pg_temp.expect_fail($f$insert into price_band(xpert_id,category,min_ghs,max_ghs) values ('x1','Gardening',10,20)$f$, 'free text category on a price band');
  insert into job_request(employer_name,employer_phone,category,description,location,timing) values ('E','1','Skilled Trades','d','l','t');
  insert into benchmark_rate(category,unit,amount_ghs) values ('Painting & Finishing','per_job',50);
  if exists (select 1 from catalogue_mismatches) then raise exception 'there should be no mismatches'; end if;
  if has_table_privilege('authenticated', 'catalogue_mismatches', 'select') then raise exception 'the mismatch view must not be readable from the browser'; end if;
end $$;

-- Old rows that do not match are reported, not changed or rejected. (Plain statements, so the old row is
-- committed in an earlier transaction, as it would be on a real database.)
alter table job_request drop constraint job_request_category_fk;
insert into job_request(employer_name,employer_phone,category,description,location,timing) values ('Old','2','Plumbing','d','l','t');
alter table job_request add constraint job_request_category_fk foreign key (category) references service_category (label) not valid;
do $$
begin
  if (select count(*) from catalogue_mismatches where table_name = 'job_request' and category = 'Plumbing') <> 1 then raise exception 'the old row should be reported'; end if;
  if (select category from job_request where employer_name = 'Old') <> 'Plumbing' then raise exception 'the old row must be left alone'; end if;
end $$;
update job_request set description = 'other text' where employer_name = 'Old';
do $$
begin
  perform pg_temp.expect_fail($f$update job_request set category = 'Gardening' where employer_name = 'Old'$f$, 'changing the category to free text');
end $$;
update job_request set category = 'Community Services' where employer_name = 'Old';
do $$
begin
  if exists (select 1 from catalogue_mismatches where table_name = 'job_request') then raise exception 'fixed row should leave the report'; end if;
end $$;

-- Structured feedback.
create or replace function pg_temp.new_done_job(cat text) returns uuid language plpgsql as $$
declare r uuid; q uuid; j uuid;
begin
  insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('Emp','024',cat,'Floor','Madina','Mon','quoted') returning id into r;
  insert into quote(request_id,version,status,total_ghs,lines,sent_at,valid_until) values (r,1,'sent',500,'[]',now(),now()+interval '3 days') returning id into q;
  perform quote_apply_response(q,'sent','accepted','employer',null,null);
  update payment set status='received', momo_reference='MF-' || r::text, received_at=now() where request_id = r;
  select id into j from job where request_id = r;
  perform job_dispatch(j,'fp','fb',null); perform job_start(j,null); perform job_confirm(j,'employer',null); perform job_confirm(j,'xpert',null);
  return j;
end $$;

do $$
declare j uuid := pg_temp.new_done_job('Skilled Trades'); k uuid := pg_temp.new_done_job('Painting & Finishing');
begin
  -- Existing style feedback (no reasons) is still valid for good ratings.
  insert into feedback(job_id, side, rating) values (j, 'employer', 5);
  if (select reasons from feedback where job_id = j and side = 'employer') <> '{}' then raise exception 'reasons should default to empty'; end if;
  -- A low rating needs a reason.
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating) values (%L, ''xpert'', 2)', j), 'rating 2 with no reason');
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating, reasons) values (%L, ''xpert'', 1, ''{}'')', j), 'rating 1 with an empty list');
  insert into feedback(job_id, side, rating, reasons) values (j, 'xpert', 2, array['poor_communication']);
  -- Only known reasons, each once.
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating, reasons) values (%L, ''employer'', 5, array[''made_up''])', k), 'an unknown reason');
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating, reasons) values (%L, ''employer'', 5, array[''quality_work'',''quality_work''])', k), 'a repeated reason');
  -- The task type must belong to the job's category.
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating, task_type_code) values (%L, ''employer'', 5, ''skilled_trades.carpentry_joinery'')', k), 'a task type from another category');
  perform pg_temp.expect_fail(format('insert into feedback(job_id, side, rating, task_type_code) values (%L, ''employer'', 5, ''not.a_task'')', k), 'an unknown task type');
  insert into feedback(job_id, side, rating, reasons, task_type_code) values (k, 'employer', 4, array['quality_work','left_site_clean'], (select code from task_type where category_code = 'painting_finishing' order by sort_order limit 1));
  -- Editing a good rating down to 2 without a reason is refused too.
  perform pg_temp.expect_fail(format('update feedback set rating = 2 where job_id = %L and side = ''employer''', j), 'lowering a rating without a reason');
  update feedback set rating = 2, reasons = array['poor_quality'] where job_id = j and side = 'employer';
end $$;
\echo 0009 and 0010 checks passed
