-- Canonical self-hosted bootstrap for PostgreSQL 17 / Supabase.
-- This sequence targets an empty Supabase installation and contains no
-- operational data migration.

begin;

do $$
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'Unsupported PostgreSQL server version: %. Expected PostgreSQL 17.x.',
      current_setting('server_version');
  end if;

  if not exists (select 1 from pg_language where lanname = 'plpgsql') then
    raise exception 'Required core language plpgsql is not installed.';
  end if;

  if to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'PostgreSQL core function pg_catalog.gen_random_uuid() is unavailable.';
  end if;

  if to_regclass('auth.users') is null then
    raise exception
      'Supabase Auth bootstrap is incomplete: auth.users does not exist.';
  end if;

  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception
      'Supabase Storage bootstrap is incomplete: storage.buckets/storage.objects do not exist.';
  end if;
end;
$$;

-- No external extension is required. gen_random_uuid() is built into
-- PostgreSQL 17; Supabase provides Auth and Storage as platform schemas.

commit;
