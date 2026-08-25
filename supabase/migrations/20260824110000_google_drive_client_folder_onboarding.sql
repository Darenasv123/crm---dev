-- Fase 8C: onboarding Cliente <-> Carpeta de Google Drive.
-- Fase 8C.1: serialización de las dos operaciones que gobiernan la raíz.
--
-- NO se aplica remotamente como parte de esta fase. Google Drive real sigue
-- desconectado; esta migración solo añade las dos RPC que escriben el estado
-- de vinculación, de forma atómica y serializada.
--
-- Migración INCREMENTAL: la de Fase 8B
-- (20260824100000_google_drive_sync_foundation.sql) ya está commiteada y no
-- se modifica. Aquí no se crea ninguna tabla ni se altera ninguna columna --
-- google_drive_client_folders ya tiene todo lo necesario, incluidas las dos
-- constraints UNIQUE que son la garantía final de este flujo.
--
--
-- ── Por qué DOS funciones y no escrituras sueltas desde TypeScript ───────
--
-- 1) Atomicidad del lote. El Administrador confirma un LOTE de vinculaciones
--    (A->Carpeta1, B->Carpeta2, C->Carpeta3). Insertadas una a una desde
--    Node, si la tercera choca con una constraint las dos primeras ya
--    quedaron guardadas: el Administrador vería un error con la mitad del
--    trabajo aplicado, sin saber cuál mitad. Una función plpgsql corre
--    entera dentro de una transacción, así que cualquier excepción revierte
--    el lote completo.
--
-- 2) Carrera entre cambiar la raíz y aplicar vinculaciones (Fase 8C.1).
--    Partiendo de root = R1 y cero vinculaciones, dos peticiones
--    simultáneas -- una que cambia la raíz a R2 y otra que vincula un
--    Cliente a una carpeta hija de R1 -- podían validar ambas antes de que
--    la otra escribiera, dejando root = R2 con una vinculación validada
--    contra R1. Eso rompe el invariante central del diseño: toda carpeta
--    vinculada cuelga directamente de la raíz configurada.
--
--    La solución es serializar sobre el recurso que gobierna ambos
--    invariantes: la propia fila de google_drive_connections. Las dos
--    funciones empiezan con SELECT ... FOR UPDATE sobre esa fila, así que
--    nunca se ejecutan a la vez, y cada una comprueba que la raíz siga
--    siendo la que su llamante validó (p_expected_*). No hacen falta
--    advisory locks.
--
-- Deliberadamente NO se llama a Google desde PostgreSQL. La validación
-- contra Drive (la carpeta existe, es carpeta, no está en la papelera y
-- cuelga directamente de la raíz) ocurre ANTES en la ruta server-side; aquí
-- solo llegan datos ya verificados, y estas funciones se limitan a
-- serialización, atomicidad y constraints.

begin;

