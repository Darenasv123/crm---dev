-- Migration: 20260815120000_fix_import_jobs_status_check_constraint.sql
-- Description: Updates the import_jobs.status CHECK constraint on the
--              self-hosted instance to accept the status values the ZIP
--              importer actually writes, matching the contract already
--              live on the cloud Supabase project since the
--              legal_case_foundation migration (20260721090000).
--
-- Root cause of the QA-IMPORT-TEST-20260815 failure:
--   src/lib/zip-import/import-engine.server.ts creates each import_jobs
--   row with status='processing' (see also .kiro/specs/importacion-masiva-
--   clientes-documentos/design.md, step 2 of ImportEngine.runImport), then
--   finalizes it with status IN ('completed', 'partially_completed',
--   'failed'). All four values are part of the CHECK constraint applied to
--   the cloud project by 20260721090000_legal_case_foundation.sql:
--     ('draft', 'inventory', 'processing', 'consolidating',
--      'review_required', 'completed', 'partially_completed', 'failed',
--      'cancelled')
--   The self-hosted canonical bootstrap (supabase/self-hosted/
--   0003_domain_tables.sql, designed 2026-08-07) instead defines:
--     ('draft', 'analyzing', 'reviewing', 'importing', 'completed',
--      'failed', 'cancelled')
--   'analyzing'/'reviewing'/'importing' are wizard-phase names from the
--   never-implemented src/lib/imports/folder-import-engine.ts described in
--   the same .kiro spec (lines 237-241: UI state, not the import_jobs.
--   status column) — they were copied into the self-hosted bootstrap by
--   mistake and never matched what the shipped ZIP importer writes.
--   'processing' and 'partially_completed', which the importer DOES write,
--   are absent from the self-hosted constraint, so the very first insert
--   in executeZipImportFn (status='processing') raised:
--     new row for relation "import_jobs" violates check constraint
--     "import_jobs_status_check"  (SQLSTATE 23514)
--   Note the self-hosted bootstrap DID correctly incorporate the sibling
--   fix for public.cases (20260724120000_fix_cases_status_check_
--   constraint.sql — compare its values against 0003_domain_tables.sql,
--   lines 51-56, which match exactly). Only import_jobs was missed.
--
-- Strategy:
--   1. Drop the current constraint (whatever its live definition is).
--   2. Defensively backfill any row that may hold one of the never-shipped
--      wizard-phase values, in case a manual/test insert used them.
--   3. Add the constraint back with the full, correct set of values.
--
-- This migration is safe to run on a live database:
--   - Uses ALTER TABLE … DROP CONSTRAINT IF EXISTS (no error if the
--     constraint is already absent or already named differently).
--   - The backfill UPDATE only touches rows matching the three retired
--     values; re-running it after the first pass matches zero rows.
--   - Re-running the whole migration drops and recreates the SAME
--     fixed-name constraint with the SAME definition, so applying it more
--     than once converges to the same final state (idempotent), even
--     without "ADD CONSTRAINT IF NOT EXISTS" — Postgres has no such clause.
--   - Does not touch any other CHECK constraint, does not recreate the
--     table, does not delete any row.

begin;

-- ─── 1. Inventory + drop the current CHECK constraint ────────────────────────
--
-- PostgreSQL auto-names inline CHECK constraints as <table>_<column>_check.
-- Both the cloud and self-hosted schemas define it inline, so on every known
-- environment it is named import_jobs_status_check. IF EXISTS makes this
-- statement safe even if the constraint was already removed or renamed.

alter table public.import_jobs
  drop constraint if exists import_jobs_status_check;

-- ─── 2. Defensive backfill of retired wizard-phase values ────────────────────
--
-- The ZIP importer never wrote these three values — they only exist in the
-- (incorrect) self-hosted bootstrap constraint, never in application code.
-- This step exists purely so the migration remains safe even if some row
-- was inserted manually/by a test using the old, wrong constraint's values.
--   'analyzing' → 'processing'        (closest live equivalent: in progress)
--   'importing' → 'processing'        (closest live equivalent: in progress)
--   'reviewing' → 'review_required'   (direct semantic match in the new set)

update public.import_jobs
set status = case status
  when 'analyzing' then 'processing'
  when 'importing' then 'processing'
  when 'reviewing' then 'review_required'
  else status
end
where status in ('analyzing', 'importing', 'reviewing');

-- ─── 3. Add the corrected CHECK constraint ────────────────────────────────────
--
-- Matches the constraint already live on the cloud Supabase project
-- (verified against audit/self-hosted-migration/cloud-schema.sql) and every
-- status value src/lib/zip-import/import-engine.server.ts writes today:
--   'draft'                — column default; never written by the importer,
--                             kept for rows created by any other future path
--   'inventory'             — reserved for a pre-processing stage (not yet
--                             written by the current importer; kept because
--                             it is part of the live cloud contract)
--   'processing'            — set on creation (import-engine.server.ts:251)
--   'consolidating'         — reserved (not yet written; part of the
--                             cloud contract)
--   'review_required'       — reserved (not yet written; part of the
--                             cloud contract)
--   'completed'             — set on success (import-engine.server.ts:504)
--   'partially_completed'   — set on partial success (import-engine.server.ts:504)
--   'failed'                — set when nothing succeeded (import-engine.server.ts:504)
--   'cancelled'             — reserved for future cancellation support
--
-- The column default ('draft', set in 0003_domain_tables.sql) is unchanged:
-- it is valid in this new set, unlike the cases.status fix which also had
-- to change its default.

alter table public.import_jobs
  add constraint import_jobs_status_check check (
    status in (
      'draft',
      'inventory',
      'processing',
      'consolidating',
      'review_required',
      'completed',
      'partially_completed',
      'failed',
      'cancelled'
    )
  );

commit;
