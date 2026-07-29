-- ============================================================
-- verify_document_folders.sql
-- SQL de verificación NO DESTRUCTIVO para la migración
-- supabase/migrations/20260725120000_document_folders.sql
--
-- PROHIBIDO incluir:  DELETE / TRUNCATE / DROP / UPDATE / INSERT
-- Solo SELECT + assert vía RAISE.
--
-- Ejecutar en Supabase > SQL Editor después de aplicar la migración.
-- Cada sección imprime un resultado o lanza excepción si algo falla.
-- ============================================================

do $$
declare
  v_count   bigint;
  v_result  text;
begin
  raise notice '====================================================';
  raise notice 'VERIFICACIÓN: document_folders — inicio';
  raise notice '====================================================';

  -- ──────────────────────────────────────────────────────────
  -- 1. Existencia de tabla document_folders
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name   = 'document_folders';

  if v_count = 0 then
    raise exception '[FAIL] La tabla public.document_folders NO existe. Aplica la migración primero.';
  end if;
  raise notice '[OK] Tabla public.document_folders existe.';

  -- ──────────────────────────────────────────────────────────
  -- 2. Existencia de columna documents.folder_id
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'documents'
    and column_name  = 'folder_id';

  if v_count = 0 then
    raise exception '[FAIL] La columna folder_id NO existe en public.documents. Aplica la migración primero.';
  end if;
  raise notice '[OK] Columna public.documents.folder_id existe.';

  -- ──────────────────────────────────────────────────────────
  -- 3. Columnas de document_folders
  -- ──────────────────────────────────────────────────────────
  for v_result in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'document_folders'
      and column_name in ('id','client_id','parent_id','name','normalized_name',
                          'created_by','created_at','updated_at')
  loop
    raise notice '[OK] Columna document_folders.% existe.', v_result;
  end loop;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'document_folders'
    and column_name in ('id','client_id','parent_id','name','normalized_name',
                        'created_by','created_at','updated_at');

  if v_count < 8 then
    raise exception '[FAIL] Faltan columnas en document_folders (encontradas %, esperadas 8).', v_count;
  end if;

  -- ──────────────────────────────────────────────────────────
  -- 4. Foreign keys de document_folders
  -- ──────────────────────────────────────────────────────────
  -- FK client_id → clients.id
  select count(*) into v_count
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = rc.constraint_name
   and kcu.constraint_schema = rc.constraint_schema
  where rc.constraint_schema       = 'public'
    and kcu.table_name             = 'document_folders'
    and kcu.column_name            = 'client_id'
    and rc.unique_constraint_schema = 'public';

  if v_count = 0 then
    raise exception '[FAIL] FK client_id → clients no encontrada en document_folders.';
  end if;
  raise notice '[OK] FK document_folders.client_id → clients.id existe.';

  -- FK parent_id → document_folders.id (auto-referencia)
  select count(*) into v_count
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = rc.constraint_name
   and kcu.constraint_schema = rc.constraint_schema
  where rc.constraint_schema = 'public'
    and kcu.table_name       = 'document_folders'
    and kcu.column_name      = 'parent_id';

  if v_count = 0 then
    raise exception '[FAIL] FK parent_id → document_folders no encontrada.';
  end if;
  raise notice '[OK] FK document_folders.parent_id → document_folders.id (ON DELETE RESTRICT) existe.';

  -- FK documents.folder_id → document_folders.id
  select count(*) into v_count
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = rc.constraint_name
   and kcu.constraint_schema = rc.constraint_schema
  where rc.constraint_schema = 'public'
    and kcu.table_name       = 'documents'
    and kcu.column_name      = 'folder_id';

  if v_count = 0 then
    raise exception '[FAIL] FK documents.folder_id → document_folders no encontrada.';
  end if;
  raise notice '[OK] FK documents.folder_id → document_folders.id (ON DELETE RESTRICT) existe.';

  -- ──────────────────────────────────────────────────────────
  -- 5. Constraint CHECK no_self_parent
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from information_schema.check_constraints
  where constraint_schema = 'public'
    and constraint_name   = 'document_folders_no_self_parent';

  if v_count = 0 then
    raise exception '[FAIL] CHECK document_folders_no_self_parent no encontrado.';
  end if;
  raise notice '[OK] CHECK document_folders_no_self_parent existe.';

  -- ──────────────────────────────────────────────────────────
  -- 6. Constraint UNIQUE bajo mismo padre
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from information_schema.table_constraints
  where constraint_schema = 'public'
    and table_name        = 'document_folders'
    and constraint_name   = 'document_folders_unique_name_under_parent'
    and constraint_type   = 'UNIQUE';

  if v_count = 0 then
    raise exception '[FAIL] UNIQUE document_folders_unique_name_under_parent no encontrado.';
  end if;
  raise notice '[OK] UNIQUE document_folders_unique_name_under_parent existe.';

  -- ──────────────────────────────────────────────────────────
  -- 7. Índice único para carpetas raíz
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and tablename  = 'document_folders'
    and indexname  = 'document_folders_root_unique';

  if v_count = 0 then
    raise exception '[FAIL] Índice unique document_folders_root_unique no encontrado.';
  end if;
  raise notice '[OK] Índice parcial document_folders_root_unique (WHERE parent_id IS NULL) existe.';

  -- ──────────────────────────────────────────────────────────
  -- 8. Índices de rendimiento
  -- ──────────────────────────────────────────────────────────
  for v_result in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename  = 'document_folders'
      and indexname in ('document_folders_client_id_idx', 'document_folders_parent_id_idx')
  loop
    raise notice '[OK] Índice % existe.', v_result;
  end loop;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and tablename  = 'document_folders'
    and indexname in ('document_folders_client_id_idx', 'document_folders_parent_id_idx');

  if v_count < 2 then
    raise exception '[FAIL] Faltan índices de rendimiento en document_folders (encontrados %).', v_count;
  end if;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and tablename  = 'documents'
    and indexname  = 'documents_folder_id_idx';

  if v_count = 0 then
    raise exception '[FAIL] Índice documents_folder_id_idx no encontrado.';
  end if;
  raise notice '[OK] Índice documents_folder_id_idx existe.';

  -- ──────────────────────────────────────────────────────────
  -- 9. Triggers
  -- ──────────────────────────────────────────────────────────
  for v_result in
    select trigger_name
    from information_schema.triggers
    where trigger_schema = 'public'
      and event_object_table = 'document_folders'
      and trigger_name in (
        'document_folders_set_updated_at',
        'trg_df_parent_same_client',
        'trg_df_no_cycle'
      )
  loop
    raise notice '[OK] Trigger % existe en document_folders.', v_result;
  end loop;

  select count(*) into v_count
  from information_schema.triggers
  where trigger_schema = 'public'
    and event_object_table = 'document_folders'
    and trigger_name in (
      'document_folders_set_updated_at',
      'trg_df_parent_same_client',
      'trg_df_no_cycle'
    );

  if v_count < 3 then
    raise exception '[FAIL] Faltan triggers en document_folders (encontrados %, esperados 3).', v_count;
  end if;

  -- Trigger en documents
  select count(*) into v_count
  from information_schema.triggers
  where trigger_schema = 'public'
    and event_object_table = 'documents'
    and trigger_name = 'trg_doc_folder_same_client';

  if v_count = 0 then
    raise exception '[FAIL] Trigger trg_doc_folder_same_client no encontrado en public.documents.';
  end if;
  raise notice '[OK] Trigger trg_doc_folder_same_client existe en public.documents.';

  -- ──────────────────────────────────────────────────────────
  -- 10. RLS habilitado en document_folders
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname  = 'public'
    and c.relname  = 'document_folders'
    and c.relrowsecurity = true;

  if v_count = 0 then
    raise exception '[FAIL] RLS no está habilitado en public.document_folders.';
  end if;
  raise notice '[OK] RLS habilitado en public.document_folders.';

  -- ──────────────────────────────────────────────────────────
  -- 11. Políticas RLS de document_folders
  -- ──────────────────────────────────────────────────────────
  for v_result in
    select policyname || ' (' || cmd || ')'
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'document_folders'
      and policyname in (
        'document_folders_select',
        'document_folders_insert',
        'document_folders_update',
        'document_folders_delete'
      )
  loop
    raise notice '[OK] Política RLS: %', v_result;
  end loop;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename  = 'document_folders'
    and policyname in (
      'document_folders_select',
      'document_folders_insert',
      'document_folders_update',
      'document_folders_delete'
    );

  if v_count < 4 then
    raise exception '[FAIL] Faltan políticas RLS en document_folders (encontradas %, esperadas 4).', v_count;
  end if;

  -- Política documents_update en documents
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename  = 'documents'
    and policyname = 'documents_update';

  if v_count = 0 then
    raise exception '[FAIL] Política documents_update no encontrada en public.documents.';
  end if;
  raise notice '[OK] Política documents_update existe en public.documents.';

  -- ──────────────────────────────────────────────────────────
  -- 12. Función set_updated_at
  -- ──────────────────────────────────────────────────────────
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_updated_at';

  if v_count = 0 then
    raise exception '[FAIL] Función public.set_updated_at() no encontrada.';
  end if;
  raise notice '[OK] Función public.set_updated_at() existe.';

  -- ──────────────────────────────────────────────────────────
  -- 13. Funciones de protección (triggers)
  -- ──────────────────────────────────────────────────────────
  for v_result in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'check_folder_parent_same_client',
        'check_folder_no_cycle',
        'check_document_folder_same_client'
      )
  loop
    raise notice '[OK] Función de protección public.%() existe.', v_result;
  end loop;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'check_folder_parent_same_client',
      'check_folder_no_cycle',
      'check_document_folder_same_client'
    );

  if v_count < 3 then
    raise exception '[FAIL] Faltan funciones de protección (encontradas %, esperadas 3).', v_count;
  end if;

  raise notice '====================================================';
  raise notice 'VERIFICACIÓN ESTRUCTURAL: APROBADA';
  raise notice '====================================================';

