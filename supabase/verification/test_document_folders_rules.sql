-- ============================================================
-- test_document_folders_rules.sql
-- Pruebas de reglas de negocio para document_folders.
--
-- Ejecutar en un entorno de PRUEBA (no producción).
-- Cada prueba usa una transacción con ROLLBACK para no dejar datos.
-- Confirma con RAISE NOTICE al pasar y lanza EXCEPTION si falla.
-- ============================================================

do $$ begin raise notice '===================================================='; end; $$;
do $$ begin raise notice 'INICIO DE PRUEBAS: document_folders rules'; end; $$;
do $$ begin raise notice '===================================================='; end; $$;

-- ─── Datos de prueba compartidos ──────────────────────────────────────────────
-- Usamos clientes y perfiles temporales dentro de cada SAVEPOINT.
-- Todos los bloques terminan en ROLLBACK TO SAVEPOINT para aislarse.

-- Preparar IDs de prueba fijos (no colisionan con datos reales si se usa UUID v4 con prefijo)
-- Los insertamos en una transacción padre y hacemos ROLLBACK al final.

begin;

-- Crear cliente de prueba A
insert into public.clients (id, name, initials, color, dni, phone, process_type)
values (
  '00000000-0000-0000-0000-000000000aa1',
  'Cliente Test A', 'CTA', 'oklch(0.55 0.13 235)',
  '00000001', '999000001', 'Prueba'
) on conflict (id) do nothing;

-- Crear cliente de prueba B
insert into public.clients (id, name, initials, color, dni, phone, process_type)
values (
  '00000000-0000-0000-0000-000000000bb1',
  'Cliente Test B', 'CTB', 'oklch(0.55 0.13 235)',
  '00000002', '999000002', 'Prueba'
) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 1: Padre del mismo cliente — PERMITIDO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test1;
do $$
declare
  v_root uuid := '00000000-0000-0000-0001-000000000001';
  v_sub  uuid := '00000000-0000-0000-0001-000000000002';
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_root, '00000000-0000-0000-0000-000000000aa1', null, 'Raíz', 'raiz');

  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_sub, '00000000-0000-0000-0000-000000000aa1', v_root, 'Sub', 'sub');

  raise notice '[PASS] Prueba 1: Padre del mismo cliente — PERMITIDO.';
exception when others then
  raise exception '[FAIL] Prueba 1: Padre del mismo cliente debería ser permitido. Error: %', sqlerrm;
end;
$$;
rollback to savepoint test1;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 2: Padre de otro cliente — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test2;
do $$
declare
  v_folder_a uuid := '00000000-0000-0000-0002-000000000001';
  v_folder_b uuid := '00000000-0000-0000-0002-000000000002';
  v_raised   boolean := false;
begin
  -- Carpeta del cliente A
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_folder_a, '00000000-0000-0000-0000-000000000aa1', null, 'FolderA', 'foldera');

  -- Intento: carpeta del cliente B con parent_id de cliente A → debe fallar
  begin
    insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
    values (v_folder_b, '00000000-0000-0000-0000-000000000bb1', v_folder_a, 'FolderB', 'folderb');
  exception when check_violation or foreign_key_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 2: Padre de otro cliente debería haber sido bloqueado.';
  end if;

  raise notice '[PASS] Prueba 2: Padre de otro cliente — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test2;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 3: Auto-parent (id = parent_id) — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test3;
do $$
declare
  v_id     uuid    := '00000000-0000-0000-0003-000000000001';
  v_raised boolean := false;
begin
  begin
    insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
    values (v_id, '00000000-0000-0000-0000-000000000aa1', v_id, 'AutoParent', 'autoparent');
  exception when check_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 3: Auto-parent debería haber sido bloqueado por CHECK constraint.';
  end if;

  raise notice '[PASS] Prueba 3: Auto-parent (id = parent_id) — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test3;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 4: Ciclo indirecto (A→B, luego B→A) — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test4;
do $$
declare
  v_a      uuid    := '00000000-0000-0000-0004-000000000001';
  v_b      uuid    := '00000000-0000-0000-0004-000000000002';
  v_raised boolean := false;
