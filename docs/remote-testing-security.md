# Política y Seguridad de Pruebas Remotas — Supabase

**CRM Estudio Jurídico Arenas** (`advocate-nest`)  
**Fecha de actualización:** 21 de Julio de 2026  

---

## 1. Definición de Variables de Entorno de Pruebas Remotas

Las pruebas contra la base de datos remota de Supabase están protegidas por variables de entorno estrictas y salvaguardas de ejecución:

| Variable | Tipo / Scope | Descripción / Requisito de Seguridad |
|---|---|---|
| `ALLOW_REMOTE_TESTS` | Server / Test | Debe valer explícitamente `"true"` para permitir la ejecución de `tests/remote-validation.test.ts`. Sin este valor, la suite remota se omite automáticamente (0 escrituras en DB). |
| `SUPABASE_PROJECT_REF` | Server / Test | Identificador de proyecto de Supabase (`pnqdgwpxcxngeueosmnh`). Valida que las pruebas apunten únicamente al entorno autorizado. |
| `VITE_SUPABASE_URL` | Client / Server | URL pública del proyecto Supabase. Libre de datos sensibles. |
| `VITE_SUPABASE_ANON_KEY` | Client / Server | Clave pública anónima de Supabase. Sujeta a políticas RLS de lectura y restricción de escritura. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-Only** | Clave administrativa de Supabase con bypass de RLS. **NUNCA debe ser expuesta al cliente, incluida en compilados frontend ni versionada en Git.** |

---

## 2. Salvaguardas de Ejecución e Aislamiento

1. **Aislamiento de `npm test`:**
   - El comando por defecto `npm test` ejecuta **únicamente pruebas locales unitarias** y excluye automáticamente `tests/remote-validation.test.ts`.
   - Para ejecutar la suite remota se requiere usar `npm run test:remote` con la variable `ALLOW_REMOTE_TESTS=true` exportada.

2. **Identificadores Únicos y Trazabilidad:**
   - Todos los registros creados durante pruebas remotas utilizan UUIDs dinámicos generados con `crypto.randomUUID()` y prefijos técnicos (`TEST_RUN_${Timestamp}_JOB`).
   - Jamás se utilizan datos personales, clientes reales o expedientes judiciales.

3. **Limpieza Garantizada:**
   - Toda creación de registros técnicos se envuelve en un bloque `finally` para asegurar el borrado estricto de los registros creados al terminar la prueba.
   - La eliminación respeta el orden estricto de claves foráneas: `source_references` → `ai_findings` → `ai_analysis_runs` → `import_jobs`.
   - No se ejecutan borrados masivos o con comodines globales que puedan afectar datos de otras ejecuciones.

---

## 3. Política de Respaldo y Recuperación de Datos

1. **Validez de Dumps:**
   - Archivos `.sql` generados con 0 bytes (debido a falta de Docker Desktop o fallos de CLI) **NO constituyen un respaldo válido**.
2. **Requisito de Entorno Local:**
   - Para ejecutar `npx supabase db dump --linked`, Docker Desktop debe estar instalado y en ejecución en el sistema.
3. **Verificación en Supabase Dashboard:**
   - Antes de procesar datos jurídicos reales, debe verificarse y confirmarse la existencia de copias de seguridad automáticas en **Supabase Dashboard → Database → Backups**.
