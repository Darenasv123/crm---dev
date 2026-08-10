-- Read-only post-bootstrap verification. Run after 0001..0007 on an empty DB.

begin transaction read only;

with
critical_columns(table_name, column_name) as (
  values
    ('profiles','role'), ('profiles','status'),
    ('documents','client_id'), ('documents','case_id'),
    ('documents','relative_path'), ('documents','content_hash'),
    ('documents','folder_id'), ('documents','verification_status'),
    ('case_tasks','scheduled_for'), ('case_tasks','started_at'),
    ('case_tasks','completed_at'), ('case_tasks','completed_by'),
    ('case_tasks','claimed_at'), ('case_tasks','claimed_by'),
    ('agenda_events','google_event_id'), ('agenda_events','google_calendar_id')
),
missing_critical_columns as (
  select c.* from critical_columns c
  where not exists (
    select 1 from information_schema.columns x
    where x.table_schema = 'public'
      and x.table_name = c.table_name
      and x.column_name = c.column_name
  )
),
operational_rows(total) as (
  select
    (select count(*) from public.profiles) +
    (select count(*) from public.clients) +
    (select count(*) from public.cases) +
    (select count(*) from public.payments) +
    (select count(*) from public.payment_records) +
    (select count(*) from public.agenda_events) +
    (select count(*) from public.document_folders) +
    (select count(*) from public.documents) +
    (select count(*) from public.client_reports) +
    (select count(*) from public.case_parties) +
    (select count(*) from public.document_extractions) +
    (select count(*) from public.case_events) +
    (select count(*) from public.case_tasks) +
    (select count(*) from public.import_jobs) +
    (select count(*) from public.import_folders) +
    (select count(*) from public.ai_analysis_runs) +
    (select count(*) from public.ai_findings) +
    (select count(*) from public.source_references) +
    (select count(*) from public.case_task_history) +
    (select count(*) from public.document_change_history) +
    (select count(*) from public.google_calendar_connections) +
    (select count(*) from public.google_calendar_channels) +
    (select count(*) from public.google_calendar_sync_log) +
    (select count(*) from public.google_calendar_oauth_states) +
    (select count(*) from public.google_calendar_sync_requests)
),
checks(check_name, expected, actual, passed) as (
  select 'PostgreSQL major version', '17', (current_setting('server_version_num')::integer / 10000)::text,
         current_setting('server_version_num')::integer between 170000 and 179999
  union all
  select 'public tables', '25', count(*)::text, count(*) = 25
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
  union all
  select 'public views', '0', count(*)::text, count(*) = 0
  from information_schema.views where table_schema = 'public'
  union all
  select 'core PL/pgSQL language', '1', count(*)::text, count(*) = 1
  from pg_language where lanname = 'plpgsql'
  union all
  select 'core gen_random_uuid()', '1', count(*)::text, count(*) = 1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'pg_catalog' and p.proname = 'gen_random_uuid'
    and pg_get_function_identity_arguments(p.oid) = ''
  union all
  select 'public functions', '21', count(*)::text, count(*) = 21
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'public triggers', '23', count(*)::text, count(*) = 23
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  union all
  select 'custom auth triggers', '1', count(*)::text, count(*) = 1
  from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
  union all
  select 'public policies', '78', count(*)::text, count(*) = 78
  from pg_policies where schemaname = 'public'
  union all
  select 'Storage policies', '4', count(*)::text, count(*) = 4
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
  union all
  select 'public indexes including PK/UNIQUE', '71', count(*)::text, count(*) = 71
  from pg_indexes where schemaname = 'public'
  union all
  select 'public constraints', '125', count(*)::text, count(*) = 125
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  union all
  select 'primary keys', '25', count(*)::text, count(*) = 25
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'p'
  union all
  select 'foreign keys', '59', count(*)::text, count(*) = 59
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'f'
  union all
  select 'CHECK constraints', '39', count(*)::text, count(*) = 39
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'c'
  union all
  select 'UNIQUE constraints', '2', count(*)::text, count(*) = 2
  from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'u'
  union all
  select 'tables with RLS', '25', count(*)::text, count(*) = 25
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  union all
  select 'missing critical columns', '0', count(*)::text, count(*) = 0
  from missing_critical_columns
  union all
  select 'case-task guard triggers', '1', count(*)::text, count(*) = 1
  from pg_trigger t
  where t.tgrelid = 'public.case_tasks'::regclass and not t.tgisinternal
    and t.tgfoid = 'public.guard_case_task_update()'::regprocedure
  union all
  select 'obsolete duplicate task guard', '0', count(*)::text, count(*) = 0
  from pg_trigger t where t.tgrelid = 'public.case_tasks'::regclass
    and t.tgname = 'guard_case_task_update_trigger'
  union all
  select 'required RPCs', '4', count(*)::text, count(*) = 4
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'claim_case_task', 'return_case_task',
    'normalize_document_types', 'register_payment_record_atomic'
  )
  union all
  select 'secure signup role assignment', '0 role-metadata references',
         case when pg_get_functiondef('public.handle_new_user()'::regprocedure)
                   ~* $$raw_user_meta_data\s*->>?\s*'role'$$ then '1' else '0' end,
         pg_get_functiondef('public.handle_new_user()'::regprocedure)
           !~* $$raw_user_meta_data\s*->>?\s*'role'$$
  union all
  select 'Auth profile trigger', 'on_auth_user_created', coalesce(string_agg(t.tgname, ', '), '<missing>'),
         count(*) = 1 and bool_and(t.tgfoid = 'public.handle_new_user()'::regprocedure)
  from pg_trigger t
  where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
  union all
  select 'private documents bucket', 'private',
         coalesce((select case when b.public then 'public' else 'private' end from storage.buckets b where b.id = 'documents'), '<missing>'),
         exists (select 1 from storage.buckets b where b.id = 'documents' and not b.public)
  union all
  select 'bucket limit policy', 'unrestricted/null',
         coalesce((select concat_ws('/', b.file_size_limit::text, array_to_string(b.allowed_mime_types, ',')) from storage.buckets b where b.id = 'documents'), '<null>'),
         exists (select 1 from storage.buckets b where b.id = 'documents' and b.file_size_limit is null and b.allowed_mime_types is null)
  union all
  select 'anon public-table grants', '0', count(*)::text, count(*) = 0
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
  union all
  select 'PUBLIC function EXECUTE grants', '0', count(*)::text, count(*) = 0
  from information_schema.routine_privileges
  where routine_schema = 'public' and grantee = 'PUBLIC' and privilege_type = 'EXECUTE'
  union all
  select 'authenticated canonical RPC grants', '8', count(*)::text, count(*) = 8
  from information_schema.routine_privileges
  where routine_schema = 'public' and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  union all
  select 'service_role public-table grants', '25 tables', count(distinct table_name)::text,
         count(distinct table_name) = 25
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'service_role'
  union all
  select 'cleanup backup schemas/objects', '0', count(*)::text, count(*) = 0
  from (
    select n.nspname as object_name from pg_namespace n
    where n.nspname ilike 'cleanup_backup%'
    union all
    select c.relname from pg_class c
    where c.relname ilike '%backup_verified%'
    union all
    select p.proname from pg_proc p
    where p.proname ilike '%backup_verified%'
  ) cleanup_objects
  union all
  select 'operational rows', '0', total::text, total = 0 from operational_rows
)
select case when passed then 'PASS' else 'FAIL' end as result,
       check_name, expected, actual
from checks
order by passed, check_name;

commit;
