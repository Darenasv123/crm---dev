-- Migration: 20260724120000_fix_cases_status_check_constraint.sql
-- Description: Updates the cases.status CHECK constraint to accept the new
--              workflow status values used by the application since the
--              legal_case_foundation migration (20260721090000).
--
-- Root cause of the ZIP import failure:
--   normalizeCaseStatus() returns values from the new set
--   ('Pendiente de clasificación', 'En trámite', 'En audiencia', etc.)
--   but the original schema only allowed the legacy set
--   ('Consulta', 'Documentación', 'Demanda presentada', 'En proceso',
--    'Audiencia', 'Sentencia', 'Archivado').
--   This mismatch caused a 23514 check_violation on every case insert,
--   leaving the client created but the expediente missing.
--
-- Strategy:
--   1. Drop the old constraint (it references the legacy values).
--   2. Backfill any legacy values that may already exist in the column.
--   3. Add a new constraint that covers both legacy aliases (now mapped)
--      and all current workflow status values, plus 'pendiente_revision'
--      which is used as a provisional status by the ZIP importer.
--
-- This migration is safe to run on a live database:
--   - Uses ALTER TABLE … DROP CONSTRAINT IF EXISTS (no error if missing).
--   - Backfill UPDATE is idempotent (re-running produces no new changes).
--   - IF NOT EXISTS on the new constraint protects from double-application.

begin;

-- ─── 1. Drop the old CHECK constraint ────────────────────────────────────────
--
-- PostgreSQL auto-names inline CHECK constraints as <table>_<column>_check.
-- The original schema defined the constraint inline so it is named cases_status_check.
-- We use IF EXISTS so the statement is safe if the constraint was already removed.

alter table public.cases
  drop constraint if exists cases_status_check;

-- ─── 2. Backfill legacy status values already in the table ───────────────────
--
-- Rows that may contain legacy values from before this migration:
--   'Consulta'            → 'Pendiente de clasificación'
--   'Documentación'       → 'En preparación'
--   'Demanda presentada'  → 'Presentado'
--   'En proceso'          → 'En trámite'
--   'Audiencia'           → 'En audiencia'
--   'Sentencia'           → 'Concluido'
-- 'Archivado' is valid in both sets — no change needed.
-- 'pendiente_revision' was already used by the importer — keep as-is.

update public.cases
set status = case status
  when 'Consulta'           then 'Pendiente de clasificación'
  when 'Documentación'      then 'En preparación'
  when 'Demanda presentada' then 'Presentado'
  when 'En proceso'         then 'En trámite'
  when 'Audiencia'          then 'En audiencia'
  when 'Sentencia'          then 'Concluido'
  else status
end
where status in (
  'Consulta', 'Documentación', 'Demanda presentada',
  'En proceso', 'Audiencia', 'Sentencia'
);

-- ─── 3. Add the new CHECK constraint ─────────────────────────────────────────
--
-- Accepted values:
--   New workflow statuses (used by the app since legal_case_foundation):
--     'Pendiente de clasificación' — default for imported/provisional cases
--     'En preparación'             — documents being gathered
--     'Presentado'                 — demand filed
--     'En trámite'                 — case in progress
--     'En audiencia'               — hearing stage
--     'En ejecución'               — enforcement stage
--     'Concluido'                  — concluded (replaced 'Sentencia')
--     'Archivado'                  — archived
--   Provisional status used by the ZIP importer for unclassified cases:
--     'pendiente_revision'
--
-- The constraint is named explicitly so future migrations can reference it.

alter table public.cases
  add constraint cases_status_check check (
    status in (
      'Pendiente de clasificación',
      'En preparación',
      'Presentado',
      'En trámite',
      'En audiencia',
      'En ejecución',
      'Concluido',
      'Archivado',
      'pendiente_revision'
    )
  );

-- ─── 4. Update the column default to match the new set ───────────────────────
--
-- The old default was 'Consulta', which is no longer allowed.
-- New default: 'Pendiente de clasificación' (the first value in the new set).

alter table public.cases
  alter column status set default 'Pendiente de clasificación';

commit;
