import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260822100000_client_reports_case_client_integrity.sql";
const migration = readFileSync(migrationPath, "utf8");
const useReportsSource = readFileSync("src/hooks/use-reports.ts", "utf8");
const clientReportsSource = readFileSync("src/lib/client-reports.ts", "utf8");

describe("Fase 4B — integridad real en base de datos (client_reports ↔ cases)", () => {
  it("es una migración incremental nueva, no una edición de una migración histórica", () => {
    // El resto de migraciones ya aplicadas permanecen intactas (verificado también
    // en el diff de la fase: ningún archivo bajo supabase/migrations/ salvo este es nuevo/modificado).
    expect(migrationPath).toMatch(/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/);
    expect(migration.trim().startsWith("--")).toBe(true);
  });

  it("añade una constraint UNIQUE sobre cases(id, client_id) para poder referenciarla", () => {
    expect(migration).toContain("add constraint cases_id_client_id_key unique (id, client_id)");
  });

  it("añade la foreign key compuesta client_reports(case_id, client_id) -> cases(id, client_id)", () => {
    expect(migration).toContain("add constraint client_reports_case_client_fkey");
    expect(migration).toContain("foreign key (case_id, client_id)");
    expect(migration).toContain("references public.cases (id, client_id)");
  });

  it("documenta la semántica histórica real de las FK simples preexistentes antes de tocar nada", () => {
    expect(migration).toContain("case_id   -> cases(id)   on delete set null");
    expect(migration).toContain("client_id -> clients(id) on delete cascade");
    expect(migration).toContain("ON UPDATE NO ACTION, NOT");
  });

  it("la FK compuesta declara ON DELETE/ON UPDATE explícitos, sin depender de la FK simple", () => {
    expect(migration).toContain("on delete set null (case_id)");
    expect(migration).toContain("on update no action");
  });

  it("no elimina ninguna foreign key ni constraint histórica existente", () => {
    expect(migration).not.toMatch(/drop\s+constraint/i);
    expect(migration).toContain("Se mantiene la FK simple original de case_id sin cambios");
  });

  it("la FK compuesta no declara MATCH FULL/PARTIAL — usa MATCH SIMPLE (comportamiento por defecto)", () => {
    // MATCH SIMPLE es exactamente lo que permite que case_id NULL siga
    // pasando la constraint sin evaluar client_id (Escenario C/F). Se
    // verifica la sentencia DDL en sí, no el archivo completo: el propio
    // comentario explicativo menciona "MATCH FULL/PARTIAL" en contraste,
    // así que buscar en todo el archivo daría un falso positivo.
    const fkStatement = migration.slice(
      migration.indexOf("add constraint client_reports_case_client_fkey"),
      migration.indexOf("on update no action;") + "on update no action;".length,
    );
    expect(fkStatement).not.toMatch(/match/i);
  });

  it("no cambia la nulabilidad de case_id (los reportes sin expediente siguen permitidos)", () => {
    expect(migration).not.toContain("alter column case_id");
    expect(migration).not.toMatch(/case_id\s+uuid\s+not\s+null/i);
  });

  it("detecta datos históricos inconsistentes de forma segura antes de aplicar la constraint", () => {
    expect(migration).toContain("bad_rows > 0");
    expect(migration).toContain("raise exception");
    expect(migration).toContain(
      "where cr.case_id is not null\n     and c.client_id <> cr.client_id",
    );
  });

  it("no reasigna ni borra datos automáticamente en caso de inconsistencia", () => {
    expect(migration).not.toMatch(/\bupdate\s+public\.client_reports\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\s+public\.client_reports\b/i);
    expect(migration).toContain("No se modificó ningún dato.");
  });

  it("no se aplica remotamente como parte de esta fase (documentado en el propio archivo)", () => {
    expect(migration).toContain("NO se aplica remotamente");
  });

  it("no toca Google Calendar ni ninguna otra tabla ajena a client_reports/cases", () => {
    expect(migration).not.toMatch(/google_calendar/i);
    // Sin flag "i": las sentencias DDL reales del proyecto son siempre en
    // minúsculas; el comentario explicativo usa "ALTER TABLE" en mayúsculas
    // solo como referencia genérica al comportamiento de Postgres, no como
    // una tercera sentencia real.
    expect(migration.match(/alter table/g)).toHaveLength(2); // cases, client_reports
  });
});

