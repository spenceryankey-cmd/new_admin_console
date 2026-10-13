-- 0011_mfa.sql
-- NOT APPLIED. Run after 0010. Additive: one new column and two new functions, and two existing helper
-- functions are replaced (create or replace) so they also look at how the person signed in.
--
-- Super admins and decision makers must sign in with a password AND an authenticator app code (Supabase calls
-- this assurance level aal2). The API already refuses them everywhere until the code is entered. This migration
-- repeats the rule inside the database, so a browser session that only passed the password step cannot read or
-- write through Supabase directly either.
--
--   role_requires_mfa(role)  the roles that need the code. Keep equal to MFA_REQUIRED_ROLES in packages/shared/src/mfa.ts
--                            (a test compares the two).
--   is_aal2()                true when the current token says aal2. Supabase puts "aal" in the token claims.
--   has_permission(p)        now false for those roles until is_aal2().
--   is_active_staff()        same.
--   staff_profile.mfa_enrolled_at  when the person first signed in with a code. For reporting. The API sets it.
--
-- The secrets of the authenticator app stay inside Supabase Auth. Nothing about them is stored here.
-- The API uses the service role, which skips row level security, so the API enforces the same rule in AuthGuard.

begin;

alter table public.staff_profile add column mfa_enrolled_at timestamptz;

create or replace function public.role_requires_mfa(r text) returns boolean
language sql immutable as $$
  select r in ('super_admin', 'decision_maker');
$$;

create or replace function public.is_aal2() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.staff_profile sp
    where sp.user_id = auth.uid()
      and sp.is_active
      and (not public.role_requires_mfa(sp.role) or public.is_aal2())
      and (
        sp.role = 'super_admin'
        or exists (
          select 1 from public.role_permission rp
          where rp.role = sp.role and rp.permission = p and rp.granted
        )
      )
  );
$$;

create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.staff_profile sp
    where sp.user_id = auth.uid()
      and sp.is_active
      and (not public.role_requires_mfa(sp.role) or public.is_aal2())
  );
$$;

revoke execute on function public.role_requires_mfa(text), public.is_aal2() from public, anon;
grant execute on function public.role_requires_mfa(text), public.is_aal2() to authenticated;

commit;
