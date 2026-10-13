-- Checks for 0011 (second factor for super_admin and decision_maker, inside the database). Raises on any failure.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-0000000b0001','sa@x.com'), ('00000000-0000-0000-0000-0000000b0002','dm@x.com'),
  ('00000000-0000-0000-0000-0000000b0003','ops@x.com'), ('00000000-0000-0000-0000-0000000b0004','fin@x.com');
insert into staff_profile(user_id,email,full_name,role) values
  ('00000000-0000-0000-0000-0000000b0001','sa@x.com','SA','super_admin'),
  ('00000000-0000-0000-0000-0000000b0002','dm@x.com','DM','decision_maker'),
  ('00000000-0000-0000-0000-0000000b0003','ops@x.com','OPS','ops_reviewer'),
  ('00000000-0000-0000-0000-0000000b0004','fin@x.com','FIN','finance_approver');

-- Sets who is signed in and how, the way Supabase does: sub for the user, claims for the token body.
create or replace function pg_temp.as_user(uid text, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', case when aal is null then '' else json_build_object('sub', uid, 'aal', aal)::text end, false);
end $$;

do $$
declare sa text := '00000000-0000-0000-0000-0000000b0001'; dm text := '00000000-0000-0000-0000-0000000b0002';
        ops text := '00000000-0000-0000-0000-0000000b0003'; fin text := '00000000-0000-0000-0000-0000000b0004';
begin
  -- Which roles need it.
  if not (role_requires_mfa('super_admin') and role_requires_mfa('decision_maker')) then raise exception 'super_admin and decision_maker need mfa'; end if;
  if role_requires_mfa('ops_reviewer') or role_requires_mfa('finance_approver') then raise exception 'ops and finance do not need mfa yet'; end if;

  -- Super admin: nothing at the password step, everything after the code.
  perform pg_temp.as_user(sa, 'aal1');
  if has_permission('quotes.read') then raise exception 'super_admin at aal1 must have no permissions'; end if;
  if is_active_staff() then raise exception 'super_admin at aal1 must not count as active staff'; end if;
  perform pg_temp.as_user(sa, 'aal2');
  if not has_permission('quotes.read') then raise exception 'super_admin at aal2 should have permissions'; end if;
  if not is_active_staff() then raise exception 'super_admin at aal2 should count as active staff'; end if;

  -- Decision maker, same.
  perform pg_temp.as_user(dm, 'aal1');
  if has_permission('xperts.status.decide') or is_active_staff() then raise exception 'decision_maker at aal1 must have nothing'; end if;
  perform pg_temp.as_user(dm, 'aal2');
  if not has_permission('xperts.status.decide') or not is_active_staff() then raise exception 'decision_maker at aal2 should be allowed'; end if;

  -- Ops and finance are not asked for a code, so their password session works as before.
  perform pg_temp.as_user(ops, 'aal1');
  if not has_permission('xperts.read') or not is_active_staff() then raise exception 'ops_reviewer at aal1 should work'; end if;
  perform pg_temp.as_user(fin, 'aal1');
  if not has_permission('payments.record') or not is_active_staff() then raise exception 'finance_approver at aal1 should work'; end if;

  -- Missing, empty or odd claims count as the weaker level, and never raise.
  perform pg_temp.as_user(sa, null);
  if has_permission('quotes.read') then raise exception 'no claims must not count as aal2'; end if;
  perform set_config('request.jwt.claims', '{"sub":"x"}', false);
  if has_permission('quotes.read') then raise exception 'a token with no aal must not count as aal2'; end if;
  perform set_config('request.jwt.claims', '{"aal":"aal3"}', false);
  if has_permission('quotes.read') then raise exception 'an unknown level must not count as aal2'; end if;
  perform set_config('request.jwt.claims', '{"aal":"AAL2"}', false);
  if has_permission('quotes.read') then raise exception 'the level is matched exactly'; end if;

  -- A deactivated super admin has nothing even at aal2.
  perform pg_temp.as_user(sa, 'aal2');
  reset role;
  update staff_profile set is_active = false where user_id = sa::uuid;
  if has_permission('quotes.read') then raise exception 'a deactivated account must have nothing'; end if;
  update staff_profile set is_active = true where user_id = sa::uuid;
end $$;

-- The new column starts empty, can be stamped, and the change is audited.
do $$
declare b int; a int;
begin
  if (select count(*) from staff_profile where mfa_enrolled_at is not null) <> 0 then raise exception 'mfa_enrolled_at should start empty'; end if;
  select count(*) into b from audit_log where entity_type = 'staff_profile';
  update staff_profile set mfa_enrolled_at = now(), change_reason = 'First sign in with an authenticator code' where user_id = '00000000-0000-0000-0000-0000000b0001';
  select count(*) into a from audit_log where entity_type = 'staff_profile';
  if a <= b then raise exception 'stamping mfa_enrolled_at must be audited'; end if;
end $$;

-- The helpers are not open to the public or anonymous browser role.
do $$
begin
  if has_function_privilege('anon', 'public.is_aal2()', 'execute') then raise exception 'anon must not run is_aal2'; end if;
  if has_function_privilege('anon', 'public.role_requires_mfa(text)', 'execute') then raise exception 'anon must not run role_requires_mfa'; end if;
end $$;
\echo test_0011 passed