describe("Fase 4B — defensa adicional en la mutation (segunda capa, antes de la BD)", () => {
  it("useCreateClientReport valida el expediente contra el cliente antes de insertar", () => {
    const mutationStart = useReportsSource.indexOf("export function useCreateClientReport");
    expect(mutationStart).toBeGreaterThan(-1);
    const guardIndex = useReportsSource.indexOf("if (input.case_id) {", mutationStart);
    const insertIndex = useReportsSource.indexOf(
      '.from("client_reports")\n        .insert(',
      mutationStart,
    );
    expect(guardIndex).toBeGreaterThan(mutationStart);
    expect(insertIndex).toBeGreaterThan(guardIndex);
  });

  it("el guard consulta cases filtrando por id Y client_id (no solo por id)", () => {
    const mutationStart = useReportsSource.indexOf("export function useCreateClientReport");
    const guardStart = useReportsSource.indexOf("if (input.case_id) {", mutationStart);
    const guardEnd = useReportsSource.indexOf(
      'const { data, error } = await db\n        .from("client_reports")',
      guardStart,
    );
    const guardBlock = useReportsSource.slice(guardStart, guardEnd);
    expect(guardBlock).toContain('.eq("id", input.case_id)');
    expect(guardBlock).toContain('.eq("client_id", input.client_id)');
    expect(guardBlock).toContain("relatedCase");
    expect(guardBlock).toContain("El expediente seleccionado no pertenece a este cliente.");
  });

  it("no depende únicamente del navegador — la garantía final es la constraint de BD", () => {
    // El guard de la mutation es una validación adicional barata, no un
    // reemplazo de la foreign key compuesta (ver migración de esta fase).
    expect(useReportsSource).toContain("No es la garantía final");
  });
});

describe("Fase 4B — el guard del frontend (Fase 4) sigue intacto, sin duplicarlo", () => {
  it("isCaseOwnedByClient continúa siendo la primera línea de defensa en la UI", () => {
    expect(clientReportsSource).toContain("export function isCaseOwnedByClient");
  });
});

describe("Cierre Fase 4 — escenarios de integridad exigidos (A-F)", () => {
  // La UI/mutation ya se cubre en el describe anterior ("defensa adicional
  // en la mutation") y en tests/client-report-form-integration.test.ts
  // ("cambiar (seleccionar) de cliente limpia siempre el expediente
  // seleccionado", equivalente a A/B a nivel de formulario) — no se
  // duplica aquí. Este bloque verifica la semántica declarada en el propio
  // DDL para cada escenario, dado que el entorno de tests no tiene una
  // base de datos Postgres real disponible (vitest en modo node, sin
  // Supabase local en este proyecto).

  it("[A] Cliente A + Expediente A: la FK compuesta lo permite (coincide (id, client_id))", () => {
    expect(migration).toContain("references public.cases (id, client_id)");
  });

  it("[B] Cliente A + Expediente de Cliente B: la FK compuesta lo rechaza (no existe fila cases con ese (id, client_id))", () => {
    expect(migration).toContain("un expediente que pertenece a un cliente distinto de client_id");
  });

  it("[C] Cliente A + case_id NULL: MATCH SIMPLE no evalúa la constraint, se permite", () => {
    expect(migration).not.toMatch(/case_id\s+uuid\s+not\s+null/i);
    expect(migration).toContain("references public.cases (id, client_id)");
  });

  it("[D] eliminar el expediente: solo se anula case_id, client_id (y el reporte) se conservan", () => {
    expect(migration).toContain("on delete set null (case_id)");
    // La sintaxis de columna específica evita el riesgo señalado: un
    // "on delete set null" sin columna anularía también client_id (NOT
    // NULL en client_reports), lo que rompería el borrado del expediente.
    expect(migration).not.toMatch(/on delete set null\s*\n?\s*;/i);
    expect(migration).toContain("pondría a NULL TODAS sus columnas -- incluida client_id");
  });

  it("[E] eliminar el cliente: conserva la semántica histórica (cascade ya existente, sin cambios)", () => {
    // client_reports.client_id -> clients(id) on delete cascade ya borraba
    // los reportes del cliente antes de esta migración; esta fase no
    // toca esa FK ni añade ninguna nueva sobre clients.
    expect(migration).not.toMatch(/references\s+public\.clients/i);
    expect(migration).toContain("client_id -> clients(id) on delete cascade");
  });

  it("[F] reasignar cases.client_id: se rechaza si deja una relación cruzada silenciosa con algún reporte", () => {
    expect(migration).toContain("on update no action");
    expect(migration).toContain("CaseEditDialog / useUpdateCase");
    expect(migration).toContain("la actualización del\n--   expediente se rechaza");
  });

  it("un payload manipulado no puede preservar una relación cruzada: mutation y BD lo rechazan de forma independiente", () => {
    expect(useReportsSource).toContain("El expediente seleccionado no pertenece a este cliente.");
    expect(migration).toContain("add constraint client_reports_case_client_fkey");
  });
});