begin
  -- A sin padre
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_a, '00000000-0000-0000-0000-000000000aa1', null, 'FolderA', 'foldera');

  -- B es hijo de A
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_b, '00000000-0000-0000-0000-000000000aa1', v_a, 'FolderB', 'folderb');

  -- Intento: A pasa a ser hijo de B → ciclo A→B→A
  begin
    update public.document_folders set parent_id = v_b where id = v_a;
  exception when check_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 4: Ciclo indirecto debería haber sido bloqueado por trg_df_no_cycle.';
  end if;

  raise notice '[PASS] Prueba 4: Ciclo indirecto (A→B→A) — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test4;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 5: Duplicado raíz (mismo nombre normalizado, parent_id IS NULL) — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test5;
do $$
declare
  v_raised boolean := false;
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (
    '00000000-0000-0000-0005-000000000001',
    '00000000-0000-0000-0000-000000000aa1', null, 'Demanda', 'demanda'
  );

  begin
    insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
    values (
      '00000000-0000-0000-0005-000000000002',
      '00000000-0000-0000-0000-000000000aa1', null, 'Demanda', 'demanda'
    );
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 5: Duplicado raíz debería haber sido bloqueado por índice único.';
  end if;

  raise notice '[PASS] Prueba 5: Duplicado raíz — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test5;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 6: Duplicado bajo mismo padre — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test6;
do $$
declare
  v_root   uuid    := '00000000-0000-0000-0006-000000000001';
  v_raised boolean := false;
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_root, '00000000-0000-0000-0000-000000000aa1', null, 'Root', 'root');

  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (
    '00000000-0000-0000-0006-000000000002',
    '00000000-0000-0000-0000-000000000aa1', v_root, 'Sub', 'sub'
  );

  begin
    insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
    values (
      '00000000-0000-0000-0006-000000000003',
      '00000000-0000-0000-0000-000000000aa1', v_root, 'Sub', 'sub'
    );
  exception when unique_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 6: Duplicado bajo mismo padre debería haber sido bloqueado.';
  end if;

  raise notice '[PASS] Prueba 6: Duplicado bajo mismo padre — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test6;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 7: Mismo nombre bajo padres diferentes — PERMITIDO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test7;
do $$
declare
  v_p1 uuid := '00000000-0000-0000-0007-000000000001';
  v_p2 uuid := '00000000-0000-0000-0007-000000000002';
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_p1, '00000000-0000-0000-0000-000000000aa1', null, 'Fiscal', 'fiscal');

  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_p2, '00000000-0000-0000-0000-000000000aa1', null, 'Judicial', 'judicial');

  -- Mismo nombre "Documentos" bajo dos padres distintos → DEBE pasar
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (
    '00000000-0000-0000-0007-000000000003',
    '00000000-0000-0000-0000-000000000aa1', v_p1, 'Documentos', 'documentos'
  );

  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (
    '00000000-0000-0000-0007-000000000004',
    '00000000-0000-0000-0000-000000000aa1', v_p2, 'Documentos', 'documentos'
  );

  raise notice '[PASS] Prueba 7: Mismo nombre bajo padres diferentes — PERMITIDO.';
exception when others then
  raise exception '[FAIL] Prueba 7: Mismo nombre bajo padres diferentes debería ser permitido. Error: %', sqlerrm;
end;
$$;
rollback to savepoint test7;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 8: Documento en carpeta del mismo cliente — PERMITIDO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test8;
do $$
declare
  v_folder uuid := '00000000-0000-0000-0008-000000000001';
  v_doc    uuid := '00000000-0000-0000-0008-000000000002';
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_folder, '00000000-0000-0000-0000-000000000aa1', null, 'Carpeta', 'carpeta');

  insert into public.documents (id, name, type, size, storage_path, client_id, folder_id)
  values (v_doc, 'doc.pdf', 'application/pdf', '1kb',
          'test/path/doc.pdf', '00000000-0000-0000-0000-000000000aa1', v_folder);

  raise notice '[PASS] Prueba 8: Documento en carpeta del mismo cliente — PERMITIDO.';
exception when others then
  raise exception '[FAIL] Prueba 8: Debería ser permitido. Error: %', sqlerrm;
