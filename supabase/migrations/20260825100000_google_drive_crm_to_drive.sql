-- Fase 8D: CRM -> Drive (carpeta automática, subida, renombrado, papelera).
--
-- NO se aplica remotamente como parte de esta fase. Google Drive real sigue
-- desconectado.
--
-- Migración INCREMENTAL. Las dos anteriores
-- (20260824100000_google_drive_sync_foundation.sql y
-- 20260824110000_google_drive_client_folder_onboarding.sql) ya están
-- commiteadas y NO se modifican.
--
-- Contiene:
--   1. un cambio de FK necesario para poder borrar documentos con seguridad;
--   2. cuatro RPC server-only de reserva/finalización de identidad Drive.

begin;

-- ── 1. FK de la cola: el trabajo debe sobrevivir al borrado del documento ─
--
-- En Fase 8B la cola declaró document_id con ON DELETE CASCADE, que era lo
-- razonable cuando no existía ninguna operación de borrado. Con
-- trash_document deja de serlo, y el motivo es la garantía de seguridad más
-- importante de esta fase:
--
--   El CRM encola "mueve a la papelera este archivo de Drive" ANTES de
--   borrar el documento, pero el worker solo debe ejecutarlo si el borrado
--   en el CRM realmente ocurrió. Si el borrado falla a medias, el documento
--   sigue existiendo y su copia en Drive NO puede desaparecer.
--
-- Con CASCADE el trabajo se borraría junto al documento y nunca se
-- ejecutaría la papelera. Con SET NULL el trabajo sobrevive y su document_id
-- pasando a NULL es justamente la SEÑAL de que el borrado se consumó. El
-- trabajo conserva drive_file_id, que es la identidad externa que necesita.
--
-- La columna ya era nullable, así que SET NULL no exige ningún otro cambio.
alter table public.google_drive_sync_queue
  drop constraint if exists google_drive_sync_queue_document_id_fkey;

alter table public.google_drive_sync_queue
  add constraint google_drive_sync_queue_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete set null;

-- google_drive_document_files.document_id conserva su ON DELETE CASCADE de
-- Fase 8B, y es correcto: el mapping describe un documento del CRM, así que
-- sin documento no tiene sentido. La identidad que el worker necesita ya
-- viaja en la propia fila de la cola.

