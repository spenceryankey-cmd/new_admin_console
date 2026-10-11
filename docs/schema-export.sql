-- Read only. Run each query in the Supabase SQL editor of the PRODUCTION project and
-- send the results (CSV or a screenshot) to the console team. No row data is read.

-- 1. Every table and column
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 2. Primary and foreign keys
select tc.table_name, tc.constraint_type, kcu.column_name,
       ccu.table_name as references_table, ccu.column_name as references_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
left join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')
order by tc.table_name;

-- 3. Row level security: which tables have it on, and the policies
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public';

-- 4. Triggers and enum types
select event_object_table as table_name, trigger_name, event_manipulation, action_timing
from information_schema.triggers where trigger_schema = 'public' order by 1, 2;

select t.typname as enum_name, e.enumlabel as value
from pg_type t join pg_enum e on e.enumtypid = t.oid
order by t.typname, e.enumsortorder;
