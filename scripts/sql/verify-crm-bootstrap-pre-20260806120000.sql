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

-- B. Migration history: count, bounds, last 8 versions (informational).
select count(*) as remote_count,
       min(version) as first_version,
       max(version) as last_version
from supabase_migrations.schema_migrations;

select version from supabase_migrations.schema_migrations
order by version desc
limit 8;

-- B'. Migration history assertion (enforced, not just displayed).
do $$
declare
  v_count integer;
  v_first text;
  v_last text;
begin
  select count(*), min(version), max(version)
    into v_count, v_first, v_last
    from supabase_migrations.schema_migrations;

  if v_count <> 23 then
    raise exception 'FAIL[B1]: expected 23 applied migrations, found %', v_count;
  end if;
  if v_first <> '20260713120000' then
    raise exception 'FAIL[B2]: expected first applied version 20260713120000, found %', v_first;
  end if;
  if v_last <> '20260730210000' then
    raise exception 'FAIL[B3]: expected last applied version 20260730210000, found %', v_last;
  end if;

  raise notice 'OK[B]: history is exactly 23 versions, 20260713120000..20260730210000';
end;
$$;

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

-- D1/D2. Rollback of the previously-failed attempt: the new columns and
--    tables introduced by 20260806120000 must not be present.
do $$
declare
  v_cols text;
  v_tables text;
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

  raise notice 'OK[D1_D2]: neither the new columns nor the new tables from 20260806120000 exist yet';
end;
$$;

-- D3. Functions. IMPORTANT — this is NOT "all seven functions referenced
--   by 20260806120000 must be absent". Two of them predate that
--   migration entirely:
--
--     public.validate_case_task_relationship() and
--     public.apply_case_task_completion()
--
--   are both introduced by 20260729130000_daily_task_center.sql (git-grep
--   confirms these two names appear in exactly two tracked migrations:
--   20260729130000, which creates them, and 20260806120000, which later
--   `create or replace`s them). On this prestate — after 20260729130000
--   applied normally and before 20260806120000 has ever run — both MUST
--   exist, in their PRE-#24 form. Requiring them absent was the original
--   defect: it produced a false FAIL on a database that is actually in
--   the correct, expected prestate.
--
--   To distinguish the PRE-#24 body from the POST-#24 replacement body
--   without depending on pg_get_functiondef()'s exact whitespace
--   formatting (which this script has no independent way to verify ahead
--   of time), each check uses a semantic content predicate derived
--   directly from reading both migration sources side by side:
--
--     apply_case_task_completion(): the #24 body assigns
--       `new.started_at := ...` — a column #24 itself adds, so the
--       pre-#24 body cannot and does not reference `started_at` at all.
--       Presence of that identifier is therefore POST-#24-only.
--
--     validate_case_task_relationship(): the #24 body auto-fills
--       `new.client_id := v_case_client_id` when client_id is null; the
--       pre-#24 body never performs this assignment (it only raises on
--       an explicit mismatch, never invents a value). Presence of that
--       assignment is therefore POST-#24-only.
--
--   prosecdef is also checked as a cheap corroborating signal (unchanged
--   by #24's replacement in both cases), not as the primary distinguisher.
do $$
declare
  v_apply_def text;
  v_apply_prosecdef boolean;
  v_validate_def text;
  v_validate_prosecdef boolean;
  v_new_functions text;
begin
  select pg_get_functiondef(p.oid), p.prosecdef
    into v_apply_def, v_apply_prosecdef
    from pg_proc p
   where p.proname = 'apply_case_task_completion' and p.pronamespace = 'public'::regnamespace;
  if v_apply_def is null then
    raise exception 'FAIL[D3a]: public.apply_case_task_completion() does not exist. It must already exist at this prestate (introduced by 20260729130000, not by 20260806120000).';
  end if;
  if v_apply_prosecdef is distinct from false then
    raise exception 'FAIL[D3a]: apply_case_task_completion() has prosecdef=%, expected false (matches both the pre- and post-#24 definitions, checked here as a corroborating signal only)', v_apply_prosecdef;
  end if;
  if v_apply_def ilike '%started_at%' then
    raise exception 'FAIL[D3a]: apply_case_task_completion() already references started_at — this is the POST-#24 replacement body. 20260806120000 must not have executed yet.';
  end if;

  select pg_get_functiondef(p.oid), p.prosecdef
    into v_validate_def, v_validate_prosecdef
    from pg_proc p
   where p.proname = 'validate_case_task_relationship' and p.pronamespace = 'public'::regnamespace;
  if v_validate_def is null then
    raise exception 'FAIL[D3b]: public.validate_case_task_relationship() does not exist. It must already exist at this prestate (introduced by 20260729130000, not by 20260806120000).';
  end if;
  if v_validate_prosecdef is distinct from true then
    raise exception 'FAIL[D3b]: validate_case_task_relationship() has prosecdef=%, expected true', v_validate_prosecdef;
  end if;
  if v_validate_def ~ 'new\.client_id\s*:=\s*v_case_client_id' then
    raise exception 'FAIL[D3b]: validate_case_task_relationship() already auto-fills client_id — this is the POST-#24 replacement body. 20260806120000 must not have executed yet.';
  end if;

  select string_agg(proname, ', ') into v_new_functions
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in (
       'guard_case_task_schedule', 'audit_case_task_changes',
       'validate_document_relationship', 'audit_document_metadata',
       'normalize_document_types'
     );
  if v_new_functions is not null then
    raise exception 'FAIL[D3c]: #24-only function(s) already exist: %', v_new_functions;
  end if;

  raise notice 'OK[D3]: both pre-existing functions (validate_case_task_relationship, apply_case_task_completion) are present in their PRE-#24 form; all 5 #24-only functions are absent';
end;
$$;

-- D4. Triggers introduced only by 20260806120000 must not exist yet
--    (20260729130000's own triggers use different names entirely —
--    case_tasks_validate_relationship, case_tasks_10_apply_completion,
--    case_tasks_20_guard_update, case_tasks_log_event — none of which
--    collide with the four checked below).
do $$
declare
  v_triggers text;
begin
  select string_agg(tgname, ', ') into v_triggers
    from pg_trigger
   where tgrelid = 'public.case_tasks'::regclass
     and not tgisinternal
     and tgname in ('case_tasks_05_guard_schedule', 'case_tasks_audit_changes');
  if v_triggers is not null then
    raise exception 'FAIL[D4]: trigger(s) that only 20260806120000 should create already exist: %', v_triggers;
  end if;

  raise notice 'OK[D4]: no #24-only trigger exists yet';
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

do $$
begin
  raise notice 'REMOTE_ROLLBACK_VERIFICATION = CONFIRMED';
end;
$$;

\echo 'All pre-20260806120000 checks passed. Zero writes were performed by this script.'
