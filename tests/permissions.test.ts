/**
 * permissions.test.ts
 *
 * Pruebas automatizadas del sistema centralizado de permisos.
 * Verifica que Personal tenga todos los permisos de pagos en false
 * y que Administrador los tenga en true.
 *
 * Estas pruebas son 100% locales, no requieren Supabase ni credenciales.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeRole,
  isAdminRole,
  isPersonalRole,
  resolvePaymentPermissions,
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
