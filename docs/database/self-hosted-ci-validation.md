# Validación del bootstrap self-hosted en GitHub Actions

## Propósito

El workflow `.github/workflows/self-hosted-bootstrap-validation.yml` prepara un Supabase local completamente desechable en un runner estándar `ubuntu-latest`. No enlaza un proyecto remoto, no usa secretos del repositorio y no contiene comandos de despliegue.

La versión de Supabase CLI queda fijada en `2.113.0`. El workflow comprueba la versión real del servidor PostgreSQL levantado por esa CLI y termina como `RUNTIME_MISMATCH` antes de ejecutar SQL si no pertenece a PostgreSQL 17.x.

## Ejecución

El único disparador es manual (`workflow_dispatch`). Después de subir y revisar los archivos:

1. Abrir **Actions → Validate canonical self-hosted bootstrap**.
2. Seleccionar la rama revisada y pulsar **Run workflow**.
3. Consultar el resultado en el resumen del job.
4. Descargar el artifact `self-hosted-bootstrap-validation-<run>-<attempt>`.

No se requieren GitHub Secrets. El `GITHUB_TOKEN` tampoco se concede con permisos de escritura; el job tiene únicamente `contents: read`.

## Aislamiento

- El proyecto Supabase vive en `${RUNNER_TEMP}/crm-bootstrap-ci`, fuera de `supabase/` del repositorio. Por ello `supabase start` no aplica las 23 migraciones históricas.
- Todos los usuarios, datos, claves y archivos son generados por el stack local del runner.
- El script descubre exactamente un contenedor `supabase_db_*` en la VM desechable y ejecuta `psql` dentro de él, sin exponer la contraseña del PostgreSQL local.
- La salida cruda de `supabase start` no se publica ni se incluye en artifacts porque contiene claves locales.
- Un `trap` ejecuta `supabase stop --no-backup` incluso cuando falla una fase. La propia VM de GitHub se descarta al finalizar.

## Secuencia validada

1. Docker, CLI, recursos del runner y runtime PostgreSQL.
2. Preflight de Auth, Storage, roles, PL/pgSQL, UUID y ausencia de tablas CRM.
3. Aplicación individual de `0001` a `0007`, con hora, duración y snapshot de objetos.
4. `0008_verify.sql`; cualquier fila `FAIL` produce `VERIFY_FAILED`.
5. Pruebas funcionales con usuarios y datos ficticios: Auth, escalamiento, RLS, tareas y concurrencia, integridad documental, auditoría, pagos y locking, Storage y estructura Google Calendar.
6. Tests focalizados del repositorio, TypeScript, ESLint sobre `src/`, `tests/` y el script funcional nuevo, y build. `server-release/` queda fuera porque pertenece a otro flujo y no es una dependencia del bootstrap.
7. Destrucción sin backup, segundo `supabase start`, preflight, bootstrap y verify desde cero.

## Estados finales

- `PASS`
- `BOOTSTRAP_FAILED`
- `VERIFY_FAILED`
- `TEST_FAILED`
- `RUNTIME_MISMATCH`

El job termina con código distinto de cero para cualquier estado que no sea `PASS`. Los fallos no se silencian; `continue-on-error` se usa únicamente para permitir la carga de artifacts antes del paso final que falla el job.

## Artifacts sanitizados

- `bootstrap-validation.log`
- `verify-output.txt`
- `runtime.txt`
- `test-results.txt`
- `result.txt`

No se guarda `.env`, salida de `supabase status`, salida de `supabase start`, JWT secrets, anon key, service-role key ni contraseñas.

## Requisitos antes de subir

- Revisar el diff de workflow y scripts.
- Confirmar que GitHub Actions está habilitado para el repositorio.
- Permitir las acciones `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` y `supabase/setup-cli` según la política de Actions de la organización.
- Mantener disponible espacio y tiempo suficientes en el runner; el timeout es de 60 minutos.
- No añadir secretos Cloud/self-hosted al workflow.

## Riesgos pendientes

- Supabase CLI gestiona versiones de imágenes internas; aunque la CLI está fijada, el workflow debe registrar los tags e imagen PostgreSQL observados. La barrera definitiva es `SELECT current_setting('server_version_num')`.
- GitHub-hosted runners no reproducen necesariamente las versiones exactas de todos los servicios del servidor final. Esta prueba valida un Supabase local real sobre PostgreSQL 17, no sustituye el inventario read-only de producción.
- La suite funcional depende del comportamiento de GoTrue, Storage y PostgREST incluidos por la CLI fijada. Una futura actualización debe hacerse mediante PR separado y nueva doble reconstrucción.
- La validación de interfaz completa en navegador no forma parte de este workflow; se ejecutan build y pruebas de integración existentes, además de las pruebas reales del backend.
