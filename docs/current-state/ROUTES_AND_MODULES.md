# Routes and Modules

## Comun

`/_app` protege rutas: si no hay usuario despues de cargar auth, navega a `/login` (`src/routes/_app.tsx:15` a `:19`). `AppLayout` define navegacion (`src/components/app-layout.tsx:30` a `:40`), campana, busqueda y chatbot. `Pagos` y `Configuracion` son admin-only.

## Dashboard `/`

Archivo: `src/routes/_app.index.tsx`. Hooks: `useAuth`, `useClients`, `useCases`, `useAgendaEvents`, `usePayments`, `useClientReports` (`src/routes/_app.index.tsx:3` a `:8`, `:48` a `:54`). Tablas: `clients`, `cases`, `agenda_events`, `payments`, `client_reports`. Permisos: pagos solo si admin (`:53`). Estados de error: no hay bloque explicito; depende de hooks.

## Clientes `/clientes`

Archivo: `src/routes/_app.clientes.index.tsx`. Hooks: `useClients`, `useCreateClient`, `useAuth` (`:3` a `:4`, `:20` a `:23`). Tablas: `clients`. Acciones: exportar, importar CSV/XLSX, nuevo cliente (`:133` a `:148`). Validaciones: DNI 8 digitos (`:75`), telefono 9 digitos (`:79`). Estados: loading (`:184`), `formError` (`:409`). Mutacion: `src/hooks/use-clients.ts:49`.

## Detalle cliente `/clientes/$id`

Archivo: `src/routes/_app.clientes.$id.tsx`. Hooks/tablas: cliente, casos, pagos, documentos, reportes, tareas y eventos (`:63` a `:75`). Acciones: editar, eliminar si admin, ir a expedientes, subir/descargar/eliminar documentos. Descarga signed URL en `:224`. Estados: cargando (`:91`), no encontrado (`:101`), errores de edicion (`:204`, `:768`).

## Expedientes `/casos`

Archivo: `src/routes/_app.casos.index.tsx`. Hooks: `useCases`, `useClients`, `useUploadDocument`, `useProfiles`, `useCaseTasks`, `useCreateCase` (`:3` a `:7`, `:54` a `:59`). Tablas: `cases`, `clients`, `documents`, `profiles`, `case_tasks`. Acciones: filtros, busqueda, paginacion, crear expediente. Creacion en `:159` a `:220`; adjunto opcional en `:186` a `:194`. El numero de expediente es requerido en `:620`.

## Detalle expediente `/casos/$id`

Archivo: `src/routes/_app.casos.$id.tsx`. Hooks: `useCase`, `useDocuments`, `usePayments`, `useClientReports`, `useAuth`, `useUpdateCase`, `useUploadDocument`, `useDeleteDocument` (`:72` a `:80`). Tablas: `cases`, `documents`, `payments`, `client_reports`, y paneles de `case_parties`, `case_events`, `case_tasks`. Acciones: editar, subir/ver/descargar/borrar documentos, guardar resumen (`:254`). Estados: `isLoading`, `editError`.

## Documentos `/documentos`

Archivo: `src/routes/_app.documentos.index.tsx`. Hooks: `useDocuments`, `useClients`, `useCases`, `useUploadDocument`, `useDeleteDocument`, `useAuth` (`:48` a `:55`). Tablas: `documents`, `clients`, `cases`. Storage: signed URLs para abrir/descargar (`:107`, `:117`, `:566`). Acciones: buscar, filtrar, subir, ver, descargar, borrar. Estados: `isLoading` (`:51`), `uploadError` (`:61`).

## Agenda `/agenda`

Archivo: `src/routes/_app.agenda.index.tsx`. Hooks: `useAgendaEvents`, `useClients`, `useCases`, `useCaseTasks`, `useCreateAgendaEvent`, `useDeleteAgendaEvent`, `useImportFromGoogleCalendar` (`:77` a `:83`). Tablas: `agenda_events`, `clients`, `cases`, `case_tasks`. Acciones: crear, eliminar, sincronizar Google. Estados: `formError`, `syncStatus`. Mutaciones en `src/hooks/use-agenda.ts:58`, `:150`, `:173`.

## Pagos `/pagos`

Archivo: `src/routes/_app.pagos.index.tsx`. Hooks: `usePayments`, `useClients`, `useAuth`, `useCreatePayment`, `useRegisterPayment` (`:45` a `:50`). Tablas: `payments`, `payment_records`, `documents` para comprobantes. Permiso UI: redirige si no admin (`:75` a `:83`). Acciones: crear pago, registrar abono, subir comprobante (`:95`, `:145`, `:157`).

## Importaciones `/importaciones`

Archivo: `src/routes/_app.importaciones.index.tsx`. Componentes: `CSVImport` y `ZipImport` (`:5`, `:6`). Acciones: subir CSV/XLSX o ZIP (`:113`). Tablas: CSV escribe `clients`; ZIP escribe `clients`, `cases`, `documents` y Storage. Contradiccion: docs viejas dicen mock, codigo ZIP persiste.

## Revision IA `/revision-ia`

Archivo: `src/routes/_app.revision-ia.index.tsx`. Hooks: `useAiFindings`, `useImportJobsFilter`, `useUpdateFindingDecision` (`:44` a `:46`). Tablas: `ai_findings`, `source_references`, `import_jobs`. Estado inicial: demo local (`:31`). Datos mock: `demoFindings`, `demoCase`, `demoClient`.

## Reportes `/reportes`

Archivo: `src/routes/_app.reportes.index.tsx`. Hooks: `useClients`, `useCases`, `useDocuments`, `useAgendaEvents`, `useClientReports`, `useCreateClientReport` (`:459` a `:464`). Tablas: `clients`, `cases`, `documents`, `agenda_events`, `client_reports`. Acciones: publicar reporte (`:542`), visualizar/descargar JPG/DOCX (`:750` a `:765`, `:996` a `:1011`, `:1093` a `:1105`). Estados: `loadingClients`, `loadingCases`, `loadingReports`, `formError`, `preview`.

## Configuracion `/configuracion`

Archivo: `src/routes/_app.configuracion.index.tsx`. Admin-only por UI (`:104`). Hooks con `enabled: canLoadAdminData`: perfiles, clientes, casos, pagos, agenda (`:110` a `:115`). Acciones: usuarios, backup/export, Google Calendar, notificaciones localStorage, servicios proximamente. Botones/modulos sin backend confirmado: WhatsApp/SMTP/plantillas en `:694`, `:721`, `:741`.

## Dependencias cruzadas

Busqueda global consulta multiples tablas (`src/components/global-search.tsx:126` a `:177`). Chatbot usa clientes, casos, pagos admin y agenda (`src/components/chatbot.tsx:44` a `:50`) y puede crear eventos (`src/components/chatbot.tsx:193`).

