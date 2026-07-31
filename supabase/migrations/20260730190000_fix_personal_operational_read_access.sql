-- Migración correctiva: acceso operativo del rol Personal
-- Fecha: 2026-07-30
-- Objetivo: Garantizar que Personal puede hacer SELECT en todos los módulos
--           operativos y que las restricciones de escritura son explícitas.
--
-- Referencia: 20260730180000_personal_role_permissions.sql (agenda + case_tasks)
-- Esta migración cubre: clients, cases, documents, document_folders,
--                       client_reports, agenda_events (confirma SELECT)
-- No toca: payments, payment_records (bloqueados para Personal)
-- No aplicar en producción sin pruebas previas en staging.

begin;

-- ============================================================
-- CLIENTS: Personal puede SELECT, solo Admin puede INSERT/UPDATE/DELETE
-- ============================================================

drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;

-- SELECT: todo el staff activo (Administrador y Personal)
create policy "clients_select" on public.clients
  for select to authenticated
  using (public.is_staff());

-- INSERT: solo Administrador
create policy "clients_insert" on public.clients
  for insert to authenticated
  with check (public.is_admin());

-- UPDATE: solo Administrador
create policy "clients_update" on public.clients
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: solo Administrador
create policy "clients_delete" on public.clients
  for delete to authenticated
  using (public.is_admin());

comment on policy "clients_select" on public.clients is
  'Todo el staff activo (Administrador y Personal) puede consultar clientes.';
comment on policy "clients_insert" on public.clients is
  'Solo Administrador puede registrar nuevos clientes.';
comment on policy "clients_update" on public.clients is
  'Solo Administrador puede editar datos de clientes.';
comment on policy "clients_delete" on public.clients is
  'Solo Administrador puede eliminar clientes.';

-- ============================================================
-- CASES: Personal puede SELECT, solo Admin puede INSERT/UPDATE/DELETE
-- ============================================================

drop policy if exists "cases_select" on public.cases;
drop policy if exists "cases_insert" on public.cases;
drop policy if exists "cases_update" on public.cases;
drop policy if exists "cases_delete" on public.cases;

-- SELECT: todo el staff activo
create policy "cases_select" on public.cases
  for select to authenticated
  using (public.is_staff());

-- INSERT: solo Administrador
create policy "cases_insert" on public.cases
  for insert to authenticated
  with check (public.is_admin());

-- UPDATE: solo Administrador
create policy "cases_update" on public.cases
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: solo Administrador
create policy "cases_delete" on public.cases
  for delete to authenticated
  using (public.is_admin());

comment on policy "cases_select" on public.cases is
  'Todo el staff activo puede consultar expedientes.';
comment on policy "cases_insert" on public.cases is
  'Solo Administrador puede crear expedientes.';
comment on policy "cases_update" on public.cases is
  'Solo Administrador puede editar expedientes.';
comment on policy "cases_delete" on public.cases is
  'Solo Administrador puede eliminar expedientes.';

-- ============================================================
-- DOCUMENTS: Personal puede SELECT y INSERT, solo Admin puede DELETE
-- ============================================================

drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_update" on public.documents;
drop policy if exists "documents_delete" on public.documents;

-- SELECT: todo el staff activo
create policy "documents_select" on public.documents
  for select to authenticated
  using (public.is_staff());

-- INSERT: todo el staff activo puede subir documentos
create policy "documents_insert" on public.documents
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: todo el staff activo puede editar metadatos
create policy "documents_update" on public.documents
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador
create policy "documents_delete" on public.documents
  for delete to authenticated
  using (public.is_admin());

comment on policy "documents_select" on public.documents is
  'Todo el staff activo puede consultar documentos.';
comment on policy "documents_delete" on public.documents is
  'Solo Administrador puede eliminar documentos.';

-- ============================================================
-- DOCUMENT_FOLDERS: Personal puede SELECT, Admin gestiona
-- ============================================================

drop policy if exists "document_folders_select" on public.document_folders;
drop policy if exists "document_folders_insert" on public.document_folders;
drop policy if exists "document_folders_update" on public.document_folders;
drop policy if exists "document_folders_delete" on public.document_folders;