-- ── 2. Reserva de carpeta de Cliente ─────────────────────────────────────
--
-- Se reserva el ID en PostgreSQL ANTES de crear la carpeta en Drive. Si el
-- create se pierde (timeout, proceso caído), el reintento encuentra la
-- reserva y reutiliza el MISMO ID en vez de crear una segunda carpeta.
--
-- FOR UPDATE sobre la conexión, igual que las RPC de 8C.1: serializa contra
-- un cambio de raíz concurrente y contra otro worker haciendo lo mismo para
-- el mismo cliente. La UNIQUE(client_id) de 8B es la garantía final.
create or replace function public.reserve_google_drive_created_client_folder(
  p_connection_id uuid,
  p_expected_root_folder_id text,
  p_client_id uuid,
  p_reserved_folder_id text,
  p_folder_name text,
  p_linked_by uuid
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_existing public.google_drive_client_folders;
begin
  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if v_connection.root_folder_id is distinct from p_expected_root_folder_id then
    raise exception 'DRIVE_ROOT_CHANGED_RETRY';
  end if;

  -- Ya reservada o ya vinculada: devolver la existente, nunca crear otra.
  select * into v_existing
    from public.google_drive_client_folders
   where client_id = p_client_id;

  if found then
    return jsonb_build_object(
      'driveFolderId', v_existing.drive_folder_id,
      'syncStatus', v_existing.sync_status,
      'matchType', v_existing.match_type,
      'reserved', false
    );
  end if;

  insert into public.google_drive_client_folders (
    connection_id, client_id, drive_folder_id, drive_folder_name_snapshot,
    match_type, linked_by, linked_at, sync_status
  ) values (
    p_connection_id, p_client_id, p_reserved_folder_id, p_folder_name,
    -- 'created' es exactamente el valor que el CHECK de 8B reservó para
    -- "esta carpeta la creó el CRM", frente a las vinculaciones de
    -- onboarding (exact/normalized/manual).
    'created', p_linked_by, now(), 'pending'
  );

  return jsonb_build_object(
    'driveFolderId', p_reserved_folder_id,
    'syncStatus', 'pending',
    'matchType', 'created',
    'reserved', true
  );
end;
$$;

revoke all on function public.reserve_google_drive_created_client_folder(uuid, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_google_drive_created_client_folder(uuid, text, uuid, text, text, uuid)
  to service_role;

-- ── 3. Finalización de carpeta de Cliente ────────────────────────────────
--
-- Tras crear la carpeta en Drive (o reconciliar un 409). Si p_sync_error
-- viene con valor, la reserva NO se borra: se marca en error conservando el
-- drive_folder_id, porque ese ID reservado es lo que permite reconciliar
-- después. Borrar la reserva ante un fallo ambiguo es justo lo que crearía
-- carpetas duplicadas.
create or replace function public.finalize_google_drive_client_folder(
  p_client_id uuid,
  p_drive_folder_id text,
  p_folder_name text,
  p_sync_error text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.google_drive_client_folders
     set drive_folder_name_snapshot = coalesce(p_folder_name, drive_folder_name_snapshot),
         sync_status = case when p_sync_error is null then 'synced' else 'error' end,
         sync_error = p_sync_error,
         last_synced_at = case when p_sync_error is null then now() else last_synced_at end,
         updated_at = now()
   where client_id = p_client_id
     and drive_folder_id = p_drive_folder_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'CLIENT_FOLDER_MAPPING_NOT_FOUND';
  end if;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.finalize_google_drive_client_folder(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_google_drive_client_folder(uuid, text, text, text)
  to service_role;

-- ── 4. Reserva de archivo de documento ───────────────────────────────────
--
-- Mismo principio que la carpeta: el ID de Drive se reserva aquí antes de
-- subir nada. La UNIQUE(document_id) de 8B garantiza que dos workers
-- concurrentes no puedan reservar dos archivos para el mismo documento.
--
-- Exige que la carpeta del Cliente ya esté vinculada y que sea la esperada:
-- subir a una carpeta distinta de la del Cliente rompería la relación
-- jurídica que el CRM gobierna.
create or replace function public.reserve_google_drive_document_file(
  p_connection_id uuid,
  p_document_id uuid,
  p_reserved_file_id text,
  p_expected_parent_id text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_client_id uuid;
  v_folder public.google_drive_client_folders;
  v_existing public.google_drive_document_files;
begin
  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  select client_id into v_client_id from public.documents where id = p_document_id;
  if not found then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;
  if v_client_id is null then
    raise exception 'DOCUMENT_WITHOUT_CLIENT';
  end if;

  select * into v_folder
    from public.google_drive_client_folders
   where client_id = v_client_id
     and connection_id = p_connection_id;

  if not found then
    raise exception 'CLIENT_FOLDER_NOT_LINKED';
  end if;
  if v_folder.drive_folder_id is distinct from p_expected_parent_id then
    raise exception 'CLIENT_FOLDER_CHANGED_RETRY';
  end if;

  -- Ya reservado: devolver el existente. Nunca un segundo archivo.
  select * into v_existing
    from public.google_drive_document_files
   where document_id = p_document_id;

  if found then
    return jsonb_build_object(
      'driveFileId', v_existing.drive_file_id,
      'driveParentId', v_existing.drive_parent_id,
      'syncStatus', v_existing.sync_status,
      'reserved', false
    );
  end if;

  -- Los last_synced_* quedan NULL a propósito: todavía no hay ninguna
  -- sincronización real contra la que comparar. Ese baseline lo escribe la
  -- finalización, no la reserva.
  insert into public.google_drive_document_files (
    document_id, connection_id, drive_file_id, drive_parent_id, sync_status
  ) values (
    p_document_id, p_connection_id, p_reserved_file_id, p_expected_parent_id, 'pending'
  );

  return jsonb_build_object(
    'driveFileId', p_reserved_file_id,
    'driveParentId', p_expected_parent_id,
    'syncStatus', 'pending',
    'reserved', true
  );
end;
$$;

revoke all on function public.reserve_google_drive_document_file(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_google_drive_document_file(uuid, uuid, text, text)
  to service_role;

-- ── 5. Finalización de archivo de documento ──────────────────────────────
--
-- Escribe el baseline completo del último sync correcto: es lo que en Fase
-- 8F permitirá decidir qué lado cambió sin recurrir a last-write-wins.
create or replace function public.finalize_google_drive_document_file(
  p_document_id uuid,
  p_drive_file_id text,
  p_drive_parent_id text,
  p_web_view_link text,
  p_drive_modified_time timestamptz,
  p_drive_version bigint,
  p_drive_md5 text,
  p_content_hash text,
  p_file_name text,
  p_sync_error text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.google_drive_document_files
     set drive_parent_id = coalesce(p_drive_parent_id, drive_parent_id),
         drive_web_view_link = coalesce(p_web_view_link, drive_web_view_link),
         last_synced_drive_modified_time =
           case when p_sync_error is null then p_drive_modified_time
                else last_synced_drive_modified_time end,
         last_synced_drive_version =
           case when p_sync_error is null then p_drive_version
                else last_synced_drive_version end,
         last_synced_drive_md5_checksum =
           case when p_sync_error is null then p_drive_md5
                else last_synced_drive_md5_checksum end,
         last_synced_content_hash =
           case when p_sync_error is null then p_content_hash
                else last_synced_content_hash end,
         last_synced_file_name =
           case when p_sync_error is null then p_file_name
                else last_synced_file_name end,
         last_synced_drive_parent_id =
           case when p_sync_error is null then coalesce(p_drive_parent_id, drive_parent_id)
                else last_synced_drive_parent_id end,
         sync_status = case when p_sync_error is null then 'synced' else 'error' end,
         sync_error = p_sync_error,
         last_synced_at = case when p_sync_error is null then now() else last_synced_at end,
         updated_at = now()
   where document_id = p_document_id
     and drive_file_id = p_drive_file_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'DOCUMENT_FILE_MAPPING_NOT_FOUND';
  end if;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.finalize_google_drive_document_file(uuid, text, text, text, timestamptz, bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_google_drive_document_file(uuid, text, text, text, timestamptz, bigint, text, text, text, text)
  to service_role;

commit;
