import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync("src/routes/_app.reportes.index.tsx", "utf8");
const formSource = readFileSync("src/components/client-report-form.tsx", "utf8");

/** Extrae el texto entre dos marcadores literales (ambos deben existir una sola vez). */
function slice(source: string, fromMarker: string, toMarker: string): string {
  const start = source.indexOf(fromMarker);
  const end = source.indexOf(toMarker, start + fromMarker.length);
  expect(start, `marcador de inicio no encontrado: ${fromMarker}`).toBeGreaterThan(-1);
  expect(end, `marcador de fin no encontrado: ${toMarker}`).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe("flujo único de reportes (Fase 4)", () => {
  it("renderiza una sola instancia del formulario canónico", () => {
    expect(routeSource.match(/<ClientReportForm/g)).toHaveLength(1);
    expect(routeSource).not.toContain("<ReportComposer");
  });

  it("no existe un panel/lista lateral de clientes independiente en la ruta", () => {
    expect(routeSource).not.toContain("Buscar cliente para reportes");
    expect(routeSource).not.toContain("selectedClientId");
    expect(routeSource).not.toContain("filteredClients");
  });

  it("la búsqueda de cliente vive únicamente dentro de ClientReportForm", () => {
    expect(formSource).toContain("Buscar por nombre, teléfono o correo");
    expect(formSource).toContain('aria-label="Buscar cliente por nombre, teléfono o correo"');
    expect(routeSource).not.toContain("Buscar por nombre, teléfono o correo");
  });
});

describe("QA-013 — WhatsApp eliminado de Reportes (no reparado)", () => {
  it("el formulario no contiene ninguna acción de envío por WhatsApp", () => {
    expect(formSource).not.toContain("Enviar al cliente");
    expect(formSource).not.toContain("handleOpenWhatsApp");
    expect(formSource).not.toContain("MessageCircle");
    expect(formSource).not.toContain("wa.me");
    expect(formSource).not.toContain("buildWhatsAppUrl");
    expect(formSource).not.toContain("whatsappError");
  });

  it("el formulario no importa nada de la lógica de WhatsApp", () => {
    expect(formSource).not.toMatch(/from ["']@\/lib\/whatsapp["']/);
  });

  it("guardar el reporte no depende del teléfono del cliente", () => {
    const canSubmitBlock = slice(
      formSource,
      "const canSubmit = Boolean(",
      "async function handleCopyReport",
    );
    expect(canSubmitBlock).not.toContain(".phone");
  });

  it("mantiene Guardar reporte y Copiar como únicas acciones", () => {
    expect(formSource).toContain("Guardar reporte");
    expect(formSource).toContain("Copiar");
    expect(formSource.match(/type="submit"/g)).toHaveLength(1);
  });
});

describe("cliente como única fuente de verdad (corrige la desincronización QA-013)", () => {
  it("cambiar (seleccionar) de cliente limpia siempre el expediente seleccionado", () => {
    const selectClientBlock = slice(formSource, "function selectClient", "function changeClient");
    expect(selectClientBlock).toContain("client_id: client.id");
    expect(selectClientBlock).toContain('case_id: ""');
  });

  it("el botón «Cambiar» limpia cliente y expediente juntos", () => {
    const changeClientBlock = slice(
      formSource,
      "function changeClient",
      "// Autocompletar materia",
    );
    expect(changeClientBlock).toContain('client_id: "", case_id: "", materia: ""');
  });

  it("el resumen de cliente seleccionado muestra solo datos mínimos de identidad", () => {
    const summaryBlock = slice(
      formSource,
      "function SelectedClientSummary",
      "function ClientCombobox",
    );
    expect(summaryBlock).toContain("client.phone");
    expect(summaryBlock).toContain("client.email");
    expect(summaryBlock).toContain("caseCount");
    // No debe duplicar la ficha completa del cliente (sin estado, sin fecha de registro, etc.)
    expect(summaryBlock).not.toContain("client.status");
    expect(summaryBlock).not.toContain("registered_at");
  });

  it("el resumen enlaza a Documentos y Expedientes del cliente (reutiliza Fase 1, no crea un 4º gestor)", () => {
    const summaryBlock = slice(
      formSource,
      "function SelectedClientSummary",
      "function ClientCombobox",
    );
    expect(summaryBlock).toContain('"/clientes/$id/documentos"');
    expect(summaryBlock).toContain('"/clientes/$id/expedientes"');
  });
});

describe("expediente acotado estrictamente al cliente (Sección F/G)", () => {
  it("usa las funciones puras de acotamiento en vez de filtrar cases inline", () => {
    expect(formSource).toContain("casesForClient(cases, formData.client_id)");
    expect(formSource).toContain(
      "isCaseOwnedByClient(clientCases, formData.case_id, formData.client_id)",
    );
  });

  it("rechaza un expediente ajeno antes de enviar el payload", () => {
    const submitBlock = slice(formSource, "async function handleSubmit", "return (\n    <Card");
    expect(submitBlock).toContain("isCaseOwnedByClient");
    expect(submitBlock).toContain('case_id: "" }))');
  });
});

describe("persistencia con feedback real (Sección H)", () => {
  it("no muestra confirmación de guardado antes de que la mutation resuelva", () => {
    const submitBlock = slice(formSource, "async function handleSubmit", "return (\n    <Card");
    const awaitIndex = submitBlock.indexOf("await onSubmit(");
    const savedIndex = submitBlock.indexOf("setSaved(true)");
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(savedIndex).toBeGreaterThan(awaitIndex);
  });

  it("resetea el formulario únicamente tras éxito real", () => {
    expect(formSource).toContain("setFormData(EMPTY_FORM(today))");
  });

  it("previene doble envío mientras la mutation está en curso", () => {
    expect(formSource).toContain("!saving");
    expect(formSource).toContain("disabled={!canSubmit}");
  });

  it("copiar usa la API real del portapapeles con feedback de éxito y error", () => {
    expect(formSource).toContain("navigator.clipboard.writeText");
    expect(formSource).toContain("setCopied(true)");
    expect(formSource).toContain("catch (err)");
  });
});

describe("permisos consumidos en la ruta de Reportes (Sección Q)", () => {
  it("la ruta importa y aplica resolveReportPermissions vía usePermissions", () => {
    expect(routeSource).toContain('import { usePermissions } from "@/lib/permissions"');
    expect(routeSource).toContain("permissions.canCreateReports");
  });
});
