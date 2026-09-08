import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 8I-B2B-0B2B-I2-E2C — pruebas estáticas de los artefactos SQL
 *   scripts/sql/verify-crm-security-prerequisite-prestate.sql
 *   scripts/sql/verify-crm-security-prerequisite-poststate.sql
 *
 * No hay conexión a base de datos aquí -- ambos artefactos son scripts
 * para `psql` contra staging real, ejecutados por el owner. Estas pruebas
 * solo verifican, por contenido de texto, que cada contrato de
 * verificación quedó codificado correctamente y que ninguno de los dos
 * realiza ninguna escritura.
 */

const prestate = readFileSync("scripts/sql/verify-crm-security-prerequisite-prestate.sql", "utf8");
const poststate = readFileSync(
  "scripts/sql/verify-crm-security-prerequisite-poststate.sql",
  "utf8",
);

function withoutComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

function countBalancedDoBlocks(sql: string): { opens: number; closes: number } {
  const opens = (sql.match(/^do \$\$$/gm) ?? []).length;
  const closes = (sql.match(/^\$\$;$/gm) ?? []).length;
  return { opens, closes };
}

describe("verify-crm-security-prerequisite-prestate.sql", () => {
  it("es de solo lectura -- ningún INSERT/UPDATE/DELETE/DDL", () => {
    const body = withoutComments(prestate);
    expect(body).not.toMatch(/\binsert\s+into\b/i);
    expect(body).not.toMatch(/\bupdate\s+public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
    expect(body).not.toMatch(/\bcreate\s+table\b/i);
    expect(body).not.toMatch(/\balter\s+table\b/i);
    expect(body).not.toMatch(/\bcreate\s+function\b/i);
  });

  it("tiene bloques DO balanceados", () => {
    const { opens, closes } = countBalancedDoBlocks(prestate);
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });

  it("exige historial = 28, primero = 20260713120000, último = 20260822100000", () => {
    expect(prestate).toContain("v_count <> 28");
    expect(prestate).toContain("20260713120000");
    expect(prestate).toContain("20260822100000");
  });

  it("exige 20260822110000 ausente del historial", () => {
    expect(prestate).toContain("20260822110000");
  });

  it("exige ambas funciones objetivo ausentes", () => {
    expect(prestate).toContain("crm_is_active_staff");
    expect(prestate).toContain("crm_is_active_admin");
    expect(prestate).toMatch(/v_staff_exists or v_admin_exists/);
  });

  it("exige profiles_total = 1 y active Administrador/Activo = 1", () => {
    expect(prestate).toContain("v_profiles_total <> 1");
    expect(prestate).toContain("role = 'Administrador' and status = 'Activo'");
  });

  it("exige public.templates y ambas policies de storage ausentes", () => {
    expect(prestate).toContain("public.templates");
    expect(prestate).toContain("crm_templates_insert_admin_only");
    expect(prestate).toContain("crm_templates_update_admin_only");
  });

  it("emite el NOTICE final CRM_SECURITY_PREREQUISITE_PRESTATE = CONFIRMED", () => {
    expect(prestate).toContain("CRM_SECURITY_PREREQUISITE_PRESTATE = CONFIRMED");
  });
});

describe("verify-crm-security-prerequisite-poststate.sql", () => {
  it("es de solo lectura -- ningún INSERT/UPDATE/DELETE/DDL", () => {
    const body = withoutComments(poststate);
    expect(body).not.toMatch(/\binsert\s+into\b/i);
    expect(body).not.toMatch(/\bupdate\s+public\./i);
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
    expect(body).not.toMatch(/\bcreate\s+table\b/i);
    expect(body).not.toMatch(/\balter\s+table\b/i);
    expect(body).not.toMatch(/\bcreate\s+function\b/i);
  });

  it("nunca invoca claim_case_task/return_case_task ni actualiza case_tasks", () => {
    const body = withoutComments(poststate);
    expect(body).not.toMatch(/select\s+public\.claim_case_task\s*\(/i);
    expect(body).not.toMatch(/select\s+public\.return_case_task\s*\(/i);
    expect(body).not.toMatch(/update\s+public\.case_tasks/i);
    // Solo inspección de catálogo -- to_regprocedure(), nunca una llamada real.
    expect(body).toMatch(/to_regprocedure\('public\.claim_case_task\(uuid\)'\)/);
    expect(body).toMatch(/to_regprocedure\('public\.return_case_task\(uuid\)'\)/);
    expect(body).toMatch(/to_regprocedure\('public\.guard_case_task_update\(\)'\)/);
  });

  it("tiene bloques DO balanceados", () => {
    const { opens, closes } = countBalancedDoBlocks(poststate);
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });

  it("exige historial sin cambios: 28, último 20260822100000, 20260822110000 aún ausente", () => {
    expect(poststate).toContain("v_count <> 28");
    expect(poststate).toContain("20260822100000");
    expect(poststate).toContain("20260822110000");
  });

  it("exige ambas funciones EXISTEN con la forma esperada tras la proyección", () => {
    expect(poststate).toMatch(/to_regprocedure\('public\.' \|\| f \|\| '\(\)'\) is null/);
    expect(poststate).toContain("lanname = 'sql'");
    expect(poststate).toContain("p.provolatile = 's'");
    expect(poststate).toContain("p.prosecdef is true");
    expect(poststate).toContain("search_path=");
  });

  it("exige ACL exacto: authenticated=sí, anon=no, PUBLIC=no", () => {
    expect(poststate).toMatch(
      /has_function_privilege\('authenticated', 'public\.crm_is_active_staff\(\)', 'execute'\)/,
    );
    expect(poststate).toMatch(
      /has_function_privilege\('anon', 'public\.crm_is_active_staff\(\)', 'execute'\)/,
    );
    expect(poststate).toContain("grantee = 'PUBLIC'");
  });

  it("exige profiles_total = 1 y active_admins = 1 sin cambios", () => {
    expect(poststate).toContain("v_profiles_total <> 1");
    expect(poststate).toContain("v_active_admins <> 1");
  });

  it("exige public.templates y sus policies de storage aún ausentes", () => {
    expect(poststate).toContain("public.templates");
    expect(poststate).toContain("crm_templates_insert_admin_only");
    expect(poststate).toContain("crm_templates_update_admin_only");
  });

  it("verifica los 3 objetos latentes de 20260811103000 solo por catálogo", () => {
    expect(poststate).toContain("guard_case_task_update()");
    expect(poststate).toContain("claim_case_task(uuid)");
    expect(poststate).toContain("return_case_task(uuid)");
  });

  it("emite el NOTICE final CRM_SECURITY_PREREQUISITE_POSTSTATE = CONFIRMED", () => {
    expect(poststate).toContain("CRM_SECURITY_PREREQUISITE_POSTSTATE = CONFIRMED");
  });
});
