-- Migration: 20260725120000_document_folders.sql
-- Description: Carpetas lógicas para organizar documentos de cada cliente.
-- Additive only: no elimina ni renombra tablas, columnas o políticas existentes.
-- Idempotent: usa IF NOT EXISTS / IF EXISTS en todos los pasos.
-- No modifica storage_path, original_name ni relative_path de documentos existentes.
--
-- PROTECCIONES IMPLEMENTADAS (PostgreSQL, no solo aplicación):
--   1. parent_id no puede apuntar a carpeta de otro cliente     → trigger trg_df_parent_same_client
--   2. Una carpeta no puede ser su propio padre                  → check document_folders_no_self_parent
--   3. Ciclos directos (A→B→A)                                  → trigger trg_df_no_cycle
--   4. Ciclos indirectos (cadena larga)                         → trigger trg_df_no_cycle
--   5. Dos carpetas raíz con el mismo nombre normalizado         → unique index document_folders_root_unique
--   6. Dos subcarpetas con el mismo nombre bajo el mismo padre  → constraint document_folders_unique_name_under_parent
--   7. Un documento asignado a carpeta de otro cliente          → trigger trg_doc_folder_same_client
--   8. Eliminación de carpeta con documentos                    → ON DELETE RESTRICT en FK de documents.folder_id
--   9. Eliminación de carpeta con subcarpetas                   → ON DELETE RESTRICT en FK document_folders.parent_id

begin;

-- ─── 0. Función set_updated_at (si no existe aún) ───────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── 1. Tabla de carpetas ────────────────────────────────────────────────────
--
-- Cada carpeta pertenece a un cliente (client_id NOT NULL).
-- parent_id NULL → carpeta raíz del cliente.
-- normalized_name → nombre en minúsculas sin espacios extras ni tildes
--   (para unicidad lógica, mismo algoritmo que normalizeFolderName en TS).

create table if not exists public.document_folders (
  id              uuid        primary key default gen_random_uuid(),
  client_id       uuid        not null references public.clients(id) on delete cascade,
  parent_id       uuid        references public.document_folders(id) on delete restrict,
  name            text        not null,
  normalized_name text        not null,
  created_by      uuid        references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Protección 2: una carpeta no puede ser su propio padre (ciclo trivial)
  constraint document_folders_no_self_parent
    check (id <> parent_id),

  -- Protección 6: nombres únicos bajo el mismo padre por cliente.
  -- Para raíces (parent_id IS NULL) la unicidad se refuerza con el índice
  -- parcial de abajo, ya que NULL <> NULL en UNIQUE estándar de SQL.
  constraint document_folders_unique_name_under_parent
    unique (client_id, parent_id, normalized_name)
);

comment on table public.document_folders is
  'Carpetas lógicas para organizar documentos de cada cliente. '
  'No almacena archivos: solo estructura de organización.';

comment on column public.document_folders.normalized_name is
  'Nombre en minúsculas, sin tildes, espacios colapsados. '
  'Generado en la aplicación con normalizeFolderName(). '
  'Usado para unicidad insensible a mayúsculas y tildes.';

-- Protección 5: carpetas raíz únicas por cliente (parent_id IS NULL)
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
-- ON DELETE RESTRICT → impide borrar una carpeta que tenga documentos (Protección 8).
-- Conserva relative_path, storage_path, original_name, content_hash sin cambios.

alter table public.documents
  add column if not exists folder_id uuid
  references public.document_folders(id)
  on delete restrict;

comment on column public.documents.folder_id is
  'Carpeta lógica a la que pertenece el documento. '
  'NULL = raíz del cliente. '
  'ON DELETE RESTRICT: no se puede eliminar la carpeta si tiene documentos.';

create index if not exists documents_folder_id_idx
  on public.documents (folder_id);

-- ─── 3. Función: validar que parent_id pertenece al mismo cliente ────────────
--
-- Protección 1: parent_id no puede apuntar a carpeta de otro cliente.

create or replace function public.check_folder_parent_same_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_client uuid;
begin
  -- Solo validar si hay padre
  if new.parent_id is null then
    return new;
  end if;

  select client_id into v_parent_client
  from public.document_folders
  where id = new.parent_id;

  if not found then
    raise exception
      'La carpeta padre (id=%) no existe.',
      new.parent_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_parent_client <> new.client_id then
    raise exception
      'La carpeta padre pertenece a un cliente diferente. '
      'Una carpeta solo puede tener como padre a una carpeta del mismo cliente.'
      using errcode = 'check_violation',
            hint    = 'Asegúrate de que parent_id apunte a una carpeta con el mismo client_id.';
  end if;

  return new;
end;
$$;

comment on function public.check_folder_parent_same_client() is
  'Trigger que impide que parent_id apunte a una carpeta de un cliente diferente.';

drop trigger if exists trg_df_parent_same_client on public.document_folders;
create trigger trg_df_parent_same_client
  before insert or update of parent_id, client_id on public.document_folders
  for each row execute function public.check_folder_parent_same_client();

