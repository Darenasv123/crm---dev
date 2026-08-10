\set ON_ERROR_STOP on

select version() as postgres_version;

do $$
declare
  v_crm_tables text;
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'RUNTIME_MISMATCH: PostgreSQL 17.x is required; found %',
      current_setting('server_version');
  end if;

  if to_regclass('auth.users') is null
     or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Auth/Storage base objects are missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Supabase API roles are missing';
  end if;

  if not exists (select 1 from pg_language where lanname = 'plpgsql')
     or to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'Required PostgreSQL 17 core capabilities are missing';
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into v_crm_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname = any (array[
      'profiles', 'clients', 'cases', 'payments', 'payment_records',
      'agenda_events', 'document_folders', 'documents', 'client_reports',
      'case_parties', 'document_extractions', 'case_events', 'case_tasks',
      'import_jobs', 'import_folders', 'ai_analysis_runs', 'ai_findings',
      'source_references', 'case_task_history', 'document_change_history',
      'google_calendar_connections', 'google_calendar_channels',
      'google_calendar_sync_log', 'google_calendar_oauth_states',
      'google_calendar_sync_requests'
    ]);

  if v_crm_tables is not null then
    raise exception 'CRM tables already exist before bootstrap: %', v_crm_tables;
  end if;
end;
$$;

select
  current_setting('server_version') as server_version,
  (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) as api_roles,
  to_regclass('auth.users') is not null as auth_ready,
  to_regclass('storage.objects') is not null as storage_objects_ready,
  to_regclass('storage.buckets') is not null as storage_buckets_ready,
  to_regprocedure('pg_catalog.gen_random_uuid()') is not null as uuid_ready;
