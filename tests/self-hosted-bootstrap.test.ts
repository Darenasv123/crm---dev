import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOCUMENT_TYPES = [
  "Demanda",
  "Resolución",
  "Sentencia",
  "Poder",
  "Contrato",
  "Otros",
] as const;

const readSql = (name: string) => readFileSync(`supabase/self-hosted/${name}`, "utf8");

const sql = {
  base: readSql("0001_extensions_and_base.sql"),
  profiles: readSql("0002_auth_and_profiles.sql"),
  tables: readSql("0003_domain_tables.sql"),
  functions: readSql("0004_functions_and_rpc.sql"),
  triggers: readSql("0005_triggers.sql"),
  rls: readSql("0006_rls_and_grants.sql"),
  storage: readSql("0007_storage.sql"),
  verify: readSql("0008_verify.sql"),
};

const allSql = Object.values(sql).join("\n");
const occurrences = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

// Elimina comentarios de línea "-- ..." y de bloque "/* ... */" antes de
// comprobaciones sintácticas, para que un regex no matchee texto que
// aparece únicamente dentro de un comentario (p.ej. un comentario que cita
// literalmente la sintaxis inválida "ADD CONSTRAINT IF NOT EXISTS" para
// explicar por qué NO se usa). Nunca se usa para leer literales de CHECK
// (esos no tienen comentarios dentro de sus paréntesis).
const stripSqlComments = (text: string) =>
  text.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ─── Contrato import_jobs.status (bug QA-IMPORT-TEST-20260815) ────────────────
//
// El importador ZIP inserta el import_job con status='processing' y lo
// finaliza con 'completed' | 'partially_completed' | 'failed'. El
// constraint import_jobs_status_check del bootstrap self-hosted debía
// aceptar exactamente esos valores (más los reservados del contrato cloud)
// y NO los nombres de fase del wizard nunca implementado
// (analyzing/reviewing/importing) — ver
// supabase/migrations/20260815120000_fix_import_jobs_status_check_constraint.sql.

const importEngineSource = readFileSync("src/lib/zip-import/import-engine.server.ts", "utf8");
const hotfixMigration = readFileSync(
  "supabase/migrations/20260815120000_fix_import_jobs_status_check_constraint.sql",
  "utf8",
);

