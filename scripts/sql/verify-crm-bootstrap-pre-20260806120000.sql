-- verify-crm-bootstrap-pre-20260806120000.sql
--
-- Fase 8I-B2B-0B2B-I2-R3/I3. READ-ONLY empirical verification, to be run
-- by the owner against CRM Drive Staging BEFORE any manual execution of
-- the #24 projection. Confirms (a) the currently-recorded migration
-- history matches what R2/R3 expected, (b) 20260806120000 is absent from
-- history, (c) the previously-failed attempt against this migration left
-- no partial schema/data behind (full-rollback expectation from R3
-- Section D), and (d) every business table is still empty.
--
-- Performs ZERO writes. No credential is embedded — the connection string
-- is supplied by the owner on the psql command line.
--
-- Usage:
--   psql "<staging session-pooler connection string>" \
--     --set ON_ERROR_STOP=1 \
--     -f scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql

\set ON_ERROR_STOP on

-- A. Identity — confirm which database/user this actually is before
--    trusting any of the checks below.
select current_database() as db, current_user as usr;

-- B. Migration history: count, bounds, last 8 versions.
select count(*) as remote_count,
       min(version) as first_version,
       max(version) as last_version
from supabase_migrations.schema_migrations;

select version from supabase_migrations.schema_migrations
order by version desc
limit 8;

-- C. 20260806120000 must be absent.
do $$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260806120000'
  ) then
    raise exception 'FAIL[C]: 20260806120000 is already recorded in migration history';
  end if;
  raise notice 'OK[C]: 20260806120000 absent from migration history';
end;
$$;

-- D. Rollback of the previously-failed attempt: none of its schema
--    changes should be present.
do $$
declare
  v_cols text;
  v_tables text;
  v_functions text;
  v_triggers text;
begin
  select string_agg(column_name, ', ') into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'case_tasks'
     and column_name in ('scheduled_for', 'started_at');
  if v_cols is not null then
    raise exception 'FAIL[D1]: case_tasks already has column(s) that only 20260806120000 should add: %', v_cols;
  end if;

  select string_agg(table_name, ', ') into v_tables
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('case_task_history', 'document_change_history');
  if v_tables is not null then
    raise exception 'FAIL[D2]: table(s) that only 20260806120000 should create already exist: %', v_tables;
  end if;

  select string_agg(proname, ', ') into v_functions
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in (
       'validate_case_task_relationship', 'guard_case_task_schedule',
       'audit_case_task_changes', 'apply_case_task_completion',
       'validate_document_relationship', 'audit_document_metadata',
       'normalize_document_types'
     );
  if v_functions is not null then
    raise exception 'FAIL[D3]: function(s) that only 20260806120000 should create already exist: %', v_functions;
  end if;

  select string_agg(tgname, ', ') into v_triggers
    from pg_trigger
   where tgrelid = 'public.case_tasks'::regclass
     and not tgisinternal
     and tgname in ('case_tasks_05_guard_schedule', 'case_tasks_audit_changes');
  if v_triggers is not null then
    raise exception 'FAIL[D4]: trigger(s) that only 20260806120000 should create already exist: %', v_triggers;
  end if;

  raise notice 'OK[D]: no trace of the previously-failed attempt survived — full rollback confirmed';
end;
$$;

-- E. All business row counts remain zero.
do $$
declare
  v_nonzero text;
begin
  select string_agg(t || '=' || c, ', ') into v_nonzero
  from (
    select 'profiles' as t, (select count(*) from public.profiles) as c
    union all select 'clients', (select count(*) from public.clients)
    union all select 'cases', (select count(*) from public.cases)
    union all select 'case_tasks', (select count(*) from public.case_tasks)
    union all select 'documents', (select count(*) from public.documents)
    union all select 'client_reports', (select count(*) from public.client_reports)
    union all select 'payments', (select count(*) from public.payments)
    union all select 'payment_records', (select count(*) from public.payment_records)
  ) counts
  where c <> 0;

  if v_nonzero is not null then
    raise exception 'FAIL[E]: expected all business tables at 0 rows, found nonzero: %', v_nonzero;
  end if;
  raise notice 'OK[E]: all business tables have 0 rows';
end;
$$;

\echo 'All pre-20260806120000 checks passed. Zero writes were performed by this script.'