end;
$$;
rollback to savepoint test8;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 9: Documento en carpeta de otro cliente — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test9;
do $$
declare
  v_folder uuid    := '00000000-0000-0000-0009-000000000001';
  v_doc    uuid    := '00000000-0000-0000-0009-000000000002';
  v_raised boolean := false;
begin
  -- Carpeta de cliente A
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_folder, '00000000-0000-0000-0000-000000000aa1', null, 'Carpeta', 'carpeta');

  -- Documento de cliente B asignado a carpeta de cliente A → debe fallar
  begin
    insert into public.documents (id, name, type, size, storage_path, client_id, folder_id)
    values (v_doc, 'doc.pdf', 'application/pdf', '1kb',
            'test/path/doc.pdf', '00000000-0000-0000-0000-000000000bb1', v_folder);
  exception when check_violation or foreign_key_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 9: Documento en carpeta de otro cliente debería haber sido bloqueado.';
  end if;

  raise notice '[PASS] Prueba 9: Documento en carpeta de otro cliente — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test9;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 10: Eliminar carpeta vacía — PERMITIDO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test10;
do $$
declare
  v_folder uuid := '00000000-0000-0000-0010-000000000001';
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_folder, '00000000-0000-0000-0000-000000000aa1', null, 'Vacia', 'vacia');

  delete from public.document_folders where id = v_folder;

  raise notice '[PASS] Prueba 10: Eliminar carpeta vacía — PERMITIDO.';
exception when others then
  raise exception '[FAIL] Prueba 10: Eliminar carpeta vacía debería ser permitido. Error: %', sqlerrm;
end;
$$;
rollback to savepoint test10;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 11: Eliminar carpeta con documentos — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test11;
do $$
declare
  v_folder uuid    := '00000000-0000-0000-0011-000000000001';
  v_doc    uuid    := '00000000-0000-0000-0011-000000000002';
  v_raised boolean := false;
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_folder, '00000000-0000-0000-0000-000000000aa1', null, 'ConDoc', 'condoc');

  insert into public.documents (id, name, type, size, storage_path, client_id, folder_id)
  values (v_doc, 'doc.pdf', 'application/pdf', '1kb',
          'test/path/doc.pdf', '00000000-0000-0000-0000-000000000aa1', v_folder);

  -- Intento de eliminar carpeta con documento → debe fallar (ON DELETE RESTRICT)
  begin
    delete from public.document_folders where id = v_folder;
  exception when foreign_key_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 11: Eliminar carpeta con documentos debería haber sido bloqueado (ON DELETE RESTRICT).';
  end if;

  raise notice '[PASS] Prueba 11: Eliminar carpeta con documentos — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test11;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA 12: Eliminar carpeta con subcarpetas — BLOQUEADO
-- ─────────────────────────────────────────────────────────────────────────────
savepoint test12;
do $$
declare
  v_parent uuid    := '00000000-0000-0000-0012-000000000001';
  v_child  uuid    := '00000000-0000-0000-0012-000000000002';
  v_raised boolean := false;
begin
  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_parent, '00000000-0000-0000-0000-000000000aa1', null, 'Padre', 'padre');

  insert into public.document_folders (id, client_id, parent_id, name, normalized_name)
  values (v_child, '00000000-0000-0000-0000-000000000aa1', v_parent, 'Hijo', 'hijo');

  -- Intento de eliminar carpeta padre → debe fallar (ON DELETE RESTRICT en parent_id)
  begin
    delete from public.document_folders where id = v_parent;
  exception when foreign_key_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '[FAIL] Prueba 12: Eliminar carpeta con subcarpetas debería haber sido bloqueado.';
  end if;

  raise notice '[PASS] Prueba 12: Eliminar carpeta con subcarpetas — BLOQUEADO correctamente.';
end;
$$;
rollback to savepoint test12;

-- ─────────────────────────────────────────────────────────────────────────────
-- Limpiar datos de prueba (clientes temporales)
-- ─────────────────────────────────────────────────────────────────────────────
rollback; -- Deshace TODO el bloque begin..rollback, incluyendo clientes de prueba

do $$ begin raise notice '===================================================='; end; $$;
do $$ begin raise notice 'TODAS LAS PRUEBAS DE REGLAS DE NEGOCIO COMPLETADAS.'; end; $$;
do $$ begin raise notice '===================================================='; end; $$;
