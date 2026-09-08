-- verify-crm-security-prerequisite-poststate.sql
--
-- Fase 8I-B2B-0B2B-I2-E2C. READ-ONLY postcondition contract for exception
-- #4, to be run by the owner AFTER manually executing the temp SQL
-- produced by scripts/build-crm-fresh-security-prerequisite-projection.mjs
-- against CRM Drive Staging, and BEFORE resuming `db push` at
-- 20260822110000.
--
-- This script performs ZERO writes and NEVER invokes claim_case_task(),
-- return_case_task(), or mutates public.case_tasks in any way — it only
-- inspects catalog metadata (pg_proc/pg_trigger/has_function_privilege)
-- for the three latent 20260811103000 objects, never calls them.
--
-- Usage (owner-run, staging Session Pooler only):
--   psql "<staging session-pooler connection string>" \
--     --set ON_ERROR_STOP=1 \
--     -f scripts/sql/verify-crm-security-prerequisite-poststate.sql

\set ON_ERROR_STOP on

-- A. Migration history unchanged by this prerequisite (still exactly 28;
--    this artifact is never adopted via `migration repair` — it isn't a
--    versioned migration).
do $$
declare
  v_count integer;
  v_last text;
begin
  select count(*), max(version) into v_count, v_last
    from supabase_migrations.schema_migrations;

  if v_count <> 28 then
    raise exception 'FAIL[A1]: expected migration history to remain at 28, found %', v_count;
  end if;
  if v_last <> '20260822100000' then
    raise exception 'FAIL[A2]: expected last applied version to remain 20260822100000, found %', v_last;
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260822110000'
  ) then
    raise exception 'FAIL[A3]: 20260822110000 must still be absent -- it is applied via a normal db push after this prerequisite, never via repair';
  end if;

  raise notice 'OK[A]: migration history unchanged (28, last=20260822100000, 20260822110000 still absent)';
end;
$$;

-- B. Both target functions now exist with the exact expected shape.
do $$
declare
  v_missing text;
  v_bad_shape text;
begin
  select string_agg(f, ', ') into v_missing
  from unnest(array['crm_is_active_staff', 'crm_is_active_admin']) as f
  where to_regprocedure('public.' || f || '()') is null;
  if v_missing is not null then
    raise exception 'FAIL[B1]: function(s) still missing: %', v_missing;
  end if;

  select string_agg(p.proname, ', ') into v_bad_shape
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('crm_is_active_staff', 'crm_is_active_admin')
    and not (
      l.lanname = 'sql'
      and p.provolatile = 's'
      and p.prosecdef is true
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=']::text[]
    );
  if v_bad_shape is not null then
    raise exception 'FAIL[B2]: function(s) do not match the expected shape (language sql, stable, security definer, search_path=''''): %', v_bad_shape;
  end if;

  raise notice 'OK[B]: both target functions exist with the expected language/volatility/security/search_path';
end;
$$;

-- C. ACL exactly as designed: authenticated=yes, anon=no, PUBLIC=no.
do $$
declare
  v_bad_acl text := '';
begin
  if not has_function_privilege('authenticated', 'public.crm_is_active_staff()', 'execute') then
    v_bad_acl := v_bad_acl || 'authenticated missing on crm_is_active_staff; ';
  end if;
  if not has_function_privilege('authenticated', 'public.crm_is_active_admin()', 'execute') then
    v_bad_acl := v_bad_acl || 'authenticated missing on crm_is_active_admin; ';
  end if;
  if has_function_privilege('anon', 'public.crm_is_active_staff()', 'execute') then
    v_bad_acl := v_bad_acl || 'anon unexpectedly has crm_is_active_staff; ';
  end if;
  if has_function_privilege('anon', 'public.crm_is_active_admin()', 'execute') then
    v_bad_acl := v_bad_acl || 'anon unexpectedly has crm_is_active_admin; ';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_name in ('crm_is_active_staff', 'crm_is_active_admin')
       and grantee = 'PUBLIC'
  ) then
    v_bad_acl := v_bad_acl || 'PUBLIC unexpectedly has a grant record; ';
  end if;

  if v_bad_acl <> '' then
    raise exception 'FAIL[C]: ACL mismatch: %', v_bad_acl;
  end if;

  raise notice 'OK[C]: ACL exactly as designed (authenticated=yes, anon=no, PUBLIC=no)';
end;
$$;

-- D. Business state unaffected by this prerequisite.
do $$
declare
  v_profiles_total bigint;
  v_active_admins bigint;
begin
  select count(*) into v_profiles_total from public.profiles;
  if v_profiles_total <> 1 then
    raise exception 'FAIL[D1]: expected profiles_total = 1, found %', v_profiles_total;
  end if;

  select count(*) into v_active_admins
    from public.profiles
   where role = 'Administrador' and status = 'Activo';
  if v_active_admins <> 1 then
    raise exception 'FAIL[D2]: expected exactly 1 active Administrador, found %', v_active_admins;
  end if;

  raise notice 'OK[D]: profiles_total=1, active_admins=1 (unaffected)';
end;
$$;

-- E. public.templates and its storage policies remain absent -- this
--    prerequisite creates ONLY the two functions and their ACL, nothing
--    else; 20260822110000 itself has not been re-attempted yet.
do $$
declare
  v_templates_exists boolean;
  v_policy_count integer;
begin
  v_templates_exists := to_regclass('public.templates') is not null;
  if v_templates_exists then
    raise exception 'FAIL[E1]: public.templates unexpectedly exists -- this prerequisite must not create it';
  end if;

  select count(*) into v_policy_count
    from pg_policies
   where tablename = 'objects'
     and schemaname = 'storage'
     and policyname in ('crm_templates_insert_admin_only', 'crm_templates_update_admin_only');
  if v_policy_count <> 0 then
    raise exception 'FAIL[E2]: found % of the 2 template storage policies -- this prerequisite must not create them', v_policy_count;
  end if;

  raise notice 'OK[E]: public.templates and both template storage policies remain absent (unaffected)';
end;
$$;

-- F. The three latent 20260811103000 objects still exist -- inspected via
--    catalog metadata ONLY. This block never calls claim_case_task(),
--    never calls return_case_task(), and never issues any UPDATE against
--    public.case_tasks (which would fire guard_case_task_update()).
do $$
begin
  if to_regprocedure('public.guard_case_task_update()') is null then
    raise exception 'FAIL[F1]: public.guard_case_task_update() no longer exists';
  end if;
  if to_regprocedure('public.claim_case_task(uuid)') is null then
    raise exception 'FAIL[F2]: public.claim_case_task(uuid) no longer exists';
  end if;
  if to_regprocedure('public.return_case_task(uuid)') is null then
    raise exception 'FAIL[F3]: public.return_case_task(uuid) no longer exists';
  end if;

  raise notice 'OK[F]: guard_case_task_update()/claim_case_task(uuid)/return_case_task(uuid) still exist (inspected only, never invoked)';
end;
$$;

do $$
begin
  raise notice 'CRM_SECURITY_PREREQUISITE_POSTSTATE = CONFIRMED';
end;
$$;

\echo 'All security-prerequisite postcondition checks passed. Zero writes were performed by this script.'