const extractCheckValues = (text: string, constraintName: string): string[] => {
  const block = text.match(
    new RegExp(`constraint ${constraintName}[\\s\\S]*?\\)\\s*\\)[,;]`, "i"),
  )?.[0];
  if (!block) return [];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe("bootstrap canónico self-hosted", () => {
  it("fija PostgreSQL 17 y no depende de extensiones externas ni sintaxis PG18", () => {
    expect(sql.base).toContain("170000");
    expect(sql.base).toContain("180000");
    expect(sql.base).not.toMatch(/create\s+extension/i);
    expect(allSql).not.toMatch(/postgres(?:ql)?\s*18/i);
  });

  it("crea directamente 25 tablas, 21 funciones, 24 triggers y 82 policies", () => {
    expect(occurrences(allSql, /^create table public\./gim)).toBe(25);
    expect(occurrences(allSql, /^create function public\./gim)).toBe(21);
    expect(occurrences(allSql, /^create trigger /gim)).toBe(24);
    expect(occurrences(allSql, /^create policy /gim)).toBe(82);
    expect(occurrences(sql.rls, /^alter table public\..* enable row level security;/gim)).toBe(25);
  });

  it("fija 71 índices y 125 constraints en el DDL final", () => {
    const ddl = `${sql.profiles}\n${sql.tables}`;
    const primaryKeys = occurrences(ddl, /\bprimary key\b/gi);
    const foreignKeys = occurrences(ddl, /\breferences (?:public|auth)\./gi);
    const checks = occurrences(ddl, /\bcheck\s*\(/gi);
    const uniqueConstraints = occurrences(ddl, /\bunique(?:\s*\(|,)/gi);
    const explicitIndexes = occurrences(ddl, /^create (?:unique )?index /gim);

    expect({ primaryKeys, foreignKeys, checks, uniqueConstraints }).toEqual({
      primaryKeys: 25,
      foreignKeys: 59,
      checks: 39,
      uniqueConstraints: 2,
    });
    expect(primaryKeys + uniqueConstraints + explicitIndexes).toBe(71);
    expect(primaryKeys + foreignKeys + checks + uniqueConstraints).toBe(125);
  });

  it("incluye las seis funcionalidades locales activas", () => {
    for (const table of [
      "document_folders",
      "google_calendar_connections",
      "google_calendar_channels",
      "google_calendar_sync_log",
      "google_calendar_oauth_states",
      "google_calendar_sync_requests",
    ]) {
      expect(sql.tables).toContain(`create table public.${table}`);
    }
  });

  it("no contiene backfills, objetos cleanup ni IDs/datos históricos", () => {
    expect(allSql).not.toMatch(
      /create\s+(?:schema|table|view|function)\s+[^;]*(?:cleanup_backup|backup_verified)/i,
    );
    expect(sql.tables).not.toMatch(/^update\s+public\./gim);
    expect(sql.tables).not.toMatch(/^alter\s+table/gim);
    expect(allSql).not.toContain("2026-08-06 02:02:30.149561+00");
  });
});

describe("seguridad Auth y RLS", () => {
  it("signup ignora metadata de rol y siempre crea Personal", () => {
    const handleNewUser = sql.functions.match(
      /create function public\.handle_new_user\(\)[\s\S]*?\n\$\$;/i,
    )?.[0];
    expect(handleNewUser).toBeTruthy();
    expect(handleNewUser).not.toMatch(/raw_user_meta_data\s*->>?\s*['"]role['"]/i);
    expect(handleNewUser).toContain("'Personal'");
    expect(handleNewUser).not.toMatch(/set\s+role\s*=/i);
  });

  it("una cuenta inactiva no pasa los helpers y anon no recibe acceso", () => {
    expect(
      sql.functions.match(/create function public\.crm_is_active_staff\(\)[\s\S]*?\$\$;/i)?.[0],
    ).toContain("p.status = 'Activo'");
    expect(
      sql.functions.match(/create function public\.crm_is_active_admin\(\)[\s\S]*?\$\$;/i)?.[0],
    ).toContain("p.status = 'Activo'");
    expect(sql.rls).toContain(
      "revoke all on all tables in schema public from public, anon, authenticated",
    );
    expect(sql.rls).not.toMatch(/grant\s+.+\s+to\s+anon/i);
  });

  it("Personal no administra perfiles, pagos ni agenda", () => {
    expect(sql.rls).toMatch(/profiles_update_admin[\s\S]*?crm_is_active_admin/i);
    expect(sql.rls).toMatch(/payments_(?:select|insert|update|delete)[^;]+crm_is_active_admin/gi);
    expect(sql.rls).toMatch(
      /payment_records_(?:select|insert|update|delete)[^;]+crm_is_active_admin/gi,
    );
    expect(sql.rls).toMatch(/agenda_events_insert[^;]+crm_is_active_admin/i);
  });

  it("revoca SECURITY DEFINER de PUBLIC y expone solo ocho helpers/RPC", () => {
    expect(sql.rls).toContain(
      "revoke all on all functions in schema public from public, anon, authenticated",
    );
    expect(occurrences(sql.rls, /^grant execute on function public\./gim)).toBe(8);
    expect(sql.functions.match(/security definer/gim)?.length).toBeGreaterThan(0);
    for (const block of sql.functions.match(/create function[\s\S]*?\n\$\$;/gim) ?? []) {
      if (/security definer/i.test(block)) expect(block).toContain("set search_path = ''");
    }
  });
});

describe("integridad documental, tareas, pagos y Storage", () => {
  it("mantiene el catálogo canónico sincronizado con el CHECK SQL", () => {
    const check = sql.tables.match(/constraint documents_type_check[\s\S]*?\)\),/i)?.[0] ?? "";
    for (const type of DOCUMENT_TYPES) expect(check).toContain(`'${type}'`);
    expect(occurrences(check, /'[^']+'/g)).toBe(DOCUMENT_TYPES.length);
  });

  it("valida expediente-cliente y carpeta-cliente en documentos y tareas", () => {
    expect(sql.triggers).toContain("public.validate_document_relationship()");
    expect(sql.triggers).toContain("public.check_document_folder_same_client()");
    expect(sql.triggers).toContain("public.validate_case_task_relationship()");
    expect(sql.functions).toContain("new.client_id <> v_case_client_id");
  });

  it("instala un solo guard y preserva claim, return, completion e historial", () => {
    expect(occurrences(sql.triggers, /guard_case_task_update\(\)/gi)).toBe(1);
    expect(sql.triggers).not.toContain("guard_case_task_update_trigger");
    expect(sql.functions).toContain("for update");
    expect(sql.functions).toContain("'claim:' || v_uid::text");
    expect(sql.functions).toContain("'return:' || v_uid::text");
    expect(sql.functions).toContain("new.completed_by := auth.uid()");
    expect(sql.functions).toContain("insert into public.case_task_history");
    expect(sql.functions).toContain("insert into public.document_change_history");
  });

  it("protege el pago atómico con admin, lock y prevención de sobrepago", () => {
    expect(sql.functions).toContain("create function public.register_payment_record_atomic");
    expect(sql.functions).toContain("if not public.crm_is_active_admin()");
    expect(sql.functions).toContain("for update");
    expect(sql.functions).toContain("v_new_paid > v_payment.fees");
  });

  it("crea un bucket privado con cuatro policies consolidadas", () => {
    expect(sql.storage).toContain("values ('documents', 'documents', false, null, null)");
    expect(occurrences(sql.storage, /^create policy /gim)).toBe(4);
    expect(sql.storage).toContain("crm_documents_admin_delete");
    expect(sql.storage).not.toMatch(/allowed_mime_types\)\s*values[^;]+array\[/i);
  });

  it("mantiene verify.sql exclusivamente de lectura", () => {
    expect(sql.verify).toContain("begin transaction read only;");
    expect(sql.verify).not.toMatch(/^\s*(insert|update|delete|create|alter|drop|truncate)\b/gim);
    expect(sql.verify.trim().endsWith("commit;")).toBe(true);
  });
});

describe("contrato import_jobs.status (bug QA-IMPORT-TEST-20260815)", () => {
  const bootstrapValues = extractCheckValues(sql.tables, "import_jobs_status_check");
  // Versión sin comentarios del hotfix, para las comprobaciones sintácticas
  // de abajo (idempotencia, ausencia de DROP TABLE/DELETE, etc.). El SQL
  // ejecutable es idéntico; solo se descarta el texto de los comentarios.
  const hotfixSql = stripSqlComments(hotfixMigration);
  const hotfixValues = extractCheckValues(hotfixSql, "import_jobs_status_check");

  // Valores literales que src/lib/zip-import/import-engine.server.ts escribe
  // realmente en import_jobs.status, extraídos de los dos sitios de
  // escritura (creación del job y actualización final), no de un grep
  // genérico de "status:" (que también matchearía analysis_status,
  // processing_status, verification_status y el status del cliente).
  const creationBlock = importEngineSource.match(
    /\.from\("import_jobs"\)\s*\.insert\(\{[\s\S]*?\}\)/,
  )?.[0];
  const finalStatusBlock = importEngineSource.match(/const finalStatus =[\s\S]*?;/)?.[0];

  it("localiza los dos bloques de escritura en import-engine.server.ts", () => {
    // Si esto falla, el código se movió/renombró y la extracción de abajo
    // ya no está mirando el sitio real — hay que actualizar los regex, no
    // ignorar el fallo.
    expect(creationBlock).toBeTruthy();
    expect(finalStatusBlock).toBeTruthy();
  });

  const creationStatus = creationBlock?.match(/status:\s*"([^"]+)"/)?.[1];
  const finalStatusValues = [...(finalStatusBlock?.matchAll(/"([^"]+)"/g) ?? [])].map((m) => m[1]);
  const codeWritesValues = [creationStatus, ...finalStatusValues].filter(
    (v): v is string => typeof v === "string",
  );

  it("el job se crea con status='processing' (según .kiro spec e import-engine)", () => {
    expect(creationStatus).toBe("processing");
  });

  it("el estado final es completed | partially_completed | failed", () => {
    expect(finalStatusValues.sort()).toEqual(["completed", "failed", "partially_completed"].sort());
  });

  it("el bootstrap self-hosted acepta TODOS los valores que el código escribe", () => {
    for (const value of codeWritesValues) {
      expect(bootstrapValues).toContain(value);
    }
  });

  it("el bootstrap self-hosted ya NO contiene las fases del wizard nunca implementado", () => {
    // 'analyzing' / 'reviewing' / 'importing' son nombres de paso de
    // src/lib/imports/folder-import-engine.ts (spec .kiro, líneas 237-241),
    // un motor que nunca se construyó — no son valores de import_jobs.status.
    for (const retired of ["analyzing", "reviewing", "importing"]) {
      expect(bootstrapValues).not.toContain(retired);
    }
  });

  it("el bootstrap self-hosted coincide exactamente con el contrato cloud (legal_case_foundation)", () => {
    const cloudValues = [
      "draft",
      "inventory",
      "processing",
      "consolidating",
      "review_required",
      "completed",
      "partially_completed",
      "failed",
      "cancelled",
    ];
    expect([...bootstrapValues].sort()).toEqual([...cloudValues].sort());
  });

  it("el hotfix de supabase/migrations/ acepta el mismo conjunto que el bootstrap corregido", () => {
    expect([...hotfixValues].sort()).toEqual([...bootstrapValues].sort());
  });

  it("el hotfix es seguro para una base con datos: no recrea la tabla ni borra filas", () => {
    expect(hotfixSql).not.toMatch(/^\s*drop\s+table\b/gim);
    expect(hotfixSql).not.toMatch(/^\s*truncate\b/gim);
    expect(hotfixSql).not.toMatch(/^\s*delete\s+from\s+public\.import_jobs\b/gim);
    expect(hotfixSql).toContain("drop constraint if exists import_jobs_status_check");
    expect(hotfixMigration.trim().startsWith("begin;") || hotfixMigration).toContain("begin;");
    expect(hotfixMigration.trim().endsWith("commit;")).toBe(true);
  });

  it("el hotfix no toca ningún otro CHECK de la tabla", () => {
    expect(hotfixSql).not.toContain("import_jobs_progress_check");
  });

  it("el hotfix es idempotente: aplicarlo dos veces converge al mismo constraint", () => {
    // drop-if-exists + backfill (solo afecta filas con valores retirados,
    // cero filas en la segunda pasada) + add constraint de nombre fijo:
    // reejecutar produce exactamente el mismo estado final. Se comprueba
    // sobre hotfixSql (sin comentarios) para que un comentario que cita la
    // sintaxis inválida "ADD CONSTRAINT IF NOT EXISTS" —para explicar que
    // no existe en Postgres y por eso no se usa— no produzca un falso match.
    const dropCount = occurrences(
      hotfixSql,
      /drop constraint if exists import_jobs_status_check/gi,
    );
    const addCount = occurrences(hotfixSql, /add constraint import_jobs_status_check/gi);
    expect(dropCount).toBe(1);
    expect(addCount).toBe(1);
    expect(hotfixSql).not.toMatch(/add constraint[^;]+if not exists/i);
  });
});
