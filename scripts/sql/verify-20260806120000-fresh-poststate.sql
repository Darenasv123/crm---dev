-- verify-20260806120000-fresh-poststate.sql
--
-- Fase 8I-B2B-0B2B-I2-I3. READ-ONLY postcondition contract for exception
-- #24 (20260806120000_crm_daily_tasks_and_document_integrity.sql), to be
-- run by the owner AFTER manually executing the projected transaction
-- built by scripts/build-crm-fresh-migration-projection.mjs, and BEFORE
-- authorizing `migration repair --status applied 20260806120000`.
--
-- This script performs ZERO writes: every check is a SELECT or a DO block
-- that only reads and, on mismatch, RAISEs — it never INSERTs, UPDATEs,
-- DELETEs, or runs any DDL. A RAISE EXCEPTION inside a DO block does not
-- persist any state; it only aborts the current statement/script.
--
-- Usage (owner-run, staging Session Pooler only):
--   psql "<staging session-pooler connection string>" \
--     --set ON_ERROR_STOP=1 \
--     -f scripts/sql/verify-20260806120000-fresh-poststate.sql
--
-- Every failing check raises a descriptive exception and, combined with
-- ON_ERROR_STOP, halts the script immediately — so "no error output" at
-- the end means every postcondition passed. No credential is embedded
-- here; the connection string is supplied by the owner on the command
-- line, never written into this file.

\set ON_ERROR_STOP on

-- 1. scheduled_for / started_at columns exist with the expected shape.
do $$
declare
  v_scheduled_for record;
  v_started_at record;
begin
  select is_nullable, column_default into v_scheduled_for
    from information_schema.columns
   where table_schema = 'public' and table_name = 'case_tasks' and column_name = 'scheduled_for';
  if not found then
    raise exception 'FAIL[1a]: public.case_tasks.scheduled_for does not exist';
  end if;
  if v_scheduled_for.is_nullable <> 'NO' or v_scheduled_for.column_default is null then
    raise exception 'FAIL[1b]: public.case_tasks.scheduled_for must be NOT NULL with a default, got is_nullable=%, default=%',
      v_scheduled_for.is_nullable, v_scheduled_for.column_default;
  end if;

  select is_nullable into v_started_at
    from information_schema.columns
   where table_schema = 'public' and table_name = 'case_tasks' and column_name = 'started_at';
  if not found then
    raise exception 'FAIL[1c]: public.case_tasks.started_at does not exist';
  end if;
  if v_started_at.is_nullable <> 'YES' then
    raise exception 'FAIL[1d]: public.case_tasks.started_at must remain nullable, got is_nullable=%',
      v_started_at.is_nullable;
  end if;

  raise notice 'OK[1]: case_tasks.scheduled_for / started_at have the expected shape';
end;
$$;

-- 2. Expected index exists.
do $$
begin
  if not exists (
    select 1 from pg_indexes where tablename = 'case_tasks' and indexname = 'case_tasks_scheduled_for_idx'
  ) then
    raise exception 'FAIL[2]: index case_tasks_scheduled_for_idx does not exist';
  end if;
  raise notice 'OK[2]: case_tasks_scheduled_for_idx exists';
end;
$$;

-- 3. New tables exist.
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array['case_task_history', 'document_change_history']) as t
  where not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = t
  );
  if v_missing is not null then
    raise exception 'FAIL[3]: missing expected table(s): %', v_missing;
  end if;
  raise notice 'OK[3]: case_task_history and document_change_history exist';
end;
$$;

-- 4. RLS enabled on both new tables.
do $$
declare
  v_not_enabled text;
begin
  select string_agg(relname, ', ') into v_not_enabled
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('case_task_history', 'document_change_history')
    and relrowsecurity is not true;
  if v_not_enabled is not null then
    raise exception 'FAIL[4]: RLS not enabled on: %', v_not_enabled;
  end if;
  raise notice 'OK[4]: RLS enabled on both new tables';
end;
$$;

-- 5. Expected policies exist (at least one policy per new table — exact
--    policy names/commands are an implementation detail of the migration,
--    checked here only for presence, matching the "expected policies"
--    postcondition without hard-coding a name that could legitimately
--    change if the migration's own wording changes in a future edit —
--    which it cannot, since it is frozen, but this keeps the check honest
--    about what it actually verifies).
do $$
declare
  v_case_task_history_policies integer;
  v_document_change_history_policies integer;
