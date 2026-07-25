-- Migration: 20260724000000_bulk_import_support.sql
-- Description: Support for bulk folder import of clients.
-- This migration is:
--   - Additive only: no columns, tables or policies are renamed or dropped.
--   - Safe to apply with existing data.
--   - Idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
--
-- Changes:
--   1. Makes clients.dni, clients.phone, clients.process_type nullable.
--      The manual form still validates these fields in the frontend.
--      Bulk import leaves them NULL for staff to fill in later.
--
--   2. Adds documents.relative_path (nullable text).
--      Stores the path relative to the client folder, e.g. "Resoluciones/res01.pdf".
--      Allows two files with the same name in different subdirectories.
--
--   3. Adds documents.content_hash (nullable text).
--      SHA-256 hex of file content when available. Used for content-based dedup.
--
--   4. Adds a partial unique index on (client_id, relative_path) in documents
--      when both are non-null. This is the correct dedup key:
--      same client + same relative path = same logical document.
--      Two files with the same name in different subdirectories have different
--      relative_path values and therefore coexist correctly.
--
--   5. Adds a plain index on documents.client_id for query performance.
--
-- Does NOT create a unique index on (client_id, original_name).
-- original_name alone cannot identify a document uniquely within a client.

begin;

-- ─── 1. Make inherited fields nullable in clients ────────────────────────────

alter table public.clients
  alter column dni drop not null;

alter table public.clients
  alter column phone drop not null;

alter table public.clients
  alter column process_type drop not null;

-- ─── 2. Add relative_path column to documents ────────────────────────────────
--
-- Stores the path from the client folder root, e.g. "Resoluciones/res01.pdf"
-- or just "demanda.pdf" for top-level files.
-- NULL for documents created before this migration (no impact on existing rows).

alter table public.documents
  add column if not exists relative_path text;

-- ─── 3. Add content_hash column to documents ─────────────────────────────────
--
-- SHA-256 hex digest of file content, used for content-based duplicate detection.
-- NULL means hash was not computed (old docs, or SHA-256 not available in browser).

alter table public.documents
  add column if not exists content_hash text;

-- ─── 4. Partial unique index on (client_id, relative_path) ───────────────────
--
-- Guarantees that for a given client, the same relative path is not inserted twice.
-- Partial: only applies when both client_id and relative_path are non-null.
-- Existing documents (relative_path IS NULL) are unaffected.
-- This correctly handles: "Resoluciones/Documento.pdf" and "Anexos/Documento.pdf"
-- as distinct entries for the same client.

create unique index if not exists documents_client_relative_path_unique
  on public.documents (client_id, relative_path)
  where client_id is not null and relative_path is not null;

-- ─── 5. Performance index on client_id ───────────────────────────────────────

create index if not exists documents_client_id_idx
  on public.documents (client_id);

commit;