end;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 2: Verificación de datos (sin modificar nada)
-- ──────────────────────────────────────────────────────────────────────────────

-- 14. Carpetas raíz duplicadas (mismo client_id + normalized_name, parent_id IS NULL)
--     Debe devolver 0 filas si los datos son consistentes.
select
  client_id,
  normalized_name,
  count(*) as duplicados
from public.document_folders
where parent_id is null
group by client_id, normalized_name
having count(*) > 1;

-- 15. Subcarpetas duplicadas (mismo client_id + parent_id + normalized_name)
--     Debe devolver 0 filas.
select
  client_id,
  parent_id,
  normalized_name,
  count(*) as duplicados
from public.document_folders
where parent_id is not null
group by client_id, parent_id, normalized_name
having count(*) > 1;

-- 16. Carpetas con parent_id de otro cliente (Protección 1)
--     Debe devolver 0 filas.
select
  f.id         as folder_id,
  f.client_id  as folder_client,
  p.client_id  as parent_client
from public.document_folders f
join public.document_folders p on p.id = f.parent_id
where f.parent_id is not null
  and f.client_id <> p.client_id;

-- 17. Ciclos directos (auto-parent, Protección 2)
--     Debe devolver 0 filas.
select id, parent_id
from public.document_folders
where id = parent_id;

