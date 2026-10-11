-- Run ONCE, after migration 0001, to create the first super admin.
--
-- 1. In the Supabase dashboard go to Authentication, Users, and invite or add the
--    person who will own the console. Use an email address that is NOT used by an
--    employer on the main site.
-- 2. Replace the two values below, then run this in the SQL editor.
--
-- After this, that person signs in to the console and invites everyone else from
-- the Staff screen.

insert into public.staff_profile (user_id, email, full_name, role, change_reason)
select u.id, u.email, 'REPLACE WITH FULL NAME', 'super_admin', 'First super admin'
from auth.users u
where lower(u.email) = lower('REPLACE_WITH_EMAIL@example.com');
