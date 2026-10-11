-- Structural checks that must hold for every table in public, whatever phase added it.
-- status_history, audit_log and role_permission are exempt from the audit and no delete triggers:
-- the first two are append only history, and role_permission is managed only through the Roles screen.
-- Raises an error naming the table if any rule is broken. Run after all migrations.
do $$
declare t record; problems text := '';
begin
  for t in
    select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not t.relrowsecurity then problems := problems || format('%s: row level security is off. ', t.relname); end if;
    if has_table_privilege('anon', format('public.%I', t.relname), 'select,insert,update,delete') then
      problems := problems || format('%s: anon has access. ', t.relname);
    end if;
    if has_table_privilege('authenticated', format('public.%I', t.relname), 'insert,update,delete') then
      problems := problems || format('%s: browser role can write. ', t.relname);
    end if;
    if t.relname <> 'audit_log' and not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t.relname)::regclass and g.tgname like '%no_delete%' and not g.tgisinternal)
       and t.relname not in ('role_permission', 'status_history') then
      problems := problems || format('%s: hard delete is not blocked. ', t.relname);
    end if;
    if t.relname not in ('audit_log', 'role_permission', 'status_history') and not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t.relname)::regclass and g.tgname like '%audit%' and not g.tgisinternal) then
      problems := problems || format('%s: no audit trigger. ', t.relname);
    end if;
  end loop;

  -- Every server side function that changes data must be closed to browser roles.
  for t in
    select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname not in ('has_permission', 'current_staff_role', 'is_active_staff')
  loop
    if has_function_privilege('authenticated', t.oid, 'execute') or has_function_privilege('anon', t.oid, 'execute') then
      problems := problems || format('function %s is callable from the browser. ', t.proname);
    end if;
  end loop;

  if problems <> '' then raise exception 'Hardening check failed: %', problems; end if;
  raise notice 'Hardening check passed';
end $$;
