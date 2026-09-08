-- verify-crm-security-prerequisite-prestate.sql
--
-- Fase 8I-B2B-0B2B-I2-E2C. READ-ONLY empirical verification, to be run by
-- the owner against CRM Drive Staging BEFORE any manual execution of the
-- #4 security-prerequisite projection (crm_is_active_staff/crm_is_active_
-- admin). Confirms the exact remote state this artifact was designed
-- against: 28/35 migrations applied, 20260822110000 absent (rolled back),
-- both target functions absent, the first synthetic staging Admin still
-- preserved, and public.templates fully absent (matching the confirmed
-- full rollback of the failed 20260822110000 attempt).
--
-- Performs ZERO writes. No credential is embedded — the connection string
-- is supplied by the owner on the psql command line.
--
-- Usage:
--   psql "<staging session-pooler connection string>" \
--     --set ON_ERROR_STOP=1 \
--     -f scripts/sql/verify-crm-security-prerequisite-prestate.sql

\set ON_ERROR_STOP on

-- A. Identity.
select current_database() as db, current_user as usr;

-- B. Migration history: exactly 28, first/last exact.
do $$
declare
  v_count integer;
  v_first text;
  v_last text;
begin
  select count(*), min(version), max(version)
    into v_count, v_first, v_last
    from supabase_migrations.schema_migrations;

  if v_count <> 28 then
    raise exception 'FAIL[B1]: expected 28 applied migrations, found %', v_count;
  end if;
  if v_first <> '20260713120000' then
    raise exception 'FAIL[B2]: expected first applied version 20260713120000, found %', v_first;
  end if;
  if v_last <> '20260822100000' then
    raise exception 'FAIL[B3]: expected last applied version 20260822100000, found %', v_last;
  end if;

  raise notice 'OK[B]: history is exactly 28 versions, 20260713120000..20260822100000';
end;
$$;

-- C. 20260822110000 must be absent (rolled back).
do $$
begin
  if exists (
    select 1 from supabase_migrations.schema_migrations where version = '20260822110000'
  ) then
    raise exception 'FAIL[C]: 20260822110000 is already recorded in migration history';
  end if;
  raise notice 'OK[C]: 20260822110000 absent from migration history';
end;
$$;

-- D. Both target functions absent.
do $$
declare
  v_staff_exists boolean;
  v_admin_exists boolean;
begin
  v_staff_exists := to_regprocedure('public.crm_is_active_staff()') is not null;
  v_admin_exists := to_regprocedure('public.crm_is_active_admin()') is not null;

  if v_staff_exists or v_admin_exists then
    raise exception 'FAIL[D]: expected both target functions absent, found staff=%, admin=%',
      v_staff_exists, v_admin_exists;
  end if;

  raise notice 'OK[D]: crm_is_active_staff() and crm_is_active_admin() both absent';
end;
$$;

-- E. First synthetic staging Admin preserved.
do $$
declare
  v_profiles_total bigint;
  v_active_admins bigint;
begin
  select count(*) into v_profiles_total from public.profiles;
  if v_profiles_total <> 1 then
    raise exception 'FAIL[E1]: expected profiles_total = 1, found %', v_profiles_total;
  end if;

  select count(*) into v_active_admins
    from public.profiles
   where role = 'Administrador' and status = 'Activo';
  if v_active_admins <> 1 then
    raise exception 'FAIL[E2]: expected exactly 1 active Administrador, found %', v_active_admins;
  end if;

  raise notice 'OK[E]: first synthetic staging Admin preserved (profiles_total=1, active_admins=1)';
end;
$$;

-- F. public.templates and its storage policies remain fully absent
--    (full rollback of the previously-failed 20260822110000 attempt).
do $$
declare
  v_templates_exists boolean;
  v_policy_count integer;
begin
  v_templates_exists := to_regclass('public.templates') is not null;
  if v_templates_exists then
    raise exception 'FAIL[F1]: public.templates already exists — rollback of 20260822110000 was not full';
  end if;

  select count(*) into v_policy_count
    from pg_policies
   where tablename = 'objects'
     and schemaname = 'storage'
     and policyname in ('crm_templates_insert_admin_only', 'crm_templates_update_admin_only');
  if v_policy_count <> 0 then
    raise exception 'FAIL[F2]: found % of the 2 template storage policies that should be absent', v_policy_count;
  end if;

  raise notice 'OK[F]: public.templates and both template storage policies remain fully absent';
end;
$$;

do $$
begin
  raise notice 'CRM_SECURITY_PREREQUISITE_PRESTATE = CONFIRMED';
end;
$$;

\echo 'All security-prerequisite prestate checks passed. Zero writes were performed by this script.'
