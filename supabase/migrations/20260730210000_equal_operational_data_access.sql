-- Migración correctiva: igualdad de acceso operativo entre Administrador y Personal
-- Fecha: 2026-07-30
-- Contexto: La migración 20260730190000 introdujo restricciones incorrectas que
--           impedían a Personal crear/editar Clientes, Expedientes y Carpetas.
-- Objetivo: Alinear RLS con la regla definitiva:
--   - Administrador y Personal comparten el mismo universo de datos operativos.
--   - Personal puede crear y editar Clientes, Expedientes, Documentos, Reportes y Carpetas.
--   - Personal NO puede crear Tareas (INSERT en case_tasks sigue restringido a Admin).
--   - Personal NO puede crear Eventos de Agenda (INSERT en agenda_events sigue restringido).
--   - Pagos y Configuración permanecen exclusivos de Administrador.
--
-- No se modifica Supabase remoto; esta migración es local hasta aprobación de staging.
-- No hace push. No despliega.

begin;

-- ============================================================
-- CLIENTS: Administrador y Personal gestionan igual
-- ============================================================

drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_insert" on public.clients;
drop policy if exists "clients_update" on public.clients;
drop policy if exists "clients_delete" on public.clients;

-- SELECT: todo el staff activo ve los mismos clientes
create policy "clients_select" on public.clients
  for select to authenticated
  using (public.is_staff());

-- INSERT: Administrador y Personal pueden registrar nuevos clientes
create policy "clients_insert" on public.clients
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: Administrador y Personal pueden editar clientes
create policy "clients_update" on public.clients
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador puede eliminar clientes
create policy "clients_delete" on public.clients
  for delete to authenticated
  using (public.is_admin());

comment on policy "clients_select" on public.clients is
  'Todo el staff activo (Administrador y Personal) puede consultar clientes.';
comment on policy "clients_insert" on public.clients is
  'Administrador y Personal pueden registrar nuevos clientes.';
comment on policy "clients_update" on public.clients is
  'Administrador y Personal pueden editar datos de clientes.';
comment on policy "clients_delete" on public.clients is
  'Solo Administrador puede eliminar clientes.';

-- ============================================================
-- CASES: Administrador y Personal gestionan igual
-- ============================================================

drop policy if exists "cases_select" on public.cases;
drop policy if exists "cases_insert" on public.cases;
drop policy if exists "cases_update" on public.cases;
drop policy if exists "cases_delete" on public.cases;

-- SELECT: todo el staff activo ve los mismos expedientes
create policy "cases_select" on public.cases
  for select to authenticated
  using (public.is_staff());

-- INSERT: Administrador y Personal pueden crear expedientes
create policy "cases_insert" on public.cases
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: Administrador y Personal pueden editar expedientes
create policy "cases_update" on public.cases
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador puede eliminar expedientes
create policy "cases_delete" on public.cases
  for delete to authenticated
  using (public.is_admin());

comment on policy "cases_select" on public.cases is
  'Todo el staff activo puede consultar expedientes.';
comment on policy "cases_insert" on public.cases is
  'Administrador y Personal pueden crear expedientes.';
comment on policy "cases_update" on public.cases is
  'Administrador y Personal pueden editar expedientes.';
comment on policy "cases_delete" on public.cases is
  'Solo Administrador puede eliminar expedientes.';

-- ============================================================
-- DOCUMENTS: Administrador y Personal gestionan igual
-- ============================================================

drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_update" on public.documents;
drop policy if exists "documents_delete" on public.documents;

-- SELECT: todo el staff activo ve los mismos documentos
create policy "documents_select" on public.documents
  for select to authenticated
  using (public.is_staff());

-- INSERT: Administrador y Personal pueden subir documentos
create policy "documents_insert" on public.documents
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: Administrador y Personal pueden editar metadatos de documentos
create policy "documents_update" on public.documents
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador puede eliminar documentos
create policy "documents_delete" on public.documents
  for delete to authenticated
  using (public.is_admin());

comment on policy "documents_select" on public.documents is
  'Todo el staff activo puede consultar documentos.';
comment on policy "documents_insert" on public.documents is
  'Administrador y Personal pueden subir documentos.';
comment on policy "documents_update" on public.documents is
  'Administrador y Personal pueden editar metadatos de documentos.';
comment on policy "documents_delete" on public.documents is
  'Solo Administrador puede eliminar documentos.';

-- ============================================================
-- DOCUMENT_FOLDERS: Administrador y Personal gestionan igual
-- ============================================================

drop policy if exists "document_folders_select" on public.document_folders;
drop policy if exists "document_folders_insert" on public.document_folders;
drop policy if exists "document_folders_update" on public.document_folders;
drop policy if exists "document_folders_delete" on public.document_folders;

-- SELECT: todo el staff activo ve las mismas carpetas
create policy "document_folders_select" on public.document_folders
  for select to authenticated
  using (public.is_staff());

