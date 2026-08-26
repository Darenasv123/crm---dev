-- Fase 8E: Drive -> CRM, importación de archivos añadidos manualmente en
-- carpetas de Cliente ya vinculadas.
--
-- NO se aplica remotamente como parte de esta fase. Google Drive real sigue
-- desconectado.
--
-- Migración INCREMENTAL: las tres migraciones anteriores de Drive
-- (20260824100000, 20260824110000, 20260825100000) ya están commiteadas y
-- NO se modifican. Esta solo añade una función.
--
-- Alcance de 8E: SOLO el consumidor/importador. Nada en esta migración ni
-- en el código de esta fase produce el evento "hay un archivo nuevo" --
-- ningún changes.list, changes.watch ni reconciliación. Eso es Fase 8F, que
-- invocará el mismo helper de encolado (enqueueGoogleDriveImportFile) y el
-- mismo worker que esta fase construye.

begin;

-- ── finalización atómica de un import Drive -> CRM ───────────────────────
--
-- Corre en UNA transacción: valida conexión y raíz, valida que la carpeta
-- del Cliente siga siendo exactamente la esperada, comprueba idempotencia
-- por drive_file_id, y solo entonces inserta en `documents` y en
-- `google_drive_document_files`. Si cualquier paso falla, ninguna de las dos
-- inserciones queda parcialmente aplicada -- son la MISMA transacción.
--
-- NO llama a Google. NO llama a Storage. Todo lo que llega aquí (bytes ya
-- descargados y verificados, metadata ya revalidada) se validó ANTES, en el
-- worker de TypeScript.
--
-- `type`/`document_type` se fijan a 'Otros' DENTRO de la función, nunca
-- como parámetro: es la misma regla de "no inferir case/tipo desde nombre o
-- subcarpeta" (Fase 8E Sección 6/48) aplicada también a nivel de base de
-- datos, para que ningún futuro caller pueda colarla por accidente.
--
-- `created_by` se deja explícitamente NULL: este documento no lo subió
-- ninguna sesión interactiva del CRM, así que atribuírselo a un
-- Administrador concreto sería una atribución falsa (Fase 8E Sección 5).
-- La columna ya es nullable en el esquema base -- no fue necesario ningún
-- cambio de columna para esto.
create or replace function public.finalize_google_drive_import(
  p_connection_id uuid,
  p_expected_root_folder_id text,
  p_client_id uuid,
  p_target_document_id uuid,
  p_drive_file_id text,
  p_drive_parent_id text,
  p_storage_path text,
  p_name text,
  p_mime_type text,
  p_size_label text,
  p_file_size bigint,
  p_content_hash text,
  p_web_view_link text,
  p_drive_modified_time timestamptz,
  p_drive_version bigint,
  p_drive_md5 text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_folder public.google_drive_client_folders;
  v_existing_by_file public.google_drive_document_files;
  v_existing_document_id uuid;
begin
  -- 1. Conexión: misma serialización que el resto de RPC de Drive (FOR
  --    UPDATE + raíz esperada), para que un cambio de raíz concurrente no
  --    pueda colarse a mitad de un import.
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

  -- 2. La carpeta del Cliente debe seguir siendo EXACTAMENTE la esperada:
  --    mismo drive_folder_id, y sincronizada. El worker ya revalidó esto
  --    contra Drive antes de llegar aquí; esto es la garantía final a
  --    nivel de base de datos, no una repetición redundante -- protege
  --    contra que el mapping cambiara entre esa revalidación y este commit.
  select * into v_folder
    from public.google_drive_client_folders
   where connection_id = p_connection_id
     and client_id = p_client_id;

  if not found
     or v_folder.drive_folder_id is distinct from p_drive_parent_id
     or v_folder.sync_status <> 'synced' then
    raise exception 'CLIENT_FOLDER_CHANGED_RETRY';
  end if;

  -- 3. Idempotencia por drive_file_id (Fase 8E Sección 28).
  select * into v_existing_by_file
    from public.google_drive_document_files
   where connection_id = p_connection_id
     and drive_file_id = p_drive_file_id;

  if found then
    if v_existing_by_file.document_id = p_target_document_id then
      -- Caso B: exactamente este import, repetido. Éxito idempotente.
      return jsonb_build_object(
        'created', false, 'documentId', v_existing_by_file.document_id, 'unchanged', true
      );
    end if;
    -- Caso C: otro worker ya importó este mismo archivo con OTRO
    -- document_id. Nunca se crea un segundo documento para el mismo
    -- drive_file_id.
    raise exception 'DRIVE_FILE_ALREADY_IMPORTED';
  end if;

  -- 4. El UUID reservado no debe pertenecer ya a otro documento (Caso D:
  --    colisión de identidad, en la práctica solo alcanzable por un fallo
  --    de generación de UUID en la capa de TypeScript).
  select id into v_existing_document_id from public.documents where id = p_target_document_id;
  if found then
    raise exception 'IMPORT_IDENTITY_CONFLICT';
  end if;

  -- 5. INSERT documents -- procedencia real Drive (Fase 8E Sección 29).
  --    case_id siempre NULL: la relación de expediente nunca se infiere
  --    aquí (Fase 8E Sección 6/48), se hace después dentro del CRM si
  --    corresponde.
  insert into public.documents (
    id, name, original_name, display_name,
    type, document_type, mime_type,
    size, file_size, storage_path,
    client_id, case_id,
    source_type, source_provider,
    external_file_id, external_folder_id, external_url,
    content_hash, checksum,
    processing_status, verification_status,
    created_by
  ) values (
    p_target_document_id, p_name, p_name, p_name,
    'Otros', 'Otros', p_mime_type,
    p_size_label, p_file_size, p_storage_path,
    p_client_id, null,
    'google_drive', 'google_drive',
    p_drive_file_id, p_drive_parent_id, p_web_view_link,
    p_content_hash, p_content_hash,
    'pending', 'pending',
    null
  );

  -- 6. INSERT google_drive_document_files -- mapping canónico de sync,
  --    igual filosofía que el baseline outbound de Fase 8D.
  insert into public.google_drive_document_files (
    document_id, connection_id, drive_file_id, drive_parent_id, drive_web_view_link,
    last_synced_drive_modified_time, last_synced_drive_version, last_synced_drive_md5_checksum,
    last_synced_content_hash, last_synced_file_name, last_synced_drive_parent_id,
    sync_status, sync_error, last_synced_at
  ) values (
    p_target_document_id, p_connection_id, p_drive_file_id, p_drive_parent_id, p_web_view_link,
    p_drive_modified_time, p_drive_version, p_drive_md5,
    p_content_hash, p_name, p_drive_parent_id,
    'synced', null, now()
  );

  return jsonb_build_object('created', true, 'documentId', p_target_document_id, 'unchanged', false);
end;
$$;

revoke all on function public.finalize_google_drive_import(
  uuid, text, uuid, uuid, text, text, text, text, text, text, bigint, text, text, timestamptz, bigint, text
) from public, anon, authenticated;
grant execute on function public.finalize_google_drive_import(
  uuid, text, uuid, uuid, text, text, text, text, text, text, bigint, text, text, timestamptz, bigint, text
) to service_role;

commit;
