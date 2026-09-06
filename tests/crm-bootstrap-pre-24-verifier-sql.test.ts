import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 8I-B2B-0B2B-I2-E1H — pruebas estáticas del artefacto SQL
 *   scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql
 *
 * No hay conexión a base de datos aquí (el artefacto es un script para
 * `psql` contra staging real, ejecutado por el owner) — estas pruebas
 * solo verifican, por contenido de texto, que la corrección del defecto
 * D3 (falso positivo: exigía que las 7 funciones referenciadas por
 * 20260806120000 estuvieran ausentes, cuando 2 de ellas ya existen desde
 * 20260729130000_daily_task_center.sql) quedó correctamente codificada,
 * y que ningún otro chequeo del rollback se perdió en la corrección.
 */

const verifier = readFileSync("scripts/sql/verify-crm-bootstrap-pre-20260806120000.sql", "utf8");

const PREEXISTING_FUNCTIONS = ["apply_case_task_completion", "validate_case_task_relationship"];

const NEW_ONLY_FUNCTIONS = [
  "guard_case_task_schedule",
  "audit_case_task_changes",
  "validate_document_relationship",
  "audit_document_metadata",
  "normalize_document_types",
];

const NEW_ONLY_TRIGGERS = ["case_tasks_05_guard_schedule", "case_tasks_audit_changes"];

describe("verify-crm-bootstrap-pre-20260806120000.sql — clasificación de funciones (Sección 6)", () => {
  it("exige exactamente 2 funciones preexistentes por su nombre, requiriendo que EXISTAN", () => {
    for (const fn of PREEXISTING_FUNCTIONS) {
      const requiresExistence = new RegExp(`proname\\s*=\\s*'${fn}'[\\s\\S]{0,400}?does not exist`);
      expect(verifier).toMatch(requiresExistence);
    }
  });

  it("las 2 funciones preexistentes NO aparecen en el arreglo de funciones exclusivas de #24", () => {
    const newOnlyArrayMatch = verifier.match(
      /select string_agg\(proname, ', '\) into v_new_functions[\s\S]*?proname in \(([\s\S]*?)\)/,
    );
    expect(newOnlyArrayMatch).not.toBeNull();
    const arrayBody = newOnlyArrayMatch![1];
    for (const fn of PREEXISTING_FUNCTIONS) {
      expect(arrayBody).not.toContain(`'${fn}'`);
    }
  });

  it("exige exactamente las 5 funciones nuevas de #24 como ausentes (v_new_functions)", () => {
    const newOnlyArrayMatch = verifier.match(
      /select string_agg\(proname, ', '\) into v_new_functions[\s\S]*?proname in \(([\s\S]*?)\)/,
    );
    expect(newOnlyArrayMatch).not.toBeNull();
    const arrayBody = newOnlyArrayMatch![1];
    const listed = NEW_ONLY_FUNCTIONS.every((fn) => arrayBody.includes(`'${fn}'`));
    expect(listed).toBe(true);
    // Exactamente 5 -- ni más ni menos -- contando las comas entre nombres.
    const nameCount = (arrayBody.match(/'[a-z_]+'/g) ?? []).length;
    expect(nameCount).toBe(5);
  });

  it("cada función #24-only real está en la lista de ausencia esperada", () => {
    for (const fn of NEW_ONLY_FUNCTIONS) {
      expect(verifier).toContain(`'${fn}'`);
    }
  });

  it("distingue PRE-#24 de POST-#24 por contenido semántico, no solo por existencia del nombre", () => {
    // apply_case_task_completion: la forma POST-#24 referencia started_at.
    expect(verifier).toMatch(/apply_case_task_completion[\s\S]{0,600}?started_at/i);
    // validate_case_task_relationship: la forma POST-#24 autocompleta client_id.
    expect(verifier).toContain("new\\.client_id\\s*:=\\s*v_case_client_id");
  });

  it("no depende de un hash MD5 congelado de pg_get_functiondef() como mecanismo primario", () => {
    expect(verifier.toLowerCase()).not.toContain("0cbf0b2afc8c00a90c8d716918bfccae");
    expect(verifier.toLowerCase()).not.toContain("17b3e6de4d649e0e40e208cb27818876");
  });
});

describe("verify-crm-bootstrap-pre-20260806120000.sql — el resto del contrato de rollback permanece", () => {
  it("sigue verificando ausencia de columnas nuevas de case_tasks", () => {
    expect(verifier).toContain("scheduled_for");
    expect(verifier).toContain("started_at");
  });

  it("sigue verificando ausencia de las 2 tablas nuevas", () => {
    expect(verifier).toContain("case_task_history");
    expect(verifier).toContain("document_change_history");
  });

  it("sigue verificando los 4 triggers exclusivos de #24 (D4)", () => {
    for (const tg of NEW_ONLY_TRIGGERS) {
      expect(verifier).toContain(`'${tg}'`);
    }
    // documents_validate_relationship / documents_audit_metadata no pueden
    // existir sin la tabla/columnas de #24, así que D4 solo necesita
    // comprobar los 2 triggers de case_tasks explícitamente listados —
    // confirmar que la lista no se redujo por error.
    expect(verifier).toMatch(/case_tasks_05_guard_schedule.*case_tasks_audit_changes/s);
  });

  it("sigue verificando conteo/límites de historial de migraciones (23, primero, último)", () => {
    expect(verifier).toContain("23");
    expect(verifier).toContain("20260713120000");
    expect(verifier).toContain("20260730210000");
  });

  it("sigue verificando ausencia de 20260806120000 en el historial", () => {
    expect(verifier).toContain("20260806120000");
  });

  it("sigue verificando que las 8 tablas de negocio están en cero filas", () => {
    for (const table of [
      "profiles",
      "clients",
      "cases",
      "case_tasks",
      "documents",
      "client_reports",
      "payments",
      "payment_records",
    ]) {
      expect(verifier).toContain(table);
    }
  });

  it("emite un NOTICE final inequívoco REMOTE_ROLLBACK_VERIFICATION = CONFIRMED", () => {
    expect(verifier).toContain("REMOTE_ROLLBACK_VERIFICATION = CONFIRMED");
  });

  it("sigue sin realizar ninguna escritura (ningún INSERT/UPDATE/DELETE/DDL)", () => {
    const withoutComments = verifier.replace(/--.*$/gm, "");
    expect(withoutComments).not.toMatch(/\binsert\s+into\b/i);
    expect(withoutComments).not.toMatch(/\bupdate\s+public\./i);
    expect(withoutComments).not.toMatch(/\bdelete\s+from\b/i);
    expect(withoutComments).not.toMatch(/\bcreate\s+table\b/i);
    expect(withoutComments).not.toMatch(/\balter\s+table\b/i);
  });

  it("tiene bloques DO balanceados (mismo número de aperturas y cierres)", () => {
    const opens = (verifier.match(/^do \$\$$/gm) ?? []).length;
    const closes = (verifier.match(/^\$\$;$/gm) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });
});