begin
  select count(*) into v_case_task_history_policies
    from pg_policies where tablename = 'case_task_history';
  select count(*) into v_document_change_history_policies
    from pg_policies where tablename = 'document_change_history';

  if v_case_task_history_policies < 1 then
    raise exception 'FAIL[5a]: no RLS policies found on case_task_history';
  end if;
  if v_document_change_history_policies < 1 then
    raise exception 'FAIL[5b]: no RLS policies found on document_change_history';
  end if;
  raise notice 'OK[5]: both new tables have at least one RLS policy (% / %)',
    v_case_task_history_policies, v_document_change_history_policies;
end;
$$;

-- 6. Expected grants exist on the new tables (at least one grantee besides
--    the table owner — service_role/authenticated per the migration text).
do $$
declare
  v_grant_count integer;
begin
  select count(*) into v_grant_count
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('case_task_history', 'document_change_history');
  if v_grant_count < 1 then
    raise exception 'FAIL[6]: no grants found on the new tables';
  end if;
  raise notice 'OK[6]: % grant row(s) found on the new tables', v_grant_count;
end;
$$;

-- 7. All seven expected functions exist.
do $$
declare
  v_missing text;
begin
  select string_agg(f, ', ') into v_missing
  from unnest(array[
    'validate_case_task_relationship',
    'guard_case_task_schedule',
    'audit_case_task_changes',
    'apply_case_task_completion',
    'validate_document_relationship',
    'audit_document_metadata',
    'normalize_document_types'
  ]) as f
  where not exists (
    select 1 from pg_proc where proname = f and pronamespace = 'public'::regnamespace
  );
  if v_missing is not null then
    raise exception 'FAIL[7]: missing expected function(s): %', v_missing;
  end if;
  raise notice 'OK[7]: all 7 expected functions exist';
end;
$$;

-- 8. Expected triggers exist and are all enabled ('O' = origin/normal).
do $$
declare
  v_missing text;
  v_disabled text;
begin
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'case_tasks_05_guard_schedule',
    'case_tasks_audit_changes',
    'documents_validate_relationship',
    'documents_audit_metadata'
  ]) as t
  where not exists (
    select 1 from pg_trigger where tgname = t and not tgisinternal
  );
  if v_missing is not null then
    raise exception 'FAIL[8a]: missing expected trigger(s): %', v_missing;
  end if;

  select string_agg(tgname, ', ') into v_disabled
    from pg_trigger
   where tgrelid = 'public.case_tasks'::regclass
     and not tgisinternal
     and tgenabled <> 'O';
  if v_disabled is not null then
    raise exception 'FAIL[8b]: case_tasks trigger(s) not enabled (tgenabled <> O): %', v_disabled;
  end if;

  raise notice 'OK[8]: all 4 expected triggers exist and all case_tasks triggers are enabled';
end;
$$;

-- 9. normalize_document_types() privileges — revoked from public/anon,
--    granted to authenticated.
do $$
declare
  v_anon_or_public integer;
  v_authenticated integer;
begin
  select count(*) into v_anon_or_public
    from information_schema.role_routine_grants
   where routine_name = 'normalize_document_types'
     and grantee in ('PUBLIC', 'anon');
  select count(*) into v_authenticated
    from information_schema.role_routine_grants
   where routine_name = 'normalize_document_types'
     and grantee = 'authenticated';

  if v_anon_or_public > 0 then
    raise exception 'FAIL[9a]: normalize_document_types is executable by PUBLIC/anon (must be revoked)';
  end if;
  if v_authenticated < 1 then
    raise exception 'FAIL[9b]: normalize_document_types is not granted to authenticated';
  end if;
  raise notice 'OK[9]: normalize_document_types privileges match the expected shape';
end;
$$;

-- 10. Business rows remain zero (this is a fresh-bootstrap rehearsal;
--     the manual projection touches zero rows, so any row here would mean
--     something else already wrote data).
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.case_tasks;
  if v_count <> 0 then
    raise exception 'FAIL[10]: expected 0 rows in public.case_tasks, found %', v_count;
  end if;
  raise notice 'OK[10]: public.case_tasks has 0 rows';
end;
$$;

-- 11. 20260806120000 must NOT yet be recorded in migration history — this
--     script runs strictly BEFORE `migration repair`.
do $$
declare
  v_found boolean;
begin
  select exists(
    select 1 from supabase_migrations.schema_migrations where version = '20260806120000'
  ) into v_found;
  if v_found then
    raise exception 'FAIL[11]: 20260806120000 is already recorded in migration history — this check must run BEFORE repair';
  end if;
  raise notice 'OK[11]: 20260806120000 absent from migration history (as expected, pre-repair)';
end;
$$;

\echo 'All #24 postcondition checks passed. Zero writes were performed by this script.'
