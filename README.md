# CRM Jurídico - Estudio Jurídico Arenas

CRM de gestión jurídica para clientes, expedientes, documentos, agenda, tareas, pagos y reportes. La aplicación usa React con TanStack Start, Supabase y Cloudflare Workers.

## Estado de esta fase

La base de gestión de expedientes está implementada de forma incremental. Las funciones existentes siguen usando las tablas y rutas heredadas; `cases` continúa siendo la entidad canónica y se presenta en la interfaz como “Expedientes”.

Disponibles:

- Clientes con resumen, expedientes, documentos, pagos, comunicaciones e historial.
- Listado de expedientes con búsqueda, filtros, orden y paginación.
- Perfil de expediente con resumen, partes, documentos, línea de tiempo, tareas, pagos, análisis jurídico e historial.
- Documentos con cliente, expediente, fuente, estado de análisis y verificación.
- Agenda con eventos y próximas tareas.
- Búsqueda estructurada de clientes, expedientes, documentos, partes, actuaciones, reportes, agenda y pagos.
- Importaciones y Revisión de IA con datos demostrativos locales.

Todavía simulados:

- Conexión documental con Google Drive.
- Extracción de texto y lectura de documentos escaneados.
- Clasificación y análisis jurídico mediante modelos externos.
- Procesamiento con Cloudflare Queues o Workflows.
- Confirmación de importaciones en la base real.

## Requisitos

- Node.js según `.node-version`.
- npm 10 o compatible.
- Proyecto Supabase existente.
- Variables definidas a partir de `.env.example`.

## Instalación y desarrollo

```powershell
npm install
npm run dev
```

La aplicación de desarrollo se inicia en la URL que muestra Vite.

## Migraciones

Para una base existente, aplicar en orden las migraciones de `supabase/migrations`. La migración de esta fase es:

```text
supabase/migrations/20260721090000_legal_case_foundation.sql
```

Con Supabase CLI y el proyecto previamente vinculado:

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

En una instalación limpia creada desde SQL Editor, ejecutar primero `supabase/schema.sql` y después `supabase/migrations/20260721090000_legal_case_foundation.sql`.

La migración es aditiva: no elimina ni renombra tablas o columnas. Antes de aplicarla en producción se recomienda crear un respaldo desde Supabase.

## Datos de demostración

Los datos ficticios no se cargan en Supabase. Están aislados en `src/lib/legal/demo-data.ts` y solo aparecen en `/importaciones` y `/revision-ia`.

```powershell
npm run demo:verify
```

## Verificación

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Producción

```powershell
npm run deploy:dry
npm run deploy
```

Los secretos privados deben cargarse con Cloudflare Secrets. Nunca deben añadirse claves `service_role`, OAuth, Google Drive o modelos de IA al frontend.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Base de datos](docs/database.md)
- [Flujo de importación](docs/import-workflow.md)
- [Revisión de IA](docs/ai-review.md)
- [Auditoría inicial](docs/audit-2026-07-21.md)