-- INSERT: Administrador y Personal pueden crear carpetas
create policy "document_folders_insert" on public.document_folders
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: Administrador y Personal pueden renombrar/editar carpetas
create policy "document_folders_update" on public.document_folders
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador puede eliminar carpetas
create policy "document_folders_delete" on public.document_folders
  for delete to authenticated
  using (public.is_admin());

comment on policy "document_folders_select" on public.document_folders is
  'Todo el staff activo puede consultar carpetas documentales.';
comment on policy "document_folders_insert" on public.document_folders is
  'Administrador y Personal pueden crear carpetas.';
comment on policy "document_folders_update" on public.document_folders is
  'Administrador y Personal pueden renombrar y editar carpetas.';
comment on policy "document_folders_delete" on public.document_folders is
  'Solo Administrador puede eliminar carpetas.';

-- ============================================================
-- CLIENT_REPORTS: Administrador y Personal gestionan igual
-- ============================================================

drop policy if exists "client_reports_select" on public.client_reports;
drop policy if exists "client_reports_insert" on public.client_reports;
drop policy if exists "client_reports_update" on public.client_reports;
drop policy if exists "client_reports_delete" on public.client_reports;

-- SELECT: todo el staff activo ve los mismos reportes
create policy "client_reports_select" on public.client_reports
  for select to authenticated
  using (public.is_staff());

-- INSERT: Administrador y Personal pueden crear reportes
create policy "client_reports_insert" on public.client_reports
  for insert to authenticated
  with check (public.is_staff());

-- UPDATE: Administrador y Personal pueden editar reportes
create policy "client_reports_update" on public.client_reports
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- DELETE: solo Administrador puede eliminar reportes
create policy "client_reports_delete" on public.client_reports
  for delete to authenticated
  using (public.is_admin());

comment on policy "client_reports_select" on public.client_reports is
  'Todo el staff activo puede consultar reportes de clientes.';
comment on policy "client_reports_insert" on public.client_reports is
  'Administrador y Personal pueden crear reportes.';
comment on policy "client_reports_update" on public.client_reports is
  'Administrador y Personal pueden editar reportes.';
comment on policy "client_reports_delete" on public.client_reports is
  'Solo Administrador puede eliminar reportes.';

-- ============================================================
-- AGENDA_EVENTS: SELECT compartido, escritura solo Admin
-- (las policies de INSERT/UPDATE/DELETE ya están en 20260730180000)
-- Sólo reconfirmar SELECT para claridad.
-- ============================================================

drop policy if exists "agenda_select" on public.agenda_events;

create policy "agenda_select" on public.agenda_events
  for select to authenticated
  using (public.is_staff());

comment on policy "agenda_select" on public.agenda_events is
  'Todo el staff activo puede consultar eventos de agenda.';

-- ============================================================
-- CASE_TASKS: SELECT compartido, INSERT solo Admin
-- Personal puede ver todas las tareas, no solo las propias.
-- (INSERT ya restringido en 20260729211000)
-- ============================================================

drop policy if exists "case_tasks_select" on public.case_tasks;

create policy "case_tasks_select" on public.case_tasks
  for select to authenticated
  using (public.is_staff());

comment on policy "case_tasks_select" on public.case_tasks is
  'Todo el staff activo puede consultar todas las tareas.';

-- ============================================================
-- PAYMENTS / PAYMENT_RECORDS: sin cambios — solo Administrador
-- ============================================================

-- No se modifican payments ni payment_records.
-- Sus policies existentes restringen a is_admin() y se mantienen intactas.

-- ============================================================
-- RESUMEN DE DIFERENCIAS AUTORIZADAS
-- ============================================================

-- | Acción                          | Administrador | Personal |
-- |---------------------------------|:---:|:---:|
-- | Ver clientes                    | ✅  | ✅  |
-- | Crear/editar clientes           | ✅  | ✅  |
-- | Eliminar clientes               | ✅  | ❌  |
-- | Ver expedientes                 | ✅  | ✅  |
-- | Crear/editar expedientes        | ✅  | ✅  |
-- | Eliminar expedientes            | ✅  | ❌  |
-- | Ver/subir/editar documentos     | ✅  | ✅  |
-- | Eliminar documentos             | ✅  | ❌  |
-- | Ver/crear carpetas              | ✅  | ✅  |
-- | Eliminar carpetas               | ✅  | ❌  |
-- | Ver/crear/editar reportes       | ✅  | ✅  |
-- | Eliminar reportes               | ✅  | ❌  |
-- | Ver todas las tareas            | ✅  | ✅  |
-- | Crear tareas                    | ✅  | ❌  |
-- | Tomar tareas (RPC)              | ✅  | ✅  |
-- | Ver todos los eventos de agenda | ✅  | ✅  |
-- | Crear/editar/eliminar eventos   | ✅  | ❌  |
-- | Ver pagos                       | ✅  | ❌  |
-- | Configuración                   | ✅  | ❌  |

commit;
