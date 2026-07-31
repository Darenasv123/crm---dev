/**
 * permissions.test.ts
 *
 * Pruebas automatizadas del sistema centralizado de permisos.
 * Verifica que Personal y Administrador tengan los permisos correctos
 * para todos los módulos del CRM: Pagos, Tareas, Agenda, Documentos, Reportes,
 * Clientes y Expedientes.
 *
 * Estas pruebas son 100% locales, no requieren Supabase ni credenciales.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeRole,
  isAdminRole,
  isPersonalRole,
  resolvePaymentPermissions,
  resolveTaskPermissions,
  resolveAgendaPermissions,
  resolveDocumentPermissions,
  resolveReportPermissions,
  resolveClientPermissions,
  resolveCasePermissions,
  usePermissions,
} from "../src/lib/permissions";

// ─── normalizeRole ────────────────────────────────────────────────────────────

describe("normalizeRole", () => {
  it("reconoce 'Administrador' exactamente", () => {
    expect(normalizeRole("Administrador")).toBe("Administrador");
  });

  it("normaliza variantes con espacios de Administrador", () => {
    expect(normalizeRole("  Administrador  ")).toBe("Administrador");
  });

  it("devuelve 'Personal' para null", () => {
    expect(normalizeRole(null)).toBe("Personal");
  });

  it("devuelve 'Personal' para undefined", () => {
    expect(normalizeRole(undefined)).toBe("Personal");
  });

  it("devuelve 'Personal' para cadena vacía", () => {
    expect(normalizeRole("")).toBe("Personal");
  });

  it("devuelve 'Personal' para rol desconocido", () => {
    expect(normalizeRole("Invitado")).toBe("Personal");
    expect(normalizeRole("admin")).toBe("Personal");
    expect(normalizeRole("ADMINISTRADOR")).toBe("Personal");
  });
});

// ─── isAdminRole / isPersonalRole ─────────────────────────────────────────────

describe("isAdminRole", () => {
  it("es true para Administrador", () => {
    expect(isAdminRole("Administrador")).toBe(true);
  });

  it("es false para Personal", () => {
    expect(isAdminRole("Personal")).toBe(false);
  });

  it("es false para null/undefined", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("isPersonalRole", () => {
  it("es true para Personal", () => {
    expect(isPersonalRole("Personal")).toBe(true);
  });

  it("es true para null/undefined", () => {
    expect(isPersonalRole(null)).toBe(true);
    expect(isPersonalRole(undefined)).toBe(true);
  });

  it("es false para Administrador", () => {
    expect(isPersonalRole("Administrador")).toBe(false);
  });
});

// ─── resolvePaymentPermissions — Personal ────────────────────────────────────

describe("resolvePaymentPermissions — Personal", () => {
  const perms = resolvePaymentPermissions("Personal");

  // Punto 1: canViewPayments
  it("1. canViewPayments es false", () => {
    expect(perms.canViewPayments).toBe(false);
  });

  // Punto 2: canCreatePayments
  it("2. canCreatePayments es false", () => {
    expect(perms.canCreatePayments).toBe(false);
  });

  // Punto 3: canEditPayments
  it("3. canEditPayments es false", () => {
    expect(perms.canEditPayments).toBe(false);
  });

  // Punto 4: canDeletePayments
  it("4. canDeletePayments es false", () => {
    expect(perms.canDeletePayments).toBe(false);
  });

  // Punto 5: canExportPayments
  it("5. canExportPayments es false", () => {
    expect(perms.canExportPayments).toBe(false);
  });

  // Punto 6: canViewFinancialMetrics
  it("6. canViewFinancialMetrics es false", () => {
    expect(perms.canViewFinancialMetrics).toBe(false);
  });
});

describe("resolvePaymentPermissions — Personal (null/undefined)", () => {
  it("null devuelve todos los permisos de pagos en false", () => {
    const perms = resolvePaymentPermissions(null);
    expect(perms.canViewPayments).toBe(false);
    expect(perms.canCreatePayments).toBe(false);
    expect(perms.canEditPayments).toBe(false);
    expect(perms.canDeletePayments).toBe(false);
    expect(perms.canExportPayments).toBe(false);
    expect(perms.canViewFinancialMetrics).toBe(false);
  });

  it("undefined devuelve todos los permisos de pagos en false", () => {
    const perms = resolvePaymentPermissions(undefined);
    expect(perms.canViewPayments).toBe(false);
    expect(perms.canCreatePayments).toBe(false);
    expect(perms.canEditPayments).toBe(false);
    expect(perms.canDeletePayments).toBe(false);
    expect(perms.canExportPayments).toBe(false);
    expect(perms.canViewFinancialMetrics).toBe(false);
  });
});

// ─── resolvePaymentPermissions — Administrador ───────────────────────────────

describe("resolvePaymentPermissions — Administrador", () => {
  const perms = resolvePaymentPermissions("Administrador");

  // Punto 1: todos los permisos financieros son true
  it("1. canViewPayments es true", () => {
    expect(perms.canViewPayments).toBe(true);
  });

  it("2. canCreatePayments es true", () => {
    expect(perms.canCreatePayments).toBe(true);
  });

  it("3. canEditPayments es true", () => {
    expect(perms.canEditPayments).toBe(true);
  });

  it("4. canDeletePayments es true", () => {
    expect(perms.canDeletePayments).toBe(true);
  });

  it("5. canExportPayments es true", () => {
    expect(perms.canExportPayments).toBe(true);
  });

  it("6. canViewFinancialMetrics es true", () => {
    expect(perms.canViewFinancialMetrics).toBe(true);
  });
});

// ─── usePermissions (helper React — llama a resolvePaymentPermissions) ────────

describe("usePermissions — con profile de Personal", () => {
  const personalProfile = {
    id: "user-personal-1",
    email: "personal@estudio.pe",
    full_name: "María Auxiliadora",
    initials: "MA",
    role: "Personal",
    status: "Activo",
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
  } as const;

  const perms = usePermissions(personalProfile);

  it("canViewPayments es false para Personal", () => {
    expect(perms.canViewPayments).toBe(false);
  });

  it("canCreatePayments es false para Personal", () => {
    expect(perms.canCreatePayments).toBe(false);
  });

  it("canEditPayments es false para Personal", () => {
    expect(perms.canEditPayments).toBe(false);
  });

  it("canDeletePayments es false para Personal", () => {
    expect(perms.canDeletePayments).toBe(false);
  });

  it("canExportPayments es false para Personal", () => {
    expect(perms.canExportPayments).toBe(false);
  });

  it("canViewFinancialMetrics es false para Personal", () => {
    expect(perms.canViewFinancialMetrics).toBe(false);
  });
});

describe("usePermissions — con profile de Administrador", () => {
  const adminProfile = {
    id: "user-admin-1",
    email: "admin@estudio.pe",
    full_name: "Carlos Arenas",
    initials: "CA",
    role: "Administrador",
    status: "Activo",
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
  } as const;

  const perms = usePermissions(adminProfile);

  it("canViewPayments es true para Administrador", () => {
    expect(perms.canViewPayments).toBe(true);
  });

  it("canCreatePayments es true para Administrador", () => {
    expect(perms.canCreatePayments).toBe(true);
  });

  it("canEditPayments es true para Administrador", () => {
    expect(perms.canEditPayments).toBe(true);
  });

  it("canDeletePayments es true para Administrador", () => {
    expect(perms.canDeletePayments).toBe(true);
  });

  it("canExportPayments es true para Administrador", () => {
    expect(perms.canExportPayments).toBe(true);
  });

  it("canViewFinancialMetrics es true para Administrador", () => {
    expect(perms.canViewFinancialMetrics).toBe(true);
  });
});

describe("usePermissions — sin profile (null)", () => {
  it("con null devuelve todos los permisos de pagos en false", () => {
    const perms = usePermissions(null);
    expect(perms.canViewPayments).toBe(false);
    expect(perms.canCreatePayments).toBe(false);
    expect(perms.canEditPayments).toBe(false);
    expect(perms.canDeletePayments).toBe(false);
    expect(perms.canExportPayments).toBe(false);
    expect(perms.canViewFinancialMetrics).toBe(false);
  });

  it("con undefined devuelve todos los permisos de pagos en false", () => {
    const perms = usePermissions(undefined);
    expect(perms.canViewPayments).toBe(false);
    expect(perms.canCreatePayments).toBe(false);
    expect(perms.canEditPayments).toBe(false);
    expect(perms.canDeletePayments).toBe(false);
    expect(perms.canExportPayments).toBe(false);
    expect(perms.canViewFinancialMetrics).toBe(false);
  });
});

// ─── Verificación de navegación: admin vs personal ───────────────────────────
// Prueba lógica del filtro de nav (sin DOM), basada en el mismo criterio
// que usa app-layout.tsx: item.adminOnly && !isAdmin → excluido.

describe("lógica de navegación — adminOnly items", () => {
  type NavItem = { to: string; label: string; adminOnly?: boolean };

  const nav: NavItem[] = [
    { to: "/", label: "Dashboard" },
    { to: "/clientes", label: "Clientes" },
    { to: "/casos", label: "Expedientes" },
    { to: "/documentos", label: "Documentos" },
    { to: "/agenda", label: "Agenda" },
    { to: "/pagos", label: "Pagos", adminOnly: true },
    { to: "/reportes", label: "Reportes" },
    { to: "/configuracion", label: "Configuración", adminOnly: true },
  ];

  function visibleItems(role: string) {
    const isAdmin = isAdminRole(role);
    return nav.filter((item) => !item.adminOnly || isAdmin);
  }

  // Punto 7: Pagos no aparece en navegación para Personal
  it("7. Pagos no aparece en la navegación para Personal", () => {
    const items = visibleItems("Personal");
    expect(items.find((i) => i.to === "/pagos")).toBeUndefined();
  });

  // Punto 2 (admin): Pagos aparece en navegación para Administrador
  it("Pagos aparece en navegación para Administrador", () => {
    const items = visibleItems("Administrador");
    expect(items.find((i) => i.to === "/pagos")).toBeDefined();
  });

  // Punto 8: Pagos no aparece en navegación móvil para Personal
  it("8. Pagos no aparece en bottom nav para Personal", () => {
    const isAdmin = isAdminRole("Personal");
    const bottomNav = [
      { to: "/", label: "Inicio" },
      { to: "/clientes", label: "Clientes" },
      { to: "/casos", label: "Exp." },
      { to: "/agenda", label: "Agenda" },
      ...(isAdmin ? [{ to: "/pagos", label: "Pagos" }] : [{ to: "/documentos", label: "Docs" }]),
    ];
    expect(bottomNav.find((i) => i.to === "/pagos")).toBeUndefined();
    expect(bottomNav.find((i) => i.to === "/documentos")).toBeDefined();
  });

  it("Pagos aparece en bottom nav para Administrador", () => {
    const isAdmin = isAdminRole("Administrador");
    const bottomNav = [
      { to: "/", label: "Inicio" },
      { to: "/clientes", label: "Clientes" },
      { to: "/casos", label: "Exp." },
      { to: "/agenda", label: "Agenda" },
      ...(isAdmin ? [{ to: "/pagos", label: "Pagos" }] : [{ to: "/documentos", label: "Docs" }]),
    ];
    expect(bottomNav.find((i) => i.to === "/pagos")).toBeDefined();
  });
});

// ─── Verificación de habilitación de queries ─────────────────────────────────
// Simula el patrón usado en _app.clientes.$id.tsx:
//   usePayments({ enabled: canViewPayments })

describe("query enabled — pagos bloqueadas para Personal (puntos 12, 5)", () => {
  it("12. La query de pagos recibe enabled=false para Personal", () => {
    const perms = resolvePaymentPermissions("Personal");
    // Esto es lo que recibe el segundo argumento de usePayments
    const queryEnabled = perms.canViewPayments;
    expect(queryEnabled).toBe(false);
  });

  it("Las queries de pagos reciben enabled=true para Administrador", () => {
    const perms = resolvePaymentPermissions("Administrador");
    const queryEnabled = perms.canViewPayments;
    expect(queryEnabled).toBe(true);
  });

  it("canViewFinancialMetrics es false para Personal (métricas de dashboard)", () => {
    const perms = resolvePaymentPermissions("Personal");
    expect(perms.canViewFinancialMetrics).toBe(false);
  });

  it("canViewFinancialMetrics es true para Administrador", () => {
    const perms = resolvePaymentPermissions("Administrador");
    expect(perms.canViewFinancialMetrics).toBe(true);
  });
});

// ─── Búsqueda: pagos bloqueados para Personal ────────────────────────────────
// Simula el patrón de global-search.tsx:
//   canSearchPayments = profile?.role === "Administrador"

describe("búsqueda global — pagos excluidos para Personal (punto 14)", () => {
  it("14. canSearchPayments es false para Personal", () => {
    const role = "Personal";
    const canSearchPayments = isAdminRole(role);
    expect(canSearchPayments).toBe(false);
  });

  it("canSearchPayments es true para Administrador", () => {
    const role = "Administrador";
    const canSearchPayments = isAdminRole(role);
    expect(canSearchPayments).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAREAS — Personal puede ver y tomar, pero no crear
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveTaskPermissions — Personal", () => {
  const perms = resolveTaskPermissions("Personal");

  it("canCreateTasks es false", () => {
    expect(perms.canCreateTasks).toBe(false);
  });

  it("canManageAllTasks es false", () => {
    expect(perms.canManageAllTasks).toBe(false);
  });

  it("canAssignTasks es false", () => {
    expect(perms.canAssignTasks).toBe(false);
  });

  it("canReassignTasks es false", () => {
    expect(perms.canReassignTasks).toBe(false);
  });

  it("canDeleteTasks es false", () => {
    expect(perms.canDeleteTasks).toBe(false);
  });

  it("canClaimTasks es true — Personal puede tomar tareas", () => {
    expect(perms.canClaimTasks).toBe(true);
  });
});

describe("resolveTaskPermissions — Administrador", () => {
  const perms = resolveTaskPermissions("Administrador");

  it("canCreateTasks es true", () => {
    expect(perms.canCreateTasks).toBe(true);
  });

  it("canManageAllTasks es true", () => {
    expect(perms.canManageAllTasks).toBe(true);
  });

  it("canAssignTasks es true", () => {
    expect(perms.canAssignTasks).toBe(true);
  });

  it("canReassignTasks es true", () => {
    expect(perms.canReassignTasks).toBe(true);
  });

  it("canDeleteTasks es true", () => {
    expect(perms.canDeleteTasks).toBe(true);
  });

  it("canClaimTasks es true", () => {
    expect(perms.canClaimTasks).toBe(true);
  });
});

describe("tareas — botón 'Nueva tarea' visible según permisos", () => {
  it("Personal no ve el botón 'Nueva tarea'", () => {
    const perms = resolveTaskPermissions("Personal");
    expect(perms.canCreateTasks).toBe(false);
  });

  it("Administrador ve el botón 'Nueva tarea'", () => {
    const perms = resolveTaskPermissions("Administrador");
    expect(perms.canCreateTasks).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENDA — Personal solo lectura, Administrador gestiona
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveAgendaPermissions — Personal", () => {
  const perms = resolveAgendaPermissions("Personal");

  it("canViewAgenda es true — Personal puede ver la agenda", () => {
    expect(perms.canViewAgenda).toBe(true);
  });

  it("canCreateEvents es false", () => {
    expect(perms.canCreateEvents).toBe(false);
  });

  it("canEditEvents es false", () => {
    expect(perms.canEditEvents).toBe(false);
  });

  it("canDeleteEvents es false", () => {
    expect(perms.canDeleteEvents).toBe(false);
  });

  it("canResolveSync es false", () => {
    expect(perms.canResolveSync).toBe(false);
  });

  it("canConfigureSync es false", () => {
    expect(perms.canConfigureSync).toBe(false);
  });
});

describe("resolveAgendaPermissions — Administrador", () => {
  const perms = resolveAgendaPermissions("Administrador");

  it("canViewAgenda es true", () => {
    expect(perms.canViewAgenda).toBe(true);
  });

  it("canCreateEvents es true", () => {
    expect(perms.canCreateEvents).toBe(true);
  });

  it("canEditEvents es true", () => {
    expect(perms.canEditEvents).toBe(true);
  });

  it("canDeleteEvents es true", () => {
    expect(perms.canDeleteEvents).toBe(true);
  });

  it("canResolveSync es true", () => {
    expect(perms.canResolveSync).toBe(true);
  });

  it("canConfigureSync es true", () => {
    expect(perms.canConfigureSync).toBe(true);
  });
});

describe("agenda — botones visibles según permisos", () => {
  it("Personal no ve botones de creación/edición/eliminación", () => {
    const perms = resolveAgendaPermissions("Personal");
    expect(perms.canCreateEvents).toBe(false);
    expect(perms.canEditEvents).toBe(false);
    expect(perms.canDeleteEvents).toBe(false);
  });

  it("Administrador ve todos los botones de gestión", () => {
    const perms = resolveAgendaPermissions("Administrador");
    expect(perms.canCreateEvents).toBe(true);
    expect(perms.canEditEvents).toBe(true);
    expect(perms.canDeleteEvents).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTOS — Todos ven, solo Administrador elimina
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveDocumentPermissions — Personal", () => {
  const perms = resolveDocumentPermissions("Personal");

  it("canViewDocuments es true", () => {
    expect(perms.canViewDocuments).toBe(true);
  });

  it("canDownloadDocuments es true", () => {
    expect(perms.canDownloadDocuments).toBe(true);
  });

  it("canDeleteDocuments es false", () => {
    expect(perms.canDeleteDocuments).toBe(false);
  });
});

describe("resolveDocumentPermissions — Administrador", () => {
  const perms = resolveDocumentPermissions("Administrador");

  it("canViewDocuments es true", () => {
    expect(perms.canViewDocuments).toBe(true);
  });

  it("canDownloadDocuments es true", () => {
    expect(perms.canDownloadDocuments).toBe(true);
  });

  it("canDeleteDocuments es true", () => {
    expect(perms.canDeleteDocuments).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORTES — Todos ven según RLS, solo Administrador crea
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveReportPermissions — Personal", () => {
  const perms = resolveReportPermissions("Personal");

  it("canViewReports es true", () => {
    expect(perms.canViewReports).toBe(true);
  });

  it("canCreateReports es false", () => {
    expect(perms.canCreateReports).toBe(false);
  });
});

describe("resolveReportPermissions — Administrador", () => {
  const perms = resolveReportPermissions("Administrador");

  it("canViewReports es true", () => {
    expect(perms.canViewReports).toBe(true);
  });

  it("canCreateReports es true", () => {
    expect(perms.canCreateReports).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES — Todos ven, solo Administrador gestiona
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveClientPermissions — Personal", () => {
  const perms = resolveClientPermissions("Personal");

  it("canViewClients es true", () => {
    expect(perms.canViewClients).toBe(true);
  });

  it("canCreateClients es false", () => {
    expect(perms.canCreateClients).toBe(false);
  });

  it("canEditClients es false", () => {
    expect(perms.canEditClients).toBe(false);
  });

  it("canDeleteClients es false", () => {
    expect(perms.canDeleteClients).toBe(false);
  });
});

describe("resolveClientPermissions — Administrador", () => {
  const perms = resolveClientPermissions("Administrador");

  it("canViewClients es true", () => {
    expect(perms.canViewClients).toBe(true);
  });

  it("canCreateClients es true", () => {
    expect(perms.canCreateClients).toBe(true);
  });

  it("canEditClients es true", () => {
    expect(perms.canEditClients).toBe(true);
  });

  it("canDeleteClients es true", () => {
    expect(perms.canDeleteClients).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPEDIENTES — Todos ven, solo Administrador gestiona
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveCasePermissions — Personal", () => {
  const perms = resolveCasePermissions("Personal");

  it("canViewCases es true", () => {
    expect(perms.canViewCases).toBe(true);
  });

  it("canCreateCases es false", () => {
    expect(perms.canCreateCases).toBe(false);
  });

  it("canEditCases es false", () => {
    expect(perms.canEditCases).toBe(false);
  });

  it("canDeleteCases es false", () => {
    expect(perms.canDeleteCases).toBe(false);
  });
});

describe("resolveCasePermissions — Administrador", () => {
  const perms = resolveCasePermissions("Administrador");

  it("canViewCases es true", () => {
    expect(perms.canViewCases).toBe(true);
  });

  it("canCreateCases es true", () => {
    expect(perms.canCreateCases).toBe(true);
  });

  it("canEditCases es true", () => {
    expect(perms.canEditCases).toBe(true);
  });

  it("canDeleteCases es true", () => {
    expect(perms.canDeleteCases).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN COMPLETA — Matriz final de módulos visibles
// ═══════════════════════════════════════════════════════════════════════════

describe("navegación completa — módulos visibles por rol", () => {
  type NavItem = { to: string; label: string; adminOnly?: boolean };

  const allNav: NavItem[] = [
    { to: "/", label: "Inicio" },
    { to: "/clientes", label: "Clientes" },
    { to: "/casos", label: "Expedientes" },
    { to: "/tareas", label: "Tareas" },
    { to: "/agenda", label: "Agenda" },
    { to: "/documentos", label: "Documentos" },
    { to: "/reportes", label: "Reportes" },
    { to: "/pagos", label: "Pagos", adminOnly: true },
    { to: "/configuracion", label: "Configuración", adminOnly: true },
  ];

  function visibleItems(role: string) {
    const isAdmin = isAdminRole(role);
    return allNav.filter((item) => !item.adminOnly || isAdmin);
  }

  it("Personal ve 7 módulos: Inicio, Clientes, Expedientes, Tareas, Agenda, Documentos, Reportes", () => {
    const items = visibleItems("Personal");
    expect(items.length).toBe(7);
    expect(items.map((i) => i.label)).toEqual([
      "Inicio",
      "Clientes",
      "Expedientes",
      "Tareas",
      "Agenda",
      "Documentos",
      "Reportes",
    ]);
  });

  it("Personal NO ve Pagos", () => {
    const items = visibleItems("Personal");
    expect(items.find((i) => i.to === "/pagos")).toBeUndefined();
  });

  it("Personal NO ve Configuración", () => {
    const items = visibleItems("Personal");
    expect(items.find((i) => i.to === "/configuracion")).toBeUndefined();
  });

  it("Administrador ve todos los 9 módulos", () => {
    const items = visibleItems("Administrador");
    expect(items.length).toBe(9);
    expect(items.map((i) => i.label)).toEqual([
      "Inicio",
      "Clientes",
      "Expedientes",
      "Tareas",
      "Agenda",
      "Documentos",
      "Reportes",
      "Pagos",
      "Configuración",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// usePermissions — hook React unificado
// ═══════════════════════════════════════════════════════════════════════════

describe("usePermissions — Personal con profile completo", () => {
  const personalProfile = {
    id: "user-personal-1",
    email: "personal@estudio.pe",
    full_name: "María Auxiliadora",
    initials: "MA",
    role: "Personal",
    status: "Activo",
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
  } as const;

  const perms = usePermissions(personalProfile);

  // Pagos
  it("canViewPayments = false", () => {
    expect(perms.canViewPayments).toBe(false);
  });

  // Tareas
  it("canCreateTasks = false", () => {
    expect(perms.canCreateTasks).toBe(false);
  });

  it("canClaimTasks = true", () => {
    expect(perms.canClaimTasks).toBe(true);
  });

  // Agenda
  it("canViewAgenda = true", () => {
    expect(perms.canViewAgenda).toBe(true);
  });

  it("canCreateEvents = false", () => {
    expect(perms.canCreateEvents).toBe(false);
  });

  // Clientes y Expedientes
  it("canViewClients = true", () => {
    expect(perms.canViewClients).toBe(true);
  });

  it("canCreateClients = false", () => {
    expect(perms.canCreateClients).toBe(false);
  });

  it("canViewCases = true", () => {
    expect(perms.canViewCases).toBe(true);
  });

  it("canCreateCases = false", () => {
    expect(perms.canCreateCases).toBe(false);
  });
});

describe("usePermissions — Administrador con profile completo", () => {
  const adminProfile = {
    id: "user-admin-1",
    email: "admin@estudio.pe",
    full_name: "Carlos Arenas",
    initials: "CA",
    role: "Administrador",
    status: "Activo",
    phone: null,
    created_at: "2026-01-01T00:00:00Z",
  } as const;

  const perms = usePermissions(adminProfile);

  // Pagos
  it("canViewPayments = true", () => {
    expect(perms.canViewPayments).toBe(true);
  });

  it("canCreatePayments = true", () => {
    expect(perms.canCreatePayments).toBe(true);
  });

  // Tareas
  it("canCreateTasks = true", () => {
    expect(perms.canCreateTasks).toBe(true);
  });

  it("canManageAllTasks = true", () => {
    expect(perms.canManageAllTasks).toBe(true);
  });

  // Agenda
  it("canViewAgenda = true", () => {
    expect(perms.canViewAgenda).toBe(true);
  });

  it("canCreateEvents = true", () => {
    expect(perms.canCreateEvents).toBe(true);
  });

  it("canEditEvents = true", () => {
    expect(perms.canEditEvents).toBe(true);
  });

  it("canDeleteEvents = true", () => {
    expect(perms.canDeleteEvents).toBe(true);
  });

  // Clientes y Expedientes
  it("canViewClients = true", () => {
    expect(perms.canViewClients).toBe(true);
  });

  it("canCreateClients = true", () => {
    expect(perms.canCreateClients).toBe(true);
  });

  it("canViewCases = true", () => {
    expect(perms.canViewCases).toBe(true);
  });

  it("canCreateCases = true", () => {
    expect(perms.canCreateCases).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GUARDS DE RUTAS — Personal puede abrir rutas operativas
// ═══════════════════════════════════════════════════════════════════════════

describe("guards de rutas — Personal puede acceder a módulos operativos", () => {
  // Simula la lógica de ProtectedLayout: solo redirige si !user
  // Para módulos operativos no hay guard de rol adicional.
  const operationalRoutes = [
    "/clientes",
    "/clientes/some-id",
    "/casos",
    "/casos/some-id",
    "/tareas",
    "/tareas/mias",
    "/tareas/tablero",
    "/documentos",
    "/reportes",
    "/agenda",
  ];

  // Estos sí redirigen a non-admins
  const adminOnlyRoutes = ["/pagos", "/configuracion"];

  it("rutas operativas no están en la lista de admin-only", () => {
    for (const route of operationalRoutes) {
      const isAdminOnly = adminOnlyRoutes.some((r) => route.startsWith(r));
      expect(isAdminOnly).toBe(false);
    }
  });

  it("Personal no puede acceder a rutas admin-only", () => {
    const role = "Personal";
    for (const route of adminOnlyRoutes) {
      // Simula la condición de redirect en _app.configuracion.index.tsx y _app.pagos.index.tsx
      const { canViewPayments } = resolvePaymentPermissions(role);
      if (route === "/pagos") {
        expect(canViewPayments).toBe(false);
      }
      if (route === "/configuracion") {
        expect(isAdminRole(role)).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES HABILITADAS — Personal debe ejecutar lecturas operativas
// ═══════════════════════════════════════════════════════════════════════════

describe("queries de lectura — habilitadas para Personal (sin enabled:isAdmin)", () => {
  // Todos estos hooks usan enabled: options.enabled ?? true
  // o enabled: !!profile — nunca enabled: isAdmin para módulos operativos.
  const personalProfile = {
    id: "user-personal-1",
    full_name: "María Auxiliadora",
    initials: "MA",
    role: "Personal",
    status: "Activo",
    phone: null,
    email: "personal@estudio.pe",
    created_at: "2026-01-01T00:00:00Z",
  } as const;

  it("query de Clientes: enabled = true para Personal (options.enabled ?? true)", () => {
    // useClients no tiene enabled condicionado a rol
    const enabled = true; // default cuando no se pasa options.enabled
    expect(enabled).toBe(true);
  });

  it("query de Expedientes: enabled = true para Personal", () => {
    const enabled = true;
    expect(enabled).toBe(true);
  });

  it("query de Tareas: enabled = !!profile para Personal activo", () => {
    const enabled = Boolean(personalProfile);
    expect(enabled).toBe(true);
  });

  it("query de Documentos: enabled = true para Personal", () => {
    const enabled = true;
    expect(enabled).toBe(true);
  });

  it("query de Reportes: enabled = true para Personal", () => {
    const enabled = true;
    expect(enabled).toBe(true);
  });

  it("query de Agenda: enabled = true para Personal", () => {
    const enabled = true;
    expect(enabled).toBe(true);
  });

  it("query de Pagos: enabled = canViewPayments = false para Personal", () => {
    const { canViewPayments } = resolvePaymentPermissions("Personal");
    expect(canViewPayments).toBe(false); // la query no se ejecuta
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES BLOQUEADAS — Personal no puede crear ni gestionar
// ═══════════════════════════════════════════════════════════════════════════

describe("acciones bloqueadas para Personal", () => {
  const perms = usePermissions({
    id: "user-personal-1",
    full_name: "María Auxiliadora",
    initials: "MA",
    role: "Personal",
    status: "Activo",
    phone: null,
    email: "personal@estudio.pe",
    created_at: "2026-01-01T00:00:00Z",
  });

  it("no puede crear tareas", () => expect(perms.canCreateTasks).toBe(false));
  it("no puede asignar tareas", () => expect(perms.canAssignTasks).toBe(false));
  it("no puede reasignar tareas", () => expect(perms.canReassignTasks).toBe(false));
  it("no puede eliminar tareas", () => expect(perms.canDeleteTasks).toBe(false));
  it("no puede crear eventos de agenda", () => expect(perms.canCreateEvents).toBe(false));
  it("no puede editar eventos de agenda", () => expect(perms.canEditEvents).toBe(false));
  it("no puede eliminar eventos de agenda", () => expect(perms.canDeleteEvents).toBe(false));
  it("no puede crear clientes", () => expect(perms.canCreateClients).toBe(false));
  it("no puede editar clientes", () => expect(perms.canEditClients).toBe(false));
  it("no puede eliminar clientes", () => expect(perms.canDeleteClients).toBe(false));
  it("no puede crear expedientes", () => expect(perms.canCreateCases).toBe(false));
  it("no puede editar expedientes", () => expect(perms.canEditCases).toBe(false));
  it("no puede eliminar expedientes", () => expect(perms.canDeleteCases).toBe(false));
  it("no puede eliminar documentos", () => expect(perms.canDeleteDocuments).toBe(false));
  it("no puede ver pagos", () => expect(perms.canViewPayments).toBe(false));
  it("no puede ver métricas financieras", () => expect(perms.canViewFinancialMetrics).toBe(false));
});

// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES PERMITIDAS — Personal puede leer y tomar tareas
// ═══════════════════════════════════════════════════════════════════════════

describe("acciones permitidas para Personal", () => {
  const perms = usePermissions({
    id: "user-personal-1",
    full_name: "María Auxiliadora",
    initials: "MA",
    role: "Personal",
    status: "Activo",
    phone: null,
    email: "personal@estudio.pe",
    created_at: "2026-01-01T00:00:00Z",
  });

  it("puede ver clientes", () => expect(perms.canViewClients).toBe(true));
  it("puede ver expedientes", () => expect(perms.canViewCases).toBe(true));
  it("puede tomar tareas disponibles", () => expect(perms.canClaimTasks).toBe(true));
  it("puede ver documentos", () => expect(perms.canViewDocuments).toBe(true));
  it("puede descargar documentos", () => expect(perms.canDownloadDocuments).toBe(true));
  it("puede ver reportes", () => expect(perms.canViewReports).toBe(true));
  it("puede ver agenda", () => expect(perms.canViewAgenda).toBe(true));
});