-- ── carpeta raíz: cambio atómico y serializado ───────────────────────────
--
-- p_expected_current_root_folder_id cierra el TOCTOU: es la raíz que el
-- servidor leyó al empezar el flujo, antes de ir a Google a validar la
-- carpeta nueva. Si al obtener el lock la raíz ya no es esa, alguien la
-- cambió mientras tanto y esta operación se rechaza en vez de pisar el
-- cambio ajeno (nada de last-write-wins silencioso). Se usa IS DISTINCT
-- FROM para que NULL -- "todavía no hay raíz" -- se compare correctamente.
create or replace function public.set_google_drive_root_folder(
  p_connection_id uuid,
  p_expected_current_root_folder_id text,
  p_new_root_folder_id text,
  p_new_root_folder_name text,
  p_new_shared_drive_id text
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_mapping_count integer;
  v_unchanged boolean;
begin
  -- Serializa contra apply_google_drive_client_folder_mappings y contra
  -- otro cambio de raíz simultáneo.
  select * into v_connection
    from public.google_drive_connections
   where id = p_connection_id
   for update;

  if not found or v_connection.status <> 'connected' then
    raise exception 'DRIVE_NOT_CONNECTED';
  end if;

  if v_connection.root_folder_id is distinct from p_expected_current_root_folder_id then
    raise exception 'DRIVE_ROOT_CHANGED_RETRY';
  end if;

  v_unchanged := v_connection.root_folder_id is not distinct from p_new_root_folder_id;

  -- Solo se bloquea el cambio REAL de raíz. Volver a elegir la misma carpeta
  -- es idempotente y sirve para refrescar el nombre o el driveId aunque ya
  -- existan vinculaciones.
  if not v_unchanged then
    select count(*) into v_mapping_count
      from public.google_drive_client_folders
     where connection_id = p_connection_id;

    if v_mapping_count > 0 then
      raise exception 'ROOT_FOLDER_HAS_EXISTING_MAPPINGS';
    end if;
  end if;

  update public.google_drive_connections
     set root_folder_id = p_new_root_folder_id,
         root_folder_name = p_new_root_folder_name,
         shared_drive_id = p_new_shared_drive_id,
         updated_at = now()
   where id = p_connection_id;

  return jsonb_build_object(
    'rootFolderId', p_new_root_folder_id,
    'rootFolderName', p_new_root_folder_name,
    'unchanged', v_unchanged
  );
end;
$$;

revoke all on function public.set_google_drive_root_folder(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_google_drive_root_folder(uuid, text, text, text, text)
  to service_role;

-- ── vinculaciones: lote atómico y serializado ────────────────────────────
--
-- Entrada: jsonb array de objetos
--   { client_id, drive_folder_id, drive_folder_name_snapshot, match_type }
--
-- Salida: jsonb { created, unchanged }
--   created   = vinculaciones nuevas efectivamente insertadas
--   unchanged = vinculaciones que ya existían EXACTAMENTE igual
--
-- p_expected_root_folder_id es la raíz contra la que la ruta validó cada
-- carpeta en Google. Si al obtener el lock ya no coincide, la validación se
-- hizo contra un árbol que ya no está vigente y no se persiste nada.
--
-- Idempotencia (Fase 8C Sección 33): repetir Cliente A <-> Carpeta X cuando
-- ese par ya existe NO es un error -- reintentar un apply tras un timeout de
-- red debe converger, no fallar. En cambio, Cliente A <-> Carpeta Y (mismo
-- cliente, otra carpeta) y Cliente B <-> Carpeta X (misma carpeta, otro
-- cliente) sí son errores: son intentos de re-vincular algo ya vinculado, y
-- resolverlo requiere una desvinculación explícita que esta fase no ofrece.
-- Nunca se reemplaza un mapping en silencio.
create or replace function public.apply_google_drive_client_folder_mappings(
  p_connection_id uuid,
  p_linked_by uuid,
  p_expected_root_folder_id text,
  p_mappings jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_connection public.google_drive_connections;
  v_mapping jsonb;
  v_client_id uuid;
  v_folder_id text;
  v_folder_name text;
  v_match_type text;
  v_existing_folder_id text;
  v_existing_client_id uuid;
  v_created integer := 0;
  v_unchanged integer := 0;
begin
  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'INVALID_MAPPINGS_PAYLOAD';
  end if;

  -- Serializa contra set_google_drive_root_folder: mientras este lote se
  -- escribe, nadie puede mover la raíz bajo sus pies.
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

  for v_mapping in select * from jsonb_array_elements(p_mappings)
  loop
    v_client_id := (v_mapping ->> 'client_id')::uuid;
    v_folder_id := v_mapping ->> 'drive_folder_id';
    v_folder_name := v_mapping ->> 'drive_folder_name_snapshot';
    v_match_type := v_mapping ->> 'match_type';

    -- 'created' pertenece al CHECK de la tabla porque 8D lo usará al crear
    -- carpetas desde el CRM, pero en el onboarding no puede aparecer: aquí
    -- nunca se crea nada en Drive.
    if v_match_type is null or v_match_type not in ('exact', 'normalized', 'manual') then
      raise exception 'INVALID_MATCH_TYPE';
    end if;

    -- ¿Este cliente ya tiene carpeta?
    select drive_folder_id into v_existing_folder_id
      from public.google_drive_client_folders
     where client_id = v_client_id;

    if found then
      if v_existing_folder_id = v_folder_id then
        -- Exactamente el mismo par: éxito idempotente.
        v_unchanged := v_unchanged + 1;
        continue;
      end if;
      raise exception 'CLIENT_ALREADY_LINKED';
    end if;

    -- ¿Esta carpeta ya pertenece a otro cliente?
    select client_id into v_existing_client_id
      from public.google_drive_client_folders
     where connection_id = p_connection_id
       and drive_folder_id = v_folder_id;

    if found then
      raise exception 'DRIVE_FOLDER_ALREADY_LINKED';
    end if;

    -- sync_status queda en 'pending' (el default del schema de 8B): la
    -- vinculación existe, pero todavía no se ha sincronizado ningún archivo.
    -- No se inventa un estado que el CHECK no admita.
    insert into public.google_drive_client_folders (
      connection_id,
      client_id,
      drive_folder_id,
      drive_folder_name_snapshot,
      match_type,
      linked_by,
      linked_at,
      sync_status
    ) values (
      p_connection_id,
      v_client_id,
      v_folder_id,
      v_folder_name,
      v_match_type,
      p_linked_by,
      now(),
      'pending'
    );

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'unchanged', v_unchanged);
end;
$$;

-- Server-only, igual que las tres funciones de Fase 8B: nunca ejecutable por
-- anon/authenticated ni por PUBLIC por defecto.
revoke all on function public.apply_google_drive_client_folder_mappings(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_google_drive_client_folder_mappings(uuid, uuid, text, jsonb)
  to service_role;

commit;
