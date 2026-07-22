-- Migration: 20260721120000_case_summary_defensive_backfill.sql
-- Description: Relleno defensivo e idempotente de current_summary desde notes (si la columna notes existe).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'cases'
      and column_name  = 'notes'
  ) then
    update public.cases
    set current_summary = notes
    where current_summary is null and notes is not null;
  end if;
end;
$$;
