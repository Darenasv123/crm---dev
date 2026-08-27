-- Fase 8F: Google Drive -- sincronización automática, change feed,
-- watch/webhook, reconciliación y detección de conflictos.
--
-- NO se aplica remotamente como parte de esta fase. Google Drive real sigue
-- desconectado.
--
-- Migración INCREMENTAL: las cuatro migraciones anteriores de Drive
-- (20260824100000, 20260824110000, 20260825100000, 20260825110000) ya
-- están commiteadas y NO se modifican.
--
-- Auditoría previa (Sección 2 del pedido) -- qué YA existía antes de tocar
-- nada:
--   google_drive_connections   ya tenía: changes_page_token (Fase 8B,
--     anticipado sin usar todavía), status, last_synced_at, last_error.
--     Faltaban: changes_initialized_at, last_changes_polled_at,
--     last_reconciled_at, reconciliation_claimed_at.
--   google_drive_channels      ya tenía: channel_id, resource_id,
--     channel_token_hash, expires_at, stopped_at, last_message_number --
--     exactamente lo necesario para watch/stop. Solo faltaba una forma de
--     modelar la renovación con solapamiento controlado (ver más abajo).
--     Sin cambios de columna salvo `superseded_at`.
--   google_drive_client_folders  su `sync_status` solo admitía
--     ('pending','synced','error') -- suficiente para el onboarding de 8C,
--     insuficiente para el drift detectado en curso por 8F (Secciones
--     20/23: carpeta movida o eliminada DESPUÉS de vincularse). Se amplía
--     el CHECK para incluir 'conflict'/'missing', igual que ya tiene
--     google_drive_document_files desde 8B.
--   google_drive_document_files  su `sync_status` YA admite
--     ('pending','synced','missing','conflict','error') desde 8B -- no
--     necesita ningún cambio de columna para 8F.
--   google_drive_sync_queue    su `operation` YA admite 'poll_changes'
--     desde 8B (anticipado sin implementación hasta ahora) -- no necesita
--     ningún cambio de CHECK.
-- No se crean columnas decorativas: cada columna nueva de abajo es
-- consumida por una comprobación real documentada en su propio comentario.

begin;

-- ── google_drive_connections: bookkeeping de change tracking/reconciliación
alter table public.google_drive_connections
  add column if not exists changes_initialized_at timestamptz,
  add column if not exists last_changes_polled_at timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists reconciliation_claimed_at timestamptz;

comment on column public.google_drive_connections.changes_initialized_at is
  'Momento del bootstrap (Fase 8F Sección 5): cuándo se obtuvo T0 vía getStartPageToken. NULL = change tracking nunca inicializado.';
comment on column public.google_drive_connections.last_changes_polled_at is
  'Última vez que poll_changes avanzó el cursor con éxito (advance_google_drive_change_token). Para status/observabilidad, nunca para decidir el cursor.';
comment on column public.google_drive_connections.last_reconciled_at is
  'Última reconciliación completada con éxito. El cursor de changes NUNCA se avanza por esto (Sección 48): son mecanismos independientes.';
comment on column public.google_drive_connections.reconciliation_claimed_at is
  'CAS de un solo reconciliation activo por conexión (Sección 47). NULL o expirado = reclamable; ver claim_google_drive_reconciliation.';

-- ── google_drive_client_folders: drift detectado en curso, no solo errores
-- de onboarding (Fase 8F Secciones 20/23). El nombre de la restricción es
-- el que Postgres asignó por defecto a la definición original (verificado
-- contra el esquema real antes de escribir este DROP, nunca asumido).
alter table public.google_drive_client_folders
  drop constraint if exists google_drive_client_folders_sync_status_check;
alter table public.google_drive_client_folders
  add constraint google_drive_client_folders_sync_status_check
  check (sync_status in ('pending', 'synced', 'missing', 'conflict', 'error'));

