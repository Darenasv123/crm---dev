import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * QA-005: texto truncado sin forma de ver el contenido completo. No se
 * convierte todo el texto truncado a tooltip -- solo donde se confirmó un
 * hueco real (columna/campo con `truncate` pero sin `title` ni alternativa).
 */
describe("QA-005 — Expedientes: la columna Materia ahora expone el texto completo al truncarse", () => {
  it("la celda de Materia tiene title junto con truncate", () => {
    const source = readFileSync("src/routes/_app.casos.index.tsx", "utf8");
    const titleIdx = source.indexOf("title={item.materia || item.process_type");
    expect(titleIdx).toBeGreaterThan(-1);
    const block = source.slice(Math.max(0, titleIdx - 100), titleIdx + 100);
    expect(block).toContain("truncate");
    expect(block).toMatch(/title=\{item\.materia \|\| item\.process_type/);
  });
});

describe("QA-005 — Reportes: cliente/autor/expediente truncados exponen title", () => {
  const source = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");

  it("el nombre del cliente en la tarjeta de reporte tiene title", () => {
    const idx = source.indexOf('report.clients?.name ?? "Cliente eliminado"');
    const block = source.slice(Math.max(0, idx - 150), idx);
    expect(block).toContain("title=");
  });

  it("el autor tiene title", () => {
    const authorTitleIdx = source.indexOf(
      'title={report.profiles?.full_name ?? "Usuario del estudio"}',
    );
    expect(authorTitleIdx).toBeGreaterThan(-1);
  });

  it("el expediente tiene title", () => {
    const expedienteTitleIdx = source.indexOf(
      'title={report.cases?.expediente ?? "Reporte general"}',
    );
    expect(expedienteTitleIdx).toBeGreaterThan(-1);
  });
});

describe("QA-005 — Plantillas: el nombre truncado expone title", () => {
  it("template.name tiene title junto con truncate", () => {
    const source = readFileSync("src/components/settings/templates-settings.tsx", "utf8");
    const idx = source.indexOf('className="truncate text-sm font-semibold" title={template.name}');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("QA-005 — Clientes: patrón ya correcto (referencia, no debe regresionar)", () => {
  it("nombre y email en la lista de Clientes siguen teniendo title", () => {
    const source = readFileSync("src/routes/_app.clientes.index.tsx", "utf8");
    expect(source).toMatch(/title=\{client\.name/);
  });
});
