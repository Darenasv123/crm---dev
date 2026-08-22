import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const casoSource = readFileSync("src/routes/_app.casos.$id.tsx", "utf8");
const clientRelatedSource = readFileSync("src/components/clients/client-related-page.tsx", "utf8");
const useReportsSource = readFileSync("src/hooks/use-reports.ts", "utf8");
const whatsappSource = readFileSync("src/lib/whatsapp.ts", "utf8");
const clientReportsSource = readFileSync("src/lib/client-reports.ts", "utf8");

describe("Expediente → Reportes (Sección J, antes MISSING)", () => {
  it("la ficha de expediente consume useClientReports y filtra por case_id", () => {
    expect(casoSource).toContain(
      'import { useClientReports, reportCategoryLabel, type ReportCategory } from "@/hooks/use-reports"',
    );
    expect(casoSource).toContain("reports.filter((item) => item.case_id === id)");
  });

  it("no duplica una tabla de reportes propia — reutiliza la misma fuente de datos", () => {
    // No debe existir un segundo useQuery/fetch de client_reports fuera del hook compartido.
    expect(casoSource).not.toContain('.from("client_reports")');
  });

  it("enlaza de vuelta al módulo general de Reportes", () => {
    expect(casoSource).toContain('to={"/reportes" as never}');
  });
});

describe("Cliente → Reportes (Sección I, ya COMPLETE, sin duplicación)", () => {
  it("client-related-page.tsx sigue usando la misma fuente de datos de reportes", () => {
    expect(clientRelatedSource).toContain('import { useClientReports } from "@/hooks/use-reports"');
    expect(clientRelatedSource).toContain("reports.filter((item) => item.client_id === clientId)");
  });

  it("no reimplementa una consulta propia a client_reports", () => {
    expect(clientRelatedSource).not.toContain('.from("client_reports")');
  });
});

describe("Esquema de client_reports (Sección W — no se requirió migración)", () => {
  it("useClientReports ya selecciona case_id y la relación cases vía join", () => {
    expect(useReportsSource).toContain("cases(expediente, process_type, materia, status)");
  });
});

describe("Decoupling de WhatsApp (Sección M)", () => {
  it("client-reports.ts no contiene ninguna lógica específica de WhatsApp", () => {
    expect(clientReportsSource).not.toContain("wa.me");
    expect(clientReportsSource).not.toContain("normalizePhoneNumber");
    expect(clientReportsSource).not.toContain("buildWhatsAppUrl");
  });

  it("la lógica de WhatsApp vive aislada en su propio módulo, sin consumidores activos", () => {
    expect(whatsappSource).toContain("export function normalizePhoneNumber");
    expect(whatsappSource).toContain("export function buildWhatsAppUrl");
  });

  it("ningún componente de Reportes importa src/lib/whatsapp", () => {
    const formSource = readFileSync("src/components/client-report-form.tsx", "utf8");
    const routeSource = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");
    expect(formSource).not.toMatch(/from ["']@\/lib\/whatsapp["']/);
    expect(routeSource).not.toMatch(/from ["']@\/lib\/whatsapp["']/);
  });
});
