-- ============================================================
-- rollback_document_folders.sql
-- ROLLBACK CONTROLADO de la migración document_folders.
--
-- ╔══════════════════════════════════════════════════════════╗
-- ║  ⚠  ADVERTENCIA — LEE ESTO ANTES DE CONTINUAR           ║
-- ║                                                          ║
-- ║  Este script ELIMINA la estructura de carpetas lógicas.  ║
-- ║  • No elimina documentos ni objetos de Storage.          ║
-- ║  • Convierte folder_id → NULL en todos los documentos.  ║
-- ║  • Pierde TODA la organización en carpetas creada.       ║
-- ║                                                          ║
-- ║  REQUISITOS PREVIOS:                                     ║
-- ║  1. Haz un backup (pg_dump o exportación en Supabase).   ║
-- ║  2. Anota o exporta las carpetas antes de ejecutar.      ║
-- ║  3. Confirmación explícita: descomenta el bloque BEGIN.  ║
-- ║                                                          ║
-- ║  ESTE SCRIPT NO SE EJECUTA AUTOMÁTICAMENTE.             ║
-- ║  Solo quien tenga acceso al SQL Editor de Supabase       ║
-- ║  puede ejecutarlo manualmente, paso a paso.              ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- PASOS:
--   PASO 0: Backup obligatorio.
--   PASO 1: Exportar el estado actual de carpetas.
--   PASO 2: Desconectar folder_id de documentos (SET NULL).
--   PASO 3: Eliminar triggers en documents.
--   PASO 4: Eliminar columna folder_id de documents.
--   PASO 5: Eliminar triggers en document_folders.
--   PASO 6: Eliminar funciones de protección.
--   PASO 7: Eliminar políticas RLS de document_folders.
--   PASO 8: Eliminar tabla document_folders.
--   PASO 9: Eliminar política documents_update (restaurar a estado previo).
--
-- NO ELIMINA: documentos, objetos de Storage, clients, cases, profiles.
-- ============================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- PASO 0 — BACKUP (ejecutar ANTES, fuera de este script)
-- ──────────────────────────────────────────────────────────────────────────────
-- En Supabase Dashboard → Database → Backups → Point in time restore
-- O desde CLI:
--   supabase db dump --db-url "postgres://..." -f backup-pre-rollback.sql
-- ──────────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────────
-- PASO 1 — EXPORTAR ESTADO ACTUAL (ejecutar y guardar el resultado antes)
-- ──────────────────────────────────────────────────────────────────────────────
-- Ejecuta estas queries y guarda los resultados en un archivo CSV o JSON
-- ANTES de ejecutar el rollback:

/*
-- Carpetas existentes
select
  f.id, f.client_id, c.name as client_name,
  f.parent_id, f.name, f.normalized_name,
  f.created_at, f.updated_at
from public.document_folders f
join public.clients c on c.id = f.client_id
order by c.name, f.created_at;

-- Asignaciones documento → carpeta
select
  d.id as document_id, d.name as document_name,
  d.client_id, d.folder_id,
  f.name as folder_name,
  d.relative_path
from public.documents d
left join public.document_folders f on f.id = d.folder_id
where d.folder_id is not null
order by d.client_id, f.name, d.name;
*/

-- ──────────────────────────────────────────────────────────────────────────────
-- INICIO DEL ROLLBACK — DESCOMENTA EL BLOQUE COMPLETO PARA EJECUTAR
-- ──────────────────────────────────────────────────────────────────────────────

/*
begin;

-- ── PASO 2: Desconectar documentos de sus carpetas ────────────────────────────
-- Convierte folder_id → NULL en todos los documentos.
-- Los documentos siguen existiendo, solo pierden su organización en carpetas.
-- Esta operación es necesaria antes de eliminar la FK y la tabla.

update public.documents
set folder_id = null
where folder_id is not null;

-- Verificar que quedó limpio antes de continuar
do $$
declare v int;
begin
  select count(*) into v from public.documents where folder_id is not null;
  if v > 0 then
    raise exception 'Aún hay % documentos con folder_id != null. Abortando.', v;
  end if;
  raise notice 'OK: Todos los documentos tienen folder_id = NULL.';
end;
$$;

-- ── PASO 3: Eliminar trigger en documents ─────────────────────────────────────

drop trigger if exists trg_doc_folder_same_client on public.documents;

-- ── PASO 4: Eliminar columna folder_id de documents ──────────────────────────
-- Solo es seguro después del PASO 2 (todos los folder_id = NULL)
-- y del PASO 3 (trigger eliminado).

alter table public.documents
  drop column if exists folder_id;

drop index if exists public.documents_folder_id_idx;

-- ── PASO 5: Eliminar triggers en document_folders ────────────────────────────

drop trigger if exists trg_df_no_cycle          on public.document_folders;
drop trigger if exists trg_df_parent_same_client on public.document_folders;
drop trigger if exists document_folders_set_updated_at on public.document_folders;

-- ── PASO 6: Eliminar funciones de protección ─────────────────────────────────
-- Solo después de haber eliminado los triggers que las usan.

drop function if exists public.check_folder_no_cycle();
drop function if exists public.check_folder_parent_same_client();
drop function if exists public.check_document_folder_same_client();

-- ── PASO 7: Eliminar política documents_update en documents ──────────────────
-- Esta política fue agregada en la misma migración.
-- Nota: los documentos quedarán sin política UPDATE hasta que se restaure
-- la política del schema base.

drop policy if exists "documents_update" on public.documents;

-- ── PASO 8: Eliminar políticas RLS de document_folders ───────────────────────
-- (se eliminan automáticamente al hacer DROP TABLE, pero explícito es más seguro)

drop policy if exists "document_folders_select" on public.document_folders;
drop policy if exists "document_folders_insert" on public.document_folders;
drop policy if exists "document_folders_update" on public.document_folders;
drop policy if exists "document_folders_delete" on public.document_folders;

-- ── PASO 9: Eliminar tabla document_folders ──────────────────────────────────
-- Solo es seguro aquí porque:
--   a) La columna folder_id ya fue eliminada de documents (PASO 4).
--   b) No hay FKs externas que apunten a esta tabla.

drop table if exists public.document_folders;

-- ── PASO 10: Verificación post-rollback ──────────────────────────────────────
do $$
declare v int;
begin
  select count(*) into v
  from information_schema.tables
  where table_schema = 'public' and table_name = 'document_folders';
  if v > 0 then
    raise exception 'La tabla document_folders todavía existe. Revisa los pasos anteriores.';
  end if;

  select count(*) into v
  from information_schema.columns
  where table_schema = 'public' and table_name = 'documents' and column_name = 'folder_id';
  if v > 0 then
    raise exception 'La columna documents.folder_id todavía existe. Revisa el PASO 4.';
  end if;

  raise notice 'ROLLBACK COMPLETADO. document_folders eliminada. documents.folder_id eliminada.';
  raise notice 'IMPORTANTE: Los documentos perdieron su organización en carpetas.';
  raise notice 'Los archivos físicos en Storage NO fueron modificados.';
end;
$$;

commit;
*/

-- ──────────────────────────────────────────────────────────────────────────────
-- FIN: rollback_document_folders.sql
-- Descomenta el bloque /* */ completo y ejecútalo en Supabase SQL Editor.
-- ──────────────────────────────────────────────────────────────────────────────