-- ─── 4. Función: prevenir ciclos (directos e indirectos) ─────────────────────
--
-- Protecciones 3 y 4: evita ciclos A→B→A o cadenas largas.
-- Recorre la cadena de ancestros hacia arriba (max 50 niveles).
-- El check id <> parent_id ya cubre el ciclo trivial, esta función cubre
-- ciclos entre dos o más nodos distintos.

create or replace function public.check_folder_no_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current  uuid := new.parent_id;
  v_depth    int  := 0;
  v_max      int  := 50;
begin
  -- Sin padre → sin ciclo posible
  if v_current is null then
    return new;
  end if;

  loop
    -- Si llegamos al propio nodo, hay ciclo
    if v_current = new.id then
      raise exception
        'La operación crearía un ciclo en la jerarquía de carpetas. '
        'Una carpeta no puede ser descendiente de sí misma.'
        using errcode = 'check_violation',
              hint    = 'Revisa la cadena de parent_id: el nodo % aparece en su propia ascendencia.',
              column  = 'parent_id';
    end if;

    -- Avanzar al abuelo
    select parent_id into v_current
    from public.document_folders
    where id = v_current;

    -- Sin padre → fin de cadena sin ciclo
    exit when not found or v_current is null;

    v_depth := v_depth + 1;
    if v_depth > v_max then
      raise exception
        'La jerarquía de carpetas supera % niveles de profundidad. '
        'Se abortó la operación por seguridad.',
        v_max
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.check_folder_no_cycle() is
  'Trigger que impide ciclos directos e indirectos en la jerarquía de carpetas. '
  'Recorre hasta 50 niveles de ancestros. Complementa el CHECK id <> parent_id.';

drop trigger if exists trg_df_no_cycle on public.document_folders;
create trigger trg_df_no_cycle
  before insert or update of parent_id on public.document_folders
  for each row execute function public.check_folder_no_cycle();

-- ─── 5. Función: validar que folder_id de un documento es del mismo cliente ──
--
-- Protección 7: un documento no puede asignarse a una carpeta de otro cliente.

create or replace function public.check_document_folder_same_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder_client uuid;
begin
  -- NULL significa "sin carpeta", siempre válido
  if new.folder_id is null then
    return new;
  end if;

  select client_id into v_folder_client
  from public.document_folders
  where id = new.folder_id;

  if not found then
    raise exception
      'La carpeta destino (id=%) no existe.',
      new.folder_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_folder_client <> new.client_id then
    raise exception
      'La carpeta destino pertenece a un cliente diferente. '
      'Un documento solo puede asignarse a carpetas del mismo cliente.'
      using errcode = 'check_violation',
            hint    = 'El documento tiene client_id=%, la carpeta pertenece a client_id=%.',
            column  = 'folder_id';
  end if;

  return new;
end;
$$;

comment on function public.check_document_folder_same_client() is
  'Trigger que impide asignar un documento a una carpeta de un cliente diferente.';

drop trigger if exists trg_doc_folder_same_client on public.documents;
create trigger trg_doc_folder_same_client
  before insert or update of folder_id, client_id on public.documents
  for each row execute function public.check_document_folder_same_client();

-- ─── 6. RLS para document_folders ───────────────────────────────────────────
--
-- SELECT, INSERT, UPDATE: staff activo (Administrador + Personal).
-- DELETE: solo Administrador activo.
-- Las FK ON DELETE RESTRICT en parent_id y documents.folder_id impiden
-- borrar carpetas con subcarpetas o documentos respectivamente (Protecciones 8 y 9).
-- Sin recursión: verificamos directamente en public.profiles.

alter table public.document_folders enable row level security;

grant select, insert, update, delete on public.document_folders to authenticated;

drop policy if exists "document_folders_select" on public.document_folders;
drop policy if exists "document_folders_insert" on public.document_folders;
drop policy if exists "document_folders_update" on public.document_folders;
drop policy if exists "document_folders_delete" on public.document_folders;

-- SELECT: staff activo puede listar sus carpetas
create policy "document_folders_select" on public.document_folders
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

-- INSERT: staff activo puede crear carpetas
create policy "document_folders_insert" on public.document_folders
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('Administrador', 'Personal')
        and p.status = 'Activo'
    )
  );

-- UPDATE: staff activo puede renombrar carpetas
-- La validación de cliente-padre la hace el trigger trg_df_parent_same_client.
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

-- DELETE: solo Administrador activo.
-- ON DELETE RESTRICT en parent_id y documents.folder_id garantiza (a nivel DB)
-- que no se pueda borrar una carpeta con hijos o documentos (Protecciones 8 y 9).
create policy "document_folders_delete" on public.document_folders
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'Administrador'
        and p.status = 'Activo'
    )
  );

-- ─── 7. Política UPDATE para documents (faltaba en schema base) ─────────────

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