-- SELECT: todo el staff activo
create policy "document_folders_select" on public.document_folders
  for select to authenticated
  using (public.is_staff());

-- INSERT: solo Administrador crea carpetas
create policy "document_folders_insert" on public.document_folders
  for insert to authenticated
  with check (public.is_admin());

-- UPDATE: solo Administrador edita carpetas
create policy "document_folders_update" on public.document_folders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: solo Administrador elimina carpetas
create policy "document_folders_delete" on public.document_folders
  for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- CLIENT_REPORTS: Personal puede SELECT, Admin y autor gestionan
-- ============================================================

drop policy if exists "client_reports_select" on public.client_reports;
drop policy if exists "client_reports_insert" on public.client_reports;
drop policy if exists "client_reports_update" on public.client_reports;
drop policy if exists "client_reports_delete" on public.client_reports;

-- SELECT: todo el staff activo puede consultar reportes
create policy "client_reports_select" on public.client_reports
  for select to authenticated
  using (public.is_staff());

-- INSERT: todo el staff activo puede crear reportes
create policy "client_reports_insert" on public.client_reports
  for insert to authenticated
  with check (
    public.is_staff()
    and (author_id is null or author_id = auth.uid())
  );

-- UPDATE: solo el autor o Administrador puede editar reportes
create policy "client_reports_update" on public.client_reports
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and author_id = auth.uid())
  )
  with check (
    public.is_admin()
    or (public.is_staff() and author_id = auth.uid())
  );

-- DELETE: solo Administrador o el autor pueden eliminar reportes
create policy "client_reports_delete" on public.client_reports
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and author_id = auth.uid())
  );

comment on policy "client_reports_select" on public.client_reports is
  'Todo el staff activo puede consultar reportes de clientes.';

-- ============================================================
-- AGENDA_EVENTS: confirmar SELECT para todo el staff
-- (INSERT/UPDATE/DELETE ya restringidos en 20260730180000)
-- ============================================================

drop policy if exists "agenda_select" on public.agenda_events;

create policy "agenda_select" on public.agenda_events
  for select to authenticated
  using (public.is_staff());

comment on policy "agenda_select" on public.agenda_events is
  'Todo el staff activo puede consultar eventos de agenda.';

-- ============================================================
-- PAYMENTS: Personal no tiene ningún acceso
-- (las policies existentes ya restringen a is_admin())
-- Confirmación explícita: no añadir SELECT ni otras operaciones para Personal.
-- ============================================================

-- Las tablas payments y payment_records mantienen sus políticas de is_admin().
-- No se modifican en esta migración.

-- ============================================================
-- CONTRATO DE VALIDACIÓN
-- ============================================================

-- Como Administrador Activo:
--   ✅ SELECT * FROM clients;          → retorna registros
--   ✅ SELECT * FROM cases;            → retorna registros
--   ✅ SELECT * FROM documents;        → retorna registros
--   ✅ SELECT * FROM client_reports;   → retorna registros
--   ✅ SELECT * FROM agenda_events;    → retorna registros
--   ✅ INSERT INTO clients (...);      → funciona
--   ✅ INSERT INTO cases (...);        → funciona
--   ✅ DELETE FROM documents WHERE id = ...; → funciona

-- Como Personal Activo:
--   ✅ SELECT * FROM clients;          → retorna registros
--   ✅ SELECT * FROM cases;            → retorna registros
--   ✅ SELECT * FROM documents;        → retorna registros
--   ✅ SELECT * FROM client_reports;   → retorna registros
--   ✅ SELECT * FROM agenda_events;    → retorna registros
--   ❌ INSERT INTO clients (...);      → falla con 42501
--   ❌ INSERT INTO cases (...);        → falla con 42501
--   ❌ DELETE FROM documents WHERE id = ...; → falla con 42501
--   ❌ SELECT * FROM payments;         → falla con 42501
--   ❌ SELECT * FROM payment_records;  → falla con 42501

commit;
