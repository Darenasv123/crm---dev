-- Fase 8B: fundación schema para sincronización Google Drive <-> CRM.
--
-- NO se aplica remotamente como parte de esta fase. Google Drive real
-- permanece desconectado; esta migración solo crea la estructura para que
-- el módulo server-side (src/lib/google-drive/google-drive.server.ts) y las
-- rutas /api/google-drive/* tengan dónde persistir estado, sin ejecutar
-- ninguna llamada real a Drive todavía.
--
-- Decisión de arquitectura (Fase 8A, corregida en 8B): NO se usan
-- documents.source_provider/external_file_id/external_folder_id como
-- mapping canónico de sincronización. Esas columnas describen la
-- PROCEDENCIA genérica de un documento (ya usadas por el importador de ZIP
-- con source_provider='zip_upload') y no deben confundirse con "este
-- documento está sincronizado con Drive". La identidad viva de
-- sincronización vive en google_drive_document_files, una tabla dedicada.
-- documents.source_type SÍ puede seguir registrando 'google_drive' como
-- procedencia visible (la UI ya lo anticipa en _app.documentos.index.tsx),
-- pero eso es metadata descriptiva, no la fuente de verdad del mapping.
--
-- No se crea una séptima tabla "google_drive_sync_state": el mapping y el
-- baseline del último sync exitoso viven juntos en
-- google_drive_document_files (ver comentario extenso más abajo sobre por
-- qué se necesita ese baseline).
--
-- Aislamiento de Calendar: ninguna tabla de Drive reutiliza IDs, tokens ni
-- filas de google_calendar_*. OAuth client separado (GOOGLE_DRIVE_CLIENT_ID/
-- SECRET/REDIRECT_URI, ver server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md),
-- conexión separada, canales separados, cola separada. Esta migración no
-- modifica ninguna tabla ni columna de google_calendar_* ni de agenda_events.
--
-- Todas las tablas nuevas parten vacías -- no hay datos históricos que
-- reconciliar ni riesgo de romper `documents`/`clients` existentes, porque
-- esta migración no altera esas tablas en absoluto (solo las referencia por
-- FK desde las tablas nuevas).

begin;

-- ── google_drive_oauth_states ───────────────────────────────────────────
-- PKCE + state de un solo uso. Mismo patrón que google_calendar_oauth_states:
-- state_hash como PK (el propio hash del state firmado ya es único por
-- construcción), code_verifier persistido solo temporalmente server-side,
-- TTL corto. A diferencia de Calendar, Drive no necesita fijar un
-- "calendar_id" al iniciar el flujo -- la carpeta raíz se elige después de
-- conectar, desde la BD, no durante el propio OAuth.
create table if not exists public.google_drive_oauth_states (
  state_hash text primary key,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_drive_oauth_states_expires_idx
  on public.google_drive_oauth_states (expires_at);

-- ── google_drive_connections ────────────────────────────────────────────
-- Una sola conexión activa a la vez, compartida por el estudio (mismo
-- modelo que Calendar). access_token NUNCA se persiste -- solo el
-- refresh_token cifrado. shared_drive_id queda reservado sin uso (Sección
-- 29 de la Fase 8A): permite añadir soporte a Unidad compartida más
-- adelante sin romper el esquema. changes_page_token guarda el
-- startPageToken de la Changes API de Drive (Fase 8F).
-- encrypted_refresh_token es NULLABLE a propósito (Fase 8B.1): al
-- desconectar, el ciphertext se destruye poniéndolo en NULL en vez de
-- conservarlo. Una conexión declarada 'disconnected' no debe conservar
-- material reutilizable -- si alguien recuperase la fila, no debe poder
-- volver a obtener un access token con ella. La integridad "una conexión
-- conectada siempre tiene token" se garantiza con el CHECK de abajo, no
-- con un NOT NULL de columna.
create table if not exists public.google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  connected_by uuid not null references public.profiles(id) on delete restrict,
  google_account_email text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  granted_scopes text,
  root_folder_id text,
  root_folder_name text,
  shared_drive_id text,
  changes_page_token text,
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Invariante real que sustituye al NOT NULL de columna: una conexión
  -- 'connected' SIEMPRE tiene token; una 'disconnected' NUNCA lo conserva
  -- (se destruye al desconectar). 'error' puede tener o no token según en
  -- qué punto falló, por eso no se restringe.
  constraint google_drive_connections_token_by_status_check check (
    (status = 'connected' and encrypted_refresh_token is not null)
    or (status = 'disconnected' and encrypted_refresh_token is null)
    or status = 'error'
  )
);

create unique index if not exists google_drive_one_active_connection_idx
  on public.google_drive_connections ((status = 'connected'))
  where status = 'connected';

-- ── google_drive_client_folders ─────────────────────────────────────────
-- Mapping Cliente CRM <-> Carpeta Drive. drive_folder_id es la identidad
-- persistente -- nunca el nombre (Fase 8A). match_type documenta cómo se
-- vinculó, sin fuzzy matching: 'exact'/'normalized' vienen del clasificador
-- puro de src/lib/google-drive/client-folder-matching.ts, 'manual' es una
-- resolución de ambigüedad por el Administrador, 'created' es cuando el CRM
-- creó la carpeta (cliente nuevo sin carpeta previa).
--
-- ON DELETE: si se elimina un Cliente, el mapping se elimina con él
-- (cascade) -- ya no hay ninguna relación jurídica que sincronizar, y
-- documents.client_id ya usa "on delete set null" en la tabla base, así que
-- los documentos en sí NO se pierden al borrar un Cliente, solo pierden su
-- referencia -- este mapping de carpeta simplemente deja de tener sentido y
-- se limpia con él. Ningún trigger llama a Drive: el borrado es 100% local
-- (Sección 20 del pedido); si en el futuro se requiere mover la carpeta a
-- la papelera de Drive al borrar un Cliente, será una operación explícita
-- de aplicación vía la cola, nunca un efecto secundario de este DELETE.
create table if not exists public.google_drive_client_folders (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.google_drive_connections(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  drive_folder_id text not null,
  drive_folder_name_snapshot text,
  match_type text not null
    check (match_type in ('exact', 'normalized', 'manual', 'created')),
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'error')),
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_drive_client_folders_client_unique unique (client_id),
  constraint google_drive_client_folders_folder_unique unique (connection_id, drive_folder_id)
);

-- Sin índices adicionales sobre client_id/connection_id: los dos UNIQUE de
-- arriba ya cubren ambos como prefijo izquierdo de un índice B-tree
-- (unique(client_id) es su propio índice; unique(connection_id,
-- drive_folder_id) ya sirve consultas por connection_id sola). Añadir un
-- tercer índice sería estrictamente redundante.

-- ── google_drive_document_files ─────────────────────────────────────────
-- Identidad CANÓNICA de sincronización documental -- ver el comentario de
-- cabecera sobre por qué no se usa documents.external_file_id para esto.
--
-- last_synced_* representan el ÚLTIMO ESTADO SINCRONIZADO CON ÉXITO (el
-- "baseline"), NUNCA el estado actual detectado. Sin este baseline no se
-- puede distinguir "solo cambió Drive" de "cambiaron ambos lados" (Fase 8A,
-- Sección 11): si el hash CRM actual y el md5 de Drive actual difieren
-- entre sí, pero AMBOS también difieren del baseline guardado en el último
-- sync exitoso, hubo cambios independientes en ambos lados -> conflicto. Si
-- solo uno difiere del baseline, ese lado es el que cambió -> sincroniza
-- automático. El código NUNCA debe escribir en las columnas last_synced_*
-- al solo detectar un cambio remoto -- únicamente al completar una
-- sincronización exitosa.
--
-- drive_parent_id (actual, reportado por Drive) vs
-- last_synced_drive_parent_id (baseline): si difieren, es
-- DRIVE_PARENT_MISMATCH (archivo movido a otra carpeta en Drive, Fase 8A
-- Sección 20) -- nunca se reasigna client_id/case_id automáticamente por
-- esto.
create table if not exists public.google_drive_document_files (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.google_drive_connections(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  drive_file_id text not null,
  drive_parent_id text not null,
  drive_web_view_link text,
  last_synced_drive_modified_time timestamptz,
  last_synced_drive_version bigint,
  last_synced_drive_md5_checksum text,
  last_synced_content_hash text,
  last_synced_file_name text,
  last_synced_drive_parent_id text,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'missing', 'conflict', 'error')),
  sync_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_drive_document_files_document_unique unique (document_id),
  constraint google_drive_document_files_file_unique unique (connection_id, drive_file_id)
);

-- Mismo razonamiento que client_folders: los dos UNIQUE de arriba ya cubren
-- document_id y connection_id como índices, sin necesitar uno adicional.

-- ── google_drive_channels ───────────────────────────────────────────────
-- Completamente separada de google_calendar_channels -- IDs, tokens y
-- ciclo de vida propios (Fase 8A Sección 26: nunca mezclar). Igual que
-- Calendar: nunca se guarda el token del canal en claro, solo su hash.
create table if not exists public.google_drive_channels (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.google_drive_connections(id) on delete cascade,
  channel_id text not null unique,
  resource_id text not null,
  channel_token_hash text not null,
  expires_at timestamptz not null,
  stopped_at timestamptz,
  last_message_number bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists google_drive_channels_one_active_idx
  on public.google_drive_channels (connection_id)
  where stopped_at is null;
create index if not exists google_drive_channels_connection_idx
  on public.google_drive_channels (connection_id);

-- ── google_drive_sync_queue ─────────────────────────────────────────────
-- Cola con `operation` explícita (no solo `direction`, Fase 8A Sección 13
-- corregida en 8B Sección 13 del pedido). client_id/document_id/
-- drive_file_id son nullable porque cada operation usa un subconjunto
-- distinto (poll_changes no referencia ningún documento concreto;
-- ensure_client_folder referencia client_id pero no document_id; etc.) --
-- el payload jsonb lleva el detalle específico de cada operación.
--
-- dedupe_key + el índice único parcial de abajo son la garantía real contra
-- condiciones de carrera -- nunca "buscar antes de insertar" (Fase 8B
-- Sección 14). Los valores de dedupe_key los construye el código server
-- (ej. "upload_document:{connection_id}:{document_id}"), esta tabla solo
-- impone la unicidad.
--
-- ON DELETE cascade en connection_id/client_id/document_id: si el objeto
-- referenciado desaparece, la operación en cola ya no tiene sentido y se
-- limpia con él -- ningún trigger llama a Drive por esto.
create table if not exists public.google_drive_sync_queue (
  id bigint generated always as identity primary key,
  connection_id uuid not null
    references public.google_drive_connections(id) on delete cascade,
  operation text not null check (operation in (
    'poll_changes', 'ensure_client_folder', 'upload_document', 'update_document',
    'rename_document', 'trash_document', 'import_drive_file'
  )),
  client_id uuid references public.clients(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  drive_file_id text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedupe real a nivel de BD: nunca dos operaciones activas (pending o
-- processing) con la misma dedupe_key. No cubre 'completed'/'failed' a
-- propósito -- una operación ya terminada no bloquea que se encole una
-- nueva operación lógica equivalente más adelante (ej. el mismo documento
-- se vuelve a modificar después de haberse sincronizado).
create unique index if not exists google_drive_sync_queue_dedupe_idx
  on public.google_drive_sync_queue (dedupe_key)
  where status in ('pending', 'processing');

create index if not exists google_drive_sync_queue_claim_idx
  on public.google_drive_sync_queue (status, available_at);
create index if not exists google_drive_sync_queue_connection_idx
  on public.google_drive_sync_queue (connection_id);
create index if not exists google_drive_sync_queue_document_idx
  on public.google_drive_sync_queue (document_id);
create index if not exists google_drive_sync_queue_client_idx
  on public.google_drive_sync_queue (client_id);
-- Mismo patrón que google_calendar_sync_requests_processing_idx: índice
-- parcial para la consulta de reclamo de operaciones "processing"
-- abandonadas, basada en claimed_at, nunca en created_at (ver función de
-- abajo y el bug real que esto evita, documentado en
-- 20260822090000_google_calendar_sync_queue_claim.sql).
create index if not exists google_drive_sync_queue_processing_idx
  on public.google_drive_sync_queue (claimed_at)
  where status = 'processing';

-- ── triggers updated_at (reutiliza la función existente, no se redefine) ──
drop trigger if exists google_drive_connections_set_updated_at
  on public.google_drive_connections;
create trigger google_drive_connections_set_updated_at
  before update on public.google_drive_connections
  for each row execute function public.set_updated_at();

drop trigger if exists google_drive_client_folders_set_updated_at
  on public.google_drive_client_folders;
create trigger google_drive_client_folders_set_updated_at
  before update on public.google_drive_client_folders
  for each row execute function public.set_updated_at();

drop trigger if exists google_drive_document_files_set_updated_at
  on public.google_drive_document_files;
create trigger google_drive_document_files_set_updated_at
  before update on public.google_drive_document_files
  for each row execute function public.set_updated_at();

drop trigger if exists google_drive_channels_set_updated_at
  on public.google_drive_channels;
create trigger google_drive_channels_set_updated_at
  before update on public.google_drive_channels
  for each row execute function public.set_updated_at();

drop trigger if exists google_drive_sync_queue_set_updated_at
  on public.google_drive_sync_queue;
create trigger google_drive_sync_queue_set_updated_at
  before update on public.google_drive_sync_queue
  for each row execute function public.set_updated_at();

-- ── claim atómico de la cola (Fase 8B Sección 15) ──────────────────────
-- SELECT...FOR UPDATE SKIP LOCKED + UPDATE + RETURNING en una sola
-- operación: múltiples workers concurrentes nunca pueden reclamar la misma
-- fila (cada uno solo ve, a través de su propia transacción, las filas
-- pending que ningún otro tiene ya bloqueadas). No es SECURITY DEFINER a
-- propósito -- el único invocador previsto es el servidor usando la
-- service_role key, que ya tiene privilegios completos; escalar privilegios
-- adicionales aquí no aporta nada y solo amplía la superficie de riesgo
-- (Fase 8B Sección 16: "no asumir que SECURITY DEFINER basta" también
-- implica no usarlo sin una razón real).
create or replace function public.claim_google_drive_sync_operations(p_limit integer default 10)
returns setof public.google_drive_sync_queue
language plpgsql
volatile
set search_path = public
as $$
begin
  return query
    update public.google_drive_sync_queue q
       set status = 'processing',
           claimed_at = now(),
           attempt_count = q.attempt_count + 1,
           updated_at = now()
      from (
        select id
          from public.google_drive_sync_queue
         where status = 'pending'
           and available_at <= now()
         order by created_at
         limit greatest(p_limit, 0)
           for update skip locked
      ) as claimed
     where q.id = claimed.id
    returning q.*;
end;
$$;

-- Explícito, no asumido: revoca de todos los roles de cliente y otorga
-- únicamente a service_role (Fase 8B Sección 16).
revoke all on function public.claim_google_drive_sync_operations(integer)
  from public, anon, authenticated;
grant execute on function public.claim_google_drive_sync_operations(integer)
  to service_role;

-- ── sustitución atómica de conexión (Fase 8B.1 Sección 15) ─────────────
-- El callback de OAuth debe reemplazar la conexión activa por una nueva en
-- UNA sola operación. Hacerlo desde el cliente JS en pasos separados
-- (SELECT anteriores -> DELETE cada una -> INSERT la nueva) no es atómico:
-- dos callbacks válidos completados casi a la vez podrían ambos borrar la
-- conexión previa y luego competir por el INSERT, dejando el sistema sin
-- ninguna conexión activa si el ganador falla, o con la conexión válida ya
-- destruida por el perdedor.
--
-- Esta función corre entera dentro de una transacción de Postgres: el
-- UPDATE que desactiva la anterior y el INSERT de la nueva son
-- indivisibles. El índice único parcial sobre status='connected' sigue
-- siendo el árbitro final -- si dos ejecuciones concurrentes llegan al
-- INSERT, una obtiene el lock de la fila anterior y la otra espera; la
-- segunda verá el estado ya actualizado y su propio INSERT fallará o
-- procederá de forma consistente, nunca dejando dos tokens utilizables.
--
-- La conexión anterior NO se borra: se marca 'disconnected' y se destruye
-- su ciphertext (encrypted_refresh_token = null). Conservar la fila deja
-- rastro auditable de cuándo/quién conectó; destruir el token impide que
-- una conexión desactivada pueda volver a usarse.
--
-- Deliberadamente NO revoca nada contra Google (Fase 8B.1 Sección 2/3):
-- revocar un token revoca los grants a nivel de PROYECTO de Google Cloud,
-- lo que podría invalidar los tokens de Calendar mientras ambos servicios
-- compartan proyecto. La revocación remota se reintroducirá solo cuando
-- Drive tenga su propio proyecto dedicado.
create or replace function public.replace_google_drive_connection(
  p_connected_by uuid,
  p_google_account_email text,
  p_encrypted_refresh_token text,
  p_access_token_expires_at timestamptz,
  p_granted_scopes text
)
returns public.google_drive_connections
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
begin
  update public.google_drive_connections
     set status = 'disconnected',
         encrypted_refresh_token = null,
         changes_page_token = null,
         updated_at = now()
   where status = 'connected';

  insert into public.google_drive_connections (
    connected_by,
    google_account_email,
    encrypted_refresh_token,
    access_token_expires_at,
    granted_scopes,
    status
  ) values (
    p_connected_by,
    p_google_account_email,
    p_encrypted_refresh_token,
    p_access_token_expires_at,
    p_granted_scopes,
    'connected'
  )
  returning * into v_connection;

  return v_connection;
end;
$$;

revoke all on function public.replace_google_drive_connection(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.replace_google_drive_connection(uuid, text, text, timestamptz, text)
  to service_role;

-- ── desconexión local (Fase 8B.1 Sección 3) ────────────────────────────
-- Desconexión EXCLUSIVAMENTE local: marca la conexión activa como
-- 'disconnected' y destruye su refresh token cifrado. Nunca llama a
-- Google (ver el razonamiento de revocación arriba), nunca toca Clientes,
-- Documentos ni ninguna tabla de Calendar.
create or replace function public.disconnect_google_drive_connection()
returns public.google_drive_connections
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
begin
  update public.google_drive_connections
     set status = 'disconnected',
         encrypted_refresh_token = null,
         changes_page_token = null,
         updated_at = now()
   where status = 'connected'
  returning * into v_connection;

  return v_connection;
end;
$$;

revoke all on function public.disconnect_google_drive_connection()
  from public, anon, authenticated;
grant execute on function public.disconnect_google_drive_connection()
  to service_role;

-- ── RLS: las 6 tablas quedan habilitadas SIN ninguna política para
-- anon/authenticated (Fase 8B Sección 18: "sin policies authenticated").
-- RLS habilitado + cero políticas = denegado por defecto para cualquier rol
-- sujeto a RLS; únicamente service_role (que en Supabase evita RLS por
-- diseño de la plataforma) puede leer/escribir, siempre desde rutas
-- server-side (/api/google-drive/*), nunca directamente desde el cliente.
-- Esto es deliberadamente más estricto que las políticas admin-select/
-- insert/update/delete que sí tiene google_calendar_connections hoy -- una
-- mejora de postura para Drive, no una inconsistencia (Calendar no se toca
-- en esta fase).
alter table public.google_drive_oauth_states enable row level security;
alter table public.google_drive_connections enable row level security;
alter table public.google_drive_client_folders enable row level security;
alter table public.google_drive_document_files enable row level security;
alter table public.google_drive_channels enable row level security;
alter table public.google_drive_sync_queue enable row level security;

-- REVOKE explícito, no confiar solo en la ausencia de policies (Fase 8B.1
-- Sección 10): RLS sin policies ya deniega, pero un GRANT heredado de
-- `alter default privileges` o de un `grant ... on all tables` posterior
-- podría reintroducir acceso de tabla sin que nadie lo note. Estos REVOKE
-- dejan la intención registrada de forma explícita e idempotente.
revoke all on public.google_drive_oauth_states from public, anon, authenticated;
revoke all on public.google_drive_connections from public, anon, authenticated;
revoke all on public.google_drive_client_folders from public, anon, authenticated;
revoke all on public.google_drive_document_files from public, anon, authenticated;
revoke all on public.google_drive_channels from public, anon, authenticated;
revoke all on public.google_drive_sync_queue from public, anon, authenticated;

-- service_role opera server-side y evita RLS por diseño de la plataforma,
-- pero necesita el GRANT de tabla explícito: `0006_rls_and_grants.sql`
-- ejecutó `grant all on all tables in schema public to service_role` sobre
-- las tablas que existían EN ESE MOMENTO -- no cubre tablas creadas
-- después por una migración incremental como esta (Fase 8B.1 Sección 11).
-- No se crean policies para service_role: no las usa ni las necesita.
grant select, insert, update, delete on
  public.google_drive_oauth_states,
  public.google_drive_connections,
  public.google_drive_client_folders,
  public.google_drive_document_files,
  public.google_drive_channels,
  public.google_drive_sync_queue
to service_role;

-- google_drive_sync_queue.id es `generated always as identity`: su
-- secuencia también necesita permiso explícito para que los INSERT de
-- service_role funcionen.
grant usage, select on sequence public.google_drive_sync_queue_id_seq to service_role;
revoke all on sequence public.google_drive_sync_queue_id_seq from public, anon, authenticated;

commit;