-- ── google_drive_channels: renovación con solapamiento controlado ────────
-- El índice único original (`stopped_at is null`) IMPIDE crear el canal
-- nuevo antes de detener el viejo (Sección 35: "Crear NUEVO... Solo
-- después: marcar anterior... NO detener channel viejo antes de haber
-- creado el nuevo"): con esa regla, insertar el canal nuevo mientras el
-- viejo sigue con `stopped_at is null` violaría la unicidad. Se sustituye
-- por `superseded_at`, que la propia función de rotación (más abajo) fija
-- de forma atómica ANTES de insertar el nuevo, dentro de la misma
-- transacción -- nunca hay dos filas con `superseded_at is null` a la vez.
-- `stopped_at` conserva su significado original: "channels.stop remoto
-- confirmado", independiente de si el canal ya fue reemplazado localmente
-- (Sección 68: el stop remoto es best-effort y puede no completarse nunca
-- sin que eso invalide el canal nuevo).
alter table public.google_drive_channels
  add column if not exists superseded_at timestamptz;

comment on column public.google_drive_channels.superseded_at is
  'Fijado atómicamente por rotate_google_drive_channel al crear un canal de reemplazo (Sección 35). Distinto de stopped_at (confirmación remota de channels.stop, best-effort).';

drop index if exists public.google_drive_channels_one_active_idx;
create unique index if not exists google_drive_channels_one_current_idx
  on public.google_drive_channels (connection_id)
  where superseded_at is null;

-- ── initialize_google_drive_change_token (Fase 8F Sección 5/6) ──────────
-- Bootstrap de UNA sola vez: si la conexión ya tiene un token, esta llamada
-- es un no-op idempotente que devuelve el token YA persistido -- nunca lo
-- sobrescribe con un T0 más nuevo, porque eso perdería exactamente los
-- cambios ocurridos entre el T0 original y este segundo intento de
-- bootstrap (la razón de ser de T0 según la Sección 5 del pedido).
create or replace function public.initialize_google_drive_change_token(
  p_connection_id uuid,
  p_start_page_token text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
begin
  if p_start_page_token is null or length(trim(p_start_page_token)) = 0 then
    raise exception 'DRIVE_CHANGE_TOKEN_INVALID';
  end if;

  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if v_connection.changes_page_token is not null then
    return jsonb_build_object(
      'initialized', false, 'token', v_connection.changes_page_token
    );
  end if;

  update public.google_drive_connections
     set changes_page_token = p_start_page_token,
         changes_initialized_at = now()
   where id = p_connection_id;

  return jsonb_build_object('initialized', true, 'token', p_start_page_token);
end;
$$;

revoke all on function public.initialize_google_drive_change_token(uuid, text)
  from public, anon, authenticated;
grant execute on function public.initialize_google_drive_change_token(uuid, text)
  to service_role;

-- ── advance_google_drive_change_token (Fase 8F Sección 6/8/10) ──────────
-- Compare-and-swap real: solo avanza el cursor si nadie más lo movió desde
-- que este poller lo leyó. Dos pollers con el mismo token de partida NUNCA
-- pueden avanzar ambos -- el segundo encuentra `changes_page_token`
-- distinto de lo que esperaba y falla explícitamente, en vez de
-- sobrescribir con last-write-wins (que arriesgaría retroceder el cursor
-- o, peor, hacerlo avanzar dos veces perdiendo la página intermedia de
-- alguno de los dos).
create or replace function public.advance_google_drive_change_token(
  p_connection_id uuid,
  p_expected_current_token text,
  p_new_token text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
begin
  if p_new_token is null or length(trim(p_new_token)) = 0 then
    raise exception 'DRIVE_CHANGE_TOKEN_INVALID';
  end if;

  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if v_connection.changes_page_token is distinct from p_expected_current_token then
    raise exception 'DRIVE_CHANGE_TOKEN_CHANGED_RETRY';
  end if;

  update public.google_drive_connections
     set changes_page_token = p_new_token,
         last_changes_polled_at = now()
   where id = p_connection_id;

  return jsonb_build_object('token', p_new_token);
end;
$$;

revoke all on function public.advance_google_drive_change_token(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.advance_google_drive_change_token(uuid, text, text)
  to service_role;

-- ── claim/complete_google_drive_reconciliation (Fase 8F Sección 39/47) ──
-- CAS sobre `reconciliation_claimed_at`, nunca un lock de Postgres abierto
-- durante llamadas a Google (Sección 47: "No lock DB abierto durante
-- llamadas Google") -- el claim se libera con un UPDATE normal, no con una
-- transacción que se mantiene viva mientras dura todo el escaneo.
create or replace function public.claim_google_drive_reconciliation(
  p_connection_id uuid,
  p_stale_after_seconds integer default 3600
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
begin
  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if v_connection.reconciliation_claimed_at is not null
     and v_connection.reconciliation_claimed_at
       > now() - make_interval(secs => greatest(p_stale_after_seconds, 0)) then
    return jsonb_build_object('claimed', false);
  end if;

  update public.google_drive_connections
     set reconciliation_claimed_at = now()
   where id = p_connection_id;

  return jsonb_build_object('claimed', true);
end;
$$;

revoke all on function public.claim_google_drive_reconciliation(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_google_drive_reconciliation(uuid, integer)
  to service_role;

-- Nunca toca el cursor de changes (Sección 48): completar una
-- reconciliación es independiente de avanzar changes_page_token.
create or replace function public.complete_google_drive_reconciliation(
  p_connection_id uuid
)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  update public.google_drive_connections
     set last_reconciled_at = now(),
         reconciliation_claimed_at = null
   where id = p_connection_id;
end;
$$;

revoke all on function public.complete_google_drive_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_google_drive_reconciliation(uuid)
  to service_role;

-- ── rotate_google_drive_channel (Fase 8F Sección 35/67/68) ──────────────
-- Atómico: supersede el canal anterior (si lo había) e inserta el nuevo en
-- la MISMA transacción, en ese orden -- nunca al revés, porque el índice
-- único `(connection_id) where superseded_at is null` rechazaría insertar
-- el nuevo mientras el viejo siga sin marcar. El `channels.stop` remoto
-- NUNCA ocurre aquí: es una llamada HTTP a Google que esta función, por
-- diseño, no hace (ninguna RPC de Drive llama a Google) -- vive en
-- TypeScript, después de que esta función confirme el nuevo canal, y es
-- deliberadamente best-effort (Sección 35: "Si stop remoto falla: aceptar
-- overlap").
create or replace function public.rotate_google_drive_channel(
  p_connection_id uuid,
  p_old_channel_id text,
  p_new_channel_id text,
  p_new_resource_id text,
  p_new_channel_token_hash text,
  p_new_expires_at timestamptz
)
returns public.google_drive_channels
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_new public.google_drive_channels;
begin
  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if p_old_channel_id is not null then
    update public.google_drive_channels
       set superseded_at = now()
     where connection_id = p_connection_id
       and channel_id = p_old_channel_id
       and superseded_at is null;
  end if;

  insert into public.google_drive_channels (
    connection_id, channel_id, resource_id, channel_token_hash, expires_at
  ) values (
    p_connection_id, p_new_channel_id, p_new_resource_id, p_new_channel_token_hash, p_new_expires_at
  )
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.rotate_google_drive_channel(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_google_drive_channel(uuid, text, text, text, text, timestamptz)
  to service_role;

-- ── repair_google_drive_document_mapping (Fase 8F Sección 16) ───────────
-- SOLO repara el mapping de un documento outbound que el CRM ya gestiona
-- (existe en `documents`) pero cuyo `google_drive_document_files` se
-- perdió -- NUNCA descarga ni recrea el documento, NUNCA crea uno nuevo.
-- Exige que TODOS los invariantes coincidan exactamente: el documento
-- referenciado existe y pertenece al Cliente indicado, la carpeta de ese
-- Cliente sigue vinculada+sincronizada exactamente con el parent reportado
-- por Drive, y ni el documento ni el drive_file_id ya tienen un mapping
-- (evita pisar una identidad ya resuelta). Si cualquier dato discrepa, se
-- rechaza con un código estable -- nunca se repara "a medias" ni se
-- adivina.
create or replace function public.repair_google_drive_document_mapping(
  p_connection_id uuid,
  p_expected_root_folder_id text,
  p_document_id uuid,
  p_client_id uuid,
  p_drive_file_id text,
  p_drive_parent_id text,
  p_name text,
  p_web_view_link text,
  p_drive_modified_time timestamptz,
  p_drive_version bigint,
  p_drive_md5 text,
  p_content_hash text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_folder public.google_drive_client_folders;
  v_document public.documents;
  v_existing_by_document public.google_drive_document_files;
  v_existing_by_file public.google_drive_document_files;
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

  select * into v_document from public.documents where id = p_document_id;
  if not found then
    -- El documento ya no existe: esto NUNCA es un repair, es exactamente
    -- el escenario de huérfano de 8E -- el llamador debe clasificarlo como
    -- OUTBOUND_ORPHAN_REVIEW_REQUIRED, no invocar esta función para él.
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  if v_document.client_id is distinct from p_client_id then
    raise exception 'DOCUMENT_CLIENT_MISMATCH';
  end if;

  select * into v_folder
    from public.google_drive_client_folders
   where connection_id = p_connection_id
     and client_id = p_client_id;

  if not found
     or v_folder.drive_folder_id is distinct from p_drive_parent_id
     or v_folder.sync_status <> 'synced' then
    raise exception 'CLIENT_FOLDER_CHANGED_RETRY';
  end if;

  select * into v_existing_by_document
    from public.google_drive_document_files
   where document_id = p_document_id;
  if found then
    raise exception 'DOCUMENT_ALREADY_MAPPED';
  end if;

  select * into v_existing_by_file
    from public.google_drive_document_files
   where connection_id = p_connection_id
     and drive_file_id = p_drive_file_id;
  if found then
    raise exception 'DRIVE_FILE_ALREADY_IMPORTED';
  end if;

  insert into public.google_drive_document_files (
    document_id, connection_id, drive_file_id, drive_parent_id, drive_web_view_link,
    last_synced_drive_modified_time, last_synced_drive_version, last_synced_drive_md5_checksum,
    last_synced_content_hash, last_synced_file_name, last_synced_drive_parent_id,
    sync_status, sync_error, last_synced_at
  ) values (
    p_document_id, p_connection_id, p_drive_file_id, p_drive_parent_id, p_web_view_link,
    p_drive_modified_time, p_drive_version, p_drive_md5,
    p_content_hash, p_name, p_drive_parent_id,
    'synced', null, now()
  );

  return jsonb_build_object('repaired', true, 'documentId', p_document_id);
end;
$$;

revoke all on function public.repair_google_drive_document_mapping(
  uuid, text, uuid, uuid, text, text, text, text, timestamptz, bigint, text, text
) from public, anon, authenticated;
grant execute on function public.repair_google_drive_document_mapping(
  uuid, text, uuid, uuid, text, text, text, text, timestamptz, bigint, text, text
) to service_role;

commit;
