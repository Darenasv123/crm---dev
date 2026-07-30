import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");
const formSource = readFileSync("src/components/client-report-form.tsx", "utf8");

describe("flujo único de reportes", () => {
  it("renderiza una sola instancia del formulario canónico", () => {
    expect(routeSource.match(/<ClientReportForm/g)).toHaveLength(1);
    expect(routeSource).not.toContain("<ReportComposer");
  });

  it("la ficha se limita al contacto vigente", () => {
    expect(routeSource).toContain('label: "Teléfono"');
    expect(routeSource).toContain('label: "Correo"');
    expect(routeSource).toContain('title="Información del cliente"');
  });

  it("la búsqueda del formulario usa nombre, teléfono o correo", () => {
    expect(formSource).toContain("Buscar por nombre, teléfono o correo");
  });
});
