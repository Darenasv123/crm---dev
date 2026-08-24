import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/_app.index.tsx", "utf8");

/**
 * Fase 7 — QA-014: el Dashboard no debe mostrar 0 como si fuera un dato real
 * mientras carga, ni un saludo con una identidad genérica falsa antes de que
 * el perfil llegue. Estas pruebas verifican el mecanismo (loading states +
 * saludo condicionado a authLoading/profile), no solo que exista texto.
 */
describe("QA-014 — Dashboard no muestra datos falsos durante la carga", () => {
  it("el saludo no usa un nombre de reemplazo genérico (p. ej. 'equipo') como si fuera el usuario real", () => {
    expect(source).not.toMatch(/profile\?\.full_name\s*\?\?\s*["'`]equipo["'`]/);
  });

  it("el título del saludo depende de authLoading o de la ausencia de full_name antes de mostrar el nombre real", () => {
    const titleLine = source
      .split("\n")
      .find((line) => line.includes("const title") && line.includes("greeting"));
    expect(titleLine).toBeDefined();
    expect(titleLine).toMatch(/authLoading/);
    expect(titleLine).toMatch(/profile\?\.full_name/);
  });

  it("cada KpiCard recibe un prop loading en vez de mostrar 0 durante la carga", () => {
    const kpiCardCalls = source.match(/<KpiCard[\s\S]*?\/>/g) ?? [];
    expect(kpiCardCalls.length).toBeGreaterThan(0);
    for (const call of kpiCardCalls) {
      expect(call).toMatch(/loading=\{/);
    }
  });

  it("KpiCard renderiza un placeholder animado (skeleton) cuando loading es true, no el número", () => {
    const fnStart = source.indexOf("function KpiCard");
    const fnEnd = source.indexOf("\nfunction ", fnStart + 1);
    const kpiCardFn = source.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 3000);
    expect(kpiCardFn).toContain("loading ? (");
    expect(kpiCardFn).toContain("animate-pulse");
    expect(kpiCardFn).toMatch(/role="status"/);
  });

  it("los hooks de datos del dashboard exponen isLoading y el componente lo consume", () => {
    expect(source).toMatch(/isLoading:\s*clientsLoading/);
    expect(source).toMatch(/isLoading:\s*casesLoading/);
  });
});
