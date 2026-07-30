import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("aislamiento del preview visual del CRM", () => {
  it("no permite importar código productivo de autenticación ni servicios remotos", () => {
    const preview = source("dev/crm-preview-main.tsx");

    // No debe conectarse a servicios reales
    expect(preview).not.toContain("supabase");
    expect(preview).not.toContain("use-auth");
    expect(preview).not.toContain("use-clients");
    expect(preview).not.toContain("use-cases");
    expect(preview).not.toContain("createClient");
    expect(preview).not.toContain("SUPABASE");

    // Solo debe usar datos locales ficticios
    expect(preview).toContain("DEMO_");
    expect(preview).toContain("Datos ficticios");
  });

  it("marca el preview como no indexable y solo para desarrollo", () => {
    const html = source("dev/crm-preview.html");
    expect(html).toContain("noindex,nofollow");
    expect(html).toContain("Preview CRM");
  });

  it("no aparece en el árbol de rutas productivas", () => {
    // El catálogo y preview son entradas independientes de Vite,
    // no forman parte del árbol de rutas de TanStack Router
    const catalogHTML = source("dev/ui-catalog.html");
    const previewHTML = source("dev/crm-preview.html");

    expect(catalogHTML).toContain("noindex,nofollow");
    expect(previewHTML).toContain("noindex,nofollow");
  });

  it("usa únicamente componentes compartidos del sistema visual global", () => {
    const preview = source("dev/crm-preview-main.tsx");
    // Los imports usan rutas relativas desde dev/ hacia src/
    expect(preview).toContain("../src/components/ui/button");
    expect(preview).toContain("../src/components/ui/input");
    expect(preview).toContain("../src/components/ui/native-select");
    expect(preview).toContain("../src/components/ui/textarea");
    expect(preview).toContain("../src/components/ui/dialog");
    expect(preview).toContain("../src/components/ui/card");
    expect(preview).toContain("../src/components/ui/badge");
    expect(preview).toContain("../src/components/ui/data-state");
    expect(preview).toContain("../src/components/ui/form-layout");
    expect(preview).toContain("../src/components/ui/table");
  });

  it("contiene datos ficticios para clientes, expedientes y tareas", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("Andrea Mendoza Ruiz");
    expect(preview).toContain("Carlos Ramírez Salazar");
    expect(preview).toContain("Consultoría Jurídica Modelo");
    expect(preview).toContain("00123-2026-0-1801-JP-FC-01");
    expect(preview).toContain("04782-2025-0-1801-JR-PE-02");
    expect(preview).toContain("Elaborar escrito de subsanación");
    expect(preview).toContain("example.test");
  });

  it("muestra todas las vistas principales del CRM", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("DashboardView");
    expect(preview).toContain("ClientsView");
    expect(preview).toContain("CasesView");
    expect(preview).toContain("TasksView");
    expect(preview).toContain("CalendarView");
    expect(preview).toContain("DocumentsView");
    expect(preview).toContain("ReportsView");
    expect(preview).toContain("PaymentsView");
    expect(preview).toContain("SettingsView");
  });

  it("incluye navegación desktop, móvil y menú lateral", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("Sidebar Desktop");
    expect(preview).toContain("Mobile Navigation");
    expect(preview).toContain("Mobile Menu");
    expect(preview).toContain("mobileMenuOpen");
  });

  it("usa formularios completos con validación visual", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("FormSection");
    expect(preview).toContain("FormField");
    expect(preview).toContain("FormActions");
    expect(preview).toContain("FormErrorSummary");
    expect(preview).toContain('label="Nombre completo"');
    expect(preview).toContain('label="Teléfono"');
    expect(preview).toContain('label="Correo"');
    expect(preview).toContain('label="Estado"');
    expect(preview).toContain('label="Observaciones"');
  });

  it("muestra estados vacíos, de carga y de error", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("EmptyState");
    expect(preview).toContain("LoadingState");
    expect(preview).toContain("ErrorState");
    expect(preview).toContain("Sin eventos programados");
    expect(preview).toContain("Sin documentos");
    expect(preview).toContain("No fue posible cargar el estado del sistema");
  });

  it("incluye métricas operativas en dashboard y vistas", () => {
    const preview = source("dev/crm-preview-main.tsx");
    expect(preview).toContain("MetricCard");
    expect(preview).toContain("Clientes activos");
    expect(preview).toContain("Expedientes");
    expect(preview).toContain("Tareas pendientes");
    expect(preview).toContain("Eventos próximos");
    expect(preview).toContain("Total pendiente");
    expect(preview).toContain("Total cobrado");
  });
});
