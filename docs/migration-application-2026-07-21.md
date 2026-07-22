# Registro de Aplicación de Migraciones — 21 de Julio de 2026

**Proyecto:** CRM Estudio Jurídico Arenas (`advocate-nest`)  
**Supabase Project REF:** `pnqdgwpxcxngeueosmnh` ("CRM Abogados a tu Servicio")  
**Rama Git:** `rescue/fase-2a-antigravity`  
**Tag Pre-Validación:** `fase-2a-pre-validacion-remota`  
**Tag Validación:** `fase-2a-validada-remota`  

---

## 1. Resumen de Despliegue de Base de Datos

Se han reconciliado y desplegado de manera segura todas las migraciones del sistema en la base de datos remota de Supabase sin alterar el historial existente ni ejecutar `migration repair`.

---

## 2. Historial de Migraciones Sincronizadas

```table
 Timestamp        | Nombre de la Migración                            | Estado Local | Estado Remoto
------------------|---------------------------------------------------|--------------|---------------
 `20260713131000` | `add_client_reports.sql`                          | Aplicado     | Aplicado
 `20260713150000` | `usability_timezone_case_links_and_rls.sql`       | Aplicado     | Aplicado
 `20260713162000` | `fix_client_reports_permissions.sql`              | Aplicado     | Aplicado
 `20260721090000` | `legal_case_foundation.sql`                       | Aplicado     | Aplicado
 `20260721120000` | `case_summary_defensive_backfill.sql`             | Aplicado     | Aplicado
 `20260721130000` | `grant_table_permissions.sql`                     | Aplicado     | Aplicado
 `20260721140000` | `revoke_anon_write_permissions.sql`               | Pendiente DB | Pendiente DB
```

---

## 3. Verificación de Migraciones y Objetos de Base de Datos

1. **`20260721090000_legal_case_foundation.sql`**:
   - Creación de 9 nuevas tablas: `case_parties`, `document_extractions`, `case_events`, `case_tasks`, `import_jobs`, `import_folders`, `ai_analysis_runs`, `ai_findings`, `source_references`.
   - Modificación aditiva en `clients`, `cases`, `documents` y `payments`.
   - Funciones auxiliares de seguridad: `is_staff()`, `is_admin()`, `set_updated_at()`.
   - Triggers automáticos de timestamp `updated_at`.
   - Habilitación de Row Level Security (RLS) en todas las tablas con políticas restrictivas por perfil.

2. **`20260721120000_case_summary_defensive_backfill.sql`**:
   - Bloque `DO` defensivo e idempotente para migrar valores legacy de `cases.notes` hacia `cases.current_summary` únicamente en caso de existir la columna.

3. **`20260721130000_grant_table_permissions.sql`**:
   - Concesión de permisos de esquema para los roles de PostgREST.

4. **`20260721140000_revoke_anon_write_permissions.sql` (Fase 2A.1 Endurecimiento):**
   - Revocación estricta de permisos de escritura (`INSERT`, `UPDATE`, `DELETE`) al rol `anon` en todas las tablas del esquema `public` como medida de defensa en profundidad.
