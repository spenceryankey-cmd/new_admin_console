-- Checks for 0008 (primary and backup, Promote backup, no show). Raises on any failure.
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_fail(sql text, why text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'expected an error but it succeeded: %', why;
end $$;
create or replace function pg_temp.new_job() returns uuid language plpgsql as $$
declare r uuid; q uuid; p uuid; j uuid;
begin
  insert into job_request(employer_name,employer_phone,category,description,location,timing,status) values ('Emp','024','Skilled Trades','Floor','Madina','Mon','quoted') returning id into r;
  insert into quote(request_id,version,status,total_ghs,lines,sent_at,valid_until) values (r,1,'sent',500,'[]',now(),now()+interval '3 days') returning id into q;
  perform quote_apply_response(q,'sent','accepted','employer',null,null);
  update payment set status='received', momo_reference='MP-' || r::text, received_at=now() where request_id = r;
  select id into j from job where request_id = r;
  return j;
end $$;

do $$
declare j uuid := pg_temp.new_job(); res jsonb; s text;
begin
  -- Dispatch needs a backup, and a different one.
  perform pg_temp.expect_fail(format('select job_dispatch(%L, ''p1'', null, null)', j), 'dispatch without a backup');
  perform pg_temp.expect_fail(format('select job_dispatch(%L, ''p1'', '''', null)', j), 'dispatch with an empty backup');
  perform pg_temp.expect_fail(format('select job_dispatch(%L, ''p1'', ''p1'', null)', j), 'same Xpert as primary and backup');
  perform job_dispatch(j, 'p1', 'b1', null);
  if (select status from job where id = j) <> 'dispatched' then raise exception 'job should be dispatched'; end if;
  if (select count(*) from assignment where job_id = j and status = 'active') <> 2 then raise exception 'two active assignments expected'; end if;
  -- The old three argument function is gone.
  if exists (select 1 from pg_proc where proname = 'job_dispatch' and pronargs = 3) then raise exception 'old job_dispatch still exists'; end if;
  -- One Xpert cannot hold both places, the backup cannot be the primary.
  perform pg_temp.expect_fail(format('select job_set_backup(%L, ''p1'', ''x'', null)', j), 'backup same as primary');
  perform pg_temp.expect_fail(format('select job_replace(%L, ''b1'', ''because'', null)', j), 'replace primary with the backup');
  perform pg_temp.expect_fail(format('select job_promote_backup(%L, '''', null)', j), 'promote without a reason');
  perform pg_temp.expect_fail($f$update job set backup_xpert_id = xpert_id$f$, 'constraint backup differs');
  perform pg_temp.expect_fail(format('insert into assignment(job_id,xpert_id,role) values (%L, ''z9'', ''backup'')', j), 'second active backup');

  -- Promote backup.
  perform job_start(j, null);
  perform job_confirm(j, 'xpert', null);
  res := job_promote_backup(j, 'Primary is ill', null);
  if (select xpert_id from job where id = j) <> 'b1' then raise exception 'b1 should be primary'; end if;
  if (select backup_xpert_id from job where id = j) is not null then raise exception 'no backup should remain'; end if;
  if (select xpert_confirmed_at from job where id = j) is not null then raise exception 'old confirmation should be cleared'; end if;
  if (select status from assignment where job_id = j and xpert_id = 'p1') <> 'replaced' then raise exception 'p1 should be replaced, kept in history'; end if;
  if (select role from assignment where job_id = j and xpert_id = 'b1' and status = 'active') <> 'primary' then raise exception 'b1 should now hold the primary place'; end if;
  perform pg_temp.expect_fail(format('select job_promote_backup(%L, ''again'', null)', j), 'promote with no backup');
  -- Backup needed: add one.
  perform pg_temp.expect_fail(format('select job_set_backup(%L, ''b1'', null, null)', j), 'backup same as new primary');
  perform job_set_backup(j, 'b2', null, null);
  perform pg_temp.expect_fail(format('select job_set_backup(%L, ''b3'', '''', null)', j), 'changing a backup needs a reason');
  perform job_set_backup(j, 'b3', 'b2 is away', null);
  if (select count(*) from assignment where job_id = j and role = 'backup' and status = 'replaced') <> 1 then raise exception 'old backup should be kept as replaced'; end if;

  -- Completing withdraws a backup that was never needed.
  perform job_confirm(j, 'employer', null);
  perform job_confirm(j, 'xpert', null);
  if (select status from job where id = j) <> 'completed' then raise exception 'job should be completed'; end if;
  if (select status from assignment where job_id = j and xpert_id = 'b3') <> 'withdrawn' then raise exception 'unused backup should be withdrawn'; end if;
  if (select status from assignment where job_id = j and xpert_id = 'b1') <> 'completed' then raise exception 'primary should be completed'; end if;
  perform pg_temp.expect_fail(format('select job_promote_backup(%L, ''late'', null)', j), 'promote on a completed job');
end $$;

-- No show.
do $$
declare j1 uuid := pg_temp.new_job(); j2 uuid := pg_temp.new_job(); j3 uuid := pg_temp.new_job(); res jsonb;
begin
  perform job_dispatch(j1, 'n1', 'nb1', null);
  res := job_no_show(j1, null, null);
  if (res->>'promoted') <> 'nb1' or (res->>'noShowXpert') <> 'n1' then raise exception 'backup should be promoted: %', res; end if;
  if (res->>'noShowsInWindow')::int <> 1 or (res->>'limit')::int <> 2 or (res->>'windowDays')::int <> 42 then raise exception 'bad counts: %', res; end if;
  if (select status from assignment where job_id = j1 and xpert_id = 'n1') <> 'no_show' then raise exception 'n1 should be marked no_show'; end if;
  if (select xpert_id from job where id = j1) <> 'nb1' then raise exception 'nb1 should be primary'; end if;
  -- Second no show for the same Xpert inside the window reaches the limit.
  perform job_dispatch(j2, 'n1', 'nb2', null);
  res := job_no_show(j2, 'Did not answer', null);
  if (res->>'noShowsInWindow')::int <> 2 then raise exception 'second no show should count 2: %', res; end if;
  -- A no show outside the window does not count.
  update assignment set ended_at = now() - interval '60 days' where job_id = j1 and xpert_id = 'n1';
  perform job_dispatch(j3, 'n1', 'nb3', null);
  res := job_no_show(j3, null, null);
  if (res->>'noShowsInWindow')::int <> 2 then raise exception 'old no show should not count: %', res; end if;
  -- With no backup left, the job goes back to Needs an Xpert.
  res := job_no_show(j3, null, null);
  if (select status from job where id = j3) <> 'awaiting_dispatch' or (select xpert_id from job where id = j3) is not null then
    raise exception 'job should go back to awaiting dispatch';
  end if;
  if res->>'promoted' is not null then raise exception 'nobody to promote'; end if;
  perform pg_temp.expect_fail(format('select job_no_show(%L, null, null)', j3), 'no show on a job with no Xpert');
  -- It can be dispatched again with a fresh pair.
  perform job_dispatch(j3, 'q1', 'q2', null);
end $$;

-- The settings exist and are Pending. The permission is granted to ops and decision makers only.
do $$
begin
  if (select count(*) from console_config where key in ('jobs.noShowWindowDays','jobs.noShowLimit') and pending) <> 2 then raise exception 'no show settings should be Pending'; end if;
  if (select count(*) from role_permission where permission = 'dispatch.promote' and granted and role in ('ops_reviewer','decision_maker','super_admin')) <> 3 or exists (select 1 from role_permission where permission = 'dispatch.promote' and role = 'finance_approver') then raise exception 'dispatch.promote should be held by ops, decision makers and super admin only'; end if;
  if has_function_privilege('authenticated', 'job_no_show(uuid,text,uuid)', 'execute') then raise exception 'job_no_show must not be callable from the browser'; end if;
  if has_function_privilege('authenticated', 'job_promote_backup(uuid,text,uuid)', 'execute') then raise exception 'job_promote_backup must not be callable from the browser'; end if;
end $$;
\echo 0008 checks passed
