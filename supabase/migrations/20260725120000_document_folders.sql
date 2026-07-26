-- Migration: 20260725120000_document_folders.sql
-- Description: Carpetas lógicas para organizar documentos de cada cliente.
-- Additive only: no elimina ni renombra tablas, columnas o políticas existentes.
-- Idempotent: usa IF NOT EXISTS / IF EXISTS en todos los pasos.
-- No modifica storage_path, original_name ni relative_path de documentos existentes.

begin;

-- ─── 1. Tabla de carpetas ────────────────────────────────────────────────────
--
-- Cada carpeta pertenece a un cliente (client_id NOT NULL).
-- parent_id NULL → carpeta raíz del cliente.
-- normalized_name → nombre en minúsculas sin espacios extras (para unicidad lógica).

create table if not exists public.document_folders (
  id             uuid        primary key default gen_random_uuid(),
  client_id      uuid        not null references public.clients(id) on delete cascade,
  parent_id      uuid        references public.document_folders(id) on delete restrict,
  name           text        not null,
  normalized_name text       not null,
  created_by     uuid        references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Regla 3: una carpeta no puede ser su propio padre
  constraint document_folders_no_self_parent
    check (id <> parent_id),

  -- Regla 5 & 7: nombres únicos bajo el mismo padre por cliente.
  -- Para raíces (parent_id IS NULL) la unicidad se asegura en la capa de aplicación
  -- con el índice parcial de abajo, porque en SQL estándar NULL <> NULL en UNIQUE.
  constraint document_folders_unique_name_under_parent
    unique (client_id, parent_id, normalized_name)
);

-- Índice separado para carpetas raíz (parent_id IS NULL)
create unique index if not exists document_folders_root_unique
  on public.document_folders (client_id, normalized_name)
  where parent_id is null;

-- Índices de rendimiento
create index if not exists document_folders_client_id_idx
  on public.document_folders (client_id);

create index if not exists document_folders_parent_id_idx
  on public.document_folders (parent_id);

-- Trigger para updated_at
drop trigger if exists document_folders_set_updated_at on public.document_folders;
create trigger document_folders_set_updated_at
  before update on public.document_folders
  for each row execute function public.set_updated_at();

-- ─── 2. Columna folder_id en documents ──────────────────────────────────────
--
-- NULL → documento sin carpeta asignada (raíz lógica del cliente).
-- Conserva relative_path, storage_path, original_name, content_hash sin cambios.

alter table public.documents
  add column if not exists folder_id uuid
  references public.document_folders(id)
  on delete set null;

create index if not exists documents_folder_id_idx
  on public.documents (folder_id);

-- ─── 3. RLS para document_folders ───────────────────────────────────────────
--
-- Mismos permisos que clients/documents: staff puede leer/crear/editar,
-- administrador puede eliminar.
-- Sin recursión: verificamos directamente en public.profiles.

alter table public.document_folders enable row level security;

grant select, insert, update, delete on public.document_folders to authenticated;

drop policy if exists "document_folders_select" on public.document_folders;
drop policy if exists "document_folders_insert" on public.document_folders;
drop policy if exists "document_folders_update" on public.document_folders;
drop policy if exists "document_folders_delete" on public.document_folders;

create policy "document_folders_select" on public.document_folders
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "document_folders_insert" on public.document_folders
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

create policy "document_folders_update" on public.document_folders
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

-- DELETE: solo admin, y solo cuando la carpeta esté vacía.
-- La validación de "carpeta vacía" se hace en la capa de aplicación antes de llamar DELETE.
-- A nivel DB, on delete restrict en la FK parent_id impide borrar carpetas con subcarpetas.
-- La FK folder_id → document_folders tiene on delete set null, así que borrar una carpeta
-- no borra documentos: los deja con folder_id = NULL (visibles en raíz).
create policy "document_folders_delete" on public.document_folders
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- ─── 4. Política UPDATE para documents (faltaba) ────────────────────────────

drop policy if exists "documents_update" on public.documents;

create policy "documents_update" on public.documents
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

commit;