-- 18. Ciclos indirectos de 2 nodos (A.parent = B, B.parent = A)
--     Debe devolver 0 filas.
select
  a.id as folder_a,
  b.id as folder_b
from public.document_folders a
join public.document_folders b on b.id = a.parent_id
where a.id = b.parent_id;

-- 19. Documentos asignados a carpetas de otro cliente (Protección 7)
--     Debe devolver 0 filas.
select
  d.id         as document_id,
  d.client_id  as doc_client,
  f.client_id  as folder_client
from public.documents d
join public.document_folders f on f.id = d.folder_id
where d.folder_id is not null
  and d.client_id <> f.client_id;

-- 20. Documents con folder_id que no existe en document_folders
--     Debe devolver 0 filas (FK garantiza esto, pero verificamos igualmente).
select
  d.id       as document_id,
  d.folder_id
from public.documents d
where d.folder_id is not null
  and not exists (
    select 1 from public.document_folders f where f.id = d.folder_id
  );

-- 21. Documentos con relative_path pero sin folder_id (pendientes de migrar)
--     Informativo: muestra cuántos quedan por migrar.
select
  client_id,
  count(*) as pendientes_de_migrar
from public.documents
where relative_path is not null
  and relative_path <> ''
  and folder_id is null
group by client_id
order by pendientes_de_migrar desc;

-- 22. Conteos generales por cliente (informativo)
select
  c.id        as client_id,
  c.name      as client_name,
  count(distinct df.id) as carpetas,
  count(distinct d.id)  as documentos_con_carpeta,
  count(distinct d2.id) as documentos_sin_carpeta
from public.clients c
left join public.document_folders df on df.client_id = c.id
left join public.documents d  on d.client_id  = c.id and d.folder_id is not null
left join public.documents d2 on d2.client_id = c.id and d2.folder_id is null
group by c.id, c.name
order by c.name;

-- ──────────────────────────────────────────────────────────────────────────────
-- FIN: verify_document_folders.sql
-- Si todas las secciones anteriores ejecutaron sin excepciones y las queries
-- de datos devuelven 0 filas (excepto las informativas), la migración es válida.
-- ──────────────────────────────────────────────────────────────────────────────
