import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const migration = source("supabase/migrations/20260822120000_prevent_last_admin_removal.sql");
const ddl = migration.slice(migration.indexOf("begin;"));
const fnBlock = ddl.slice(
  ddl.indexOf("create or replace function public.prevent_last_admin_removal"),
  ddl.indexOf("comment on function"),
);

/**
 * Fase 6B: cobertura estructural del hardening de concurrencia. La prueba
 * REAL (dos transacciones concurrentes contra un Postgres local genuino,
 * usando exactamente este archivo de migración) se ejecutó manualmente
 * como parte de la auditoría de esta fase, contra una base de datos
 * desechable creada y eliminada en el propio Postgres local de la máquina
 * (no Supabase, no remoto) -- ver el informe de la fase para el detalle de
 * los 8 escenarios (A,B,C,F,H,I confirmados empíricamente; D/E/J
 * confirmados de forma incidental en cada reset del propio experimento).
 * Ese test real no se automatiza aquí porque el entorno de `npm test` (Node
 * puro, sin Postgres) no tiene acceso a una base de datos -- estas pruebas
 * verifican que el mecanismo exacto que se demostró seguro sigue presente
 * en el archivo que se compromete.
 */
describe("Fase 6B — el mecanismo de serialización (advisory lock) está presente y correcto", () => {
  it("adquiere pg_advisory_xact_lock (transaction-level, no session-level) antes de contar", () => {
    expect(fnBlock).toContain("pg_advisory_xact_lock(");
    expect(fnBlock).not.toContain("pg_advisory_lock(");
    expect(fnBlock).not.toContain("pg_try_advisory_lock");
  });

  it("usa una clave lógica única y fija para todo el sistema, no el id del usuario", () => {
    expect(fnBlock).toContain("hashtextextended('crm:last-active-admin', 0)");
  });

  it("no usa OLD.id ni ningún identificador de fila como clave del advisory lock", () => {
    const lockLine = fnBlock.split("\n").find((line) => line.includes("pg_advisory_xact_lock("));
    expect(lockLine).toBeDefined();
    expect(lockLine).not.toContain("OLD.id");
    expect(lockLine).not.toContain("NEW.id");
  });

  it("solo adquiere el lock cuando la fila realmente podría dejar de ser Administrador activo (no serializa ediciones inocuas)", () => {
    const ifBlockStart = fnBlock.indexOf("if losing_admin then");
    const lockIndex = fnBlock.indexOf("pg_advisory_xact_lock(");
    const endIfIndex = fnBlock.indexOf("end if;", lockIndex);
    expect(ifBlockStart).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(ifBlockStart);
    expect(endIfIndex).toBeGreaterThan(lockIndex);
  });

  it("el conteo de administradores restantes ocurre DESPUÉS de adquirir el lock, no antes", () => {
    const lockIndex = fnBlock.indexOf("pg_advisory_xact_lock(");
    const countIndex = fnBlock.indexOf("select count(*)");
    expect(lockIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(lockIndex);
  });

  it("un único lock lógico global: solo hay una llamada a pg_advisory_xact_lock en toda la función (sin lock por fila, sin riesgo de deadlock por orden de adquisición)", () => {
    expect(fnBlock.match(/pg_advisory_xact_lock\(/g)).toHaveLength(1);
  });

  it("no hay polling ni sleeps: la espera es exclusivamente el bloqueo nativo del advisory lock", () => {
    expect(fnBlock).not.toMatch(/pg_sleep|LOOP|while/i);
  });

  it("no crea ninguna tabla de locks adicional", () => {
    expect(ddl).not.toMatch(/create table/i);
  });
});

describe("Fase 6B — volatility explícita (no STABLE/IMMUTABLE)", () => {
  it("la función se declara VOLATILE explícitamente", () => {
    const signatureBlock = ddl.slice(
      ddl.indexOf("create or replace function public.prevent_last_admin_removal"),
      ddl.indexOf("as $$"),
    );
    expect(signatureBlock).toContain("volatile");
    expect(signatureBlock).not.toMatch(/\bstable\b/i);
    expect(signatureBlock).not.toMatch(/\bimmutable\b/i);
  });
});

describe("Fase 6B — precheck de datos: no declarar protegido un invariante ya violado", () => {
  it("verifica que exista al menos 1 Administrador activo ANTES de crear la función/triggers", () => {
    const precheckIndex = ddl.indexOf("active_admins = 0");
    const fnIndex = ddl.indexOf("create or replace function public.prevent_last_admin_removal");
    expect(precheckIndex).toBeGreaterThan(-1);
    expect(fnIndex).toBeGreaterThan(precheckIndex);
  });

  it("si hay 0 Administradores activos, aborta con RAISE EXCEPTION, no promueve a nadie automáticamente", () => {
    const precheckBlock = ddl.slice(
      ddl.indexOf("do $$"),
      ddl.indexOf("create or replace function"),
    );
    expect(precheckBlock).toContain("raise exception");
    expect(precheckBlock).toContain("No se promovió ningún usuario automáticamente");
    expect(precheckBlock).not.toMatch(/\bupdate\s+public\.profiles\b/i);
    expect(precheckBlock).not.toMatch(/\binsert\s+into\s+public\.profiles\b/i);
  });
});

describe("Fase 6B — se corrigió la MISMA migración de Fase 6 (todavía no aplicada), sin crear una segunda", () => {
  it("sigue siendo un único archivo de migración para este invariante", () => {
    // readFileSync ya habría lanzado si el archivo no existiera en esa
    // ruta exacta; aquí se confirma que el propio contenido documenta la
    // corrección de Fase 6B dentro del mismo archivo, no en uno nuevo.
    expect(migration).toContain("Corrección de seguridad (Fase 6B");
  });

  it("no se aplica remotamente", () => {
    expect(migration).toContain("NO se aplica remotamente");
  });

  it("documenta el análisis de la carrera (write skew) que motivó la corrección", () => {
    expect(migration).toMatch(/write skew/i);
    expect(migration).toContain("READ COMMITTED");
  });
});

describe("Fase 6B — sin riesgo de deadlock (orden único de serialización)", () => {
  it("no usa SELECT ... FOR UPDATE sobre múltiples filas de administradores", () => {
    expect(fnBlock).not.toMatch(/for update/i);
  });

  it("el conteo excluye explícitamente la fila propia (id <> OLD.id), evitando autobloqueo", () => {
    expect(fnBlock).toContain("id <> OLD.id");
  });
});
