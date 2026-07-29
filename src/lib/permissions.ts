/**
 * Sistema centralizado de permisos del CRM.
 *
 * Roles reales almacenados en public.profiles.role:
 *   'Administrador' | 'Personal'
 *
 * Regla de oro: nunca comparar strings de rol directamente en componentes.
 * Usar siempre los helpers y permisos de este módulo.
 */

import type { Database } from "@/lib/database.types";

export type UserRole = Database["public"]["Tables"]["profiles"]["Row"]["role"];

/** Normaliza un rol antes de comparar, por si llega con espacios o capitalización distinta. */
export function normalizeRole(role: string | null | undefined): UserRole {
  const trimmed = (role ?? "").trim();
  if (trimmed === "Administrador") return "Administrador";
  return "Personal";
}

/** Devuelve true sólo si el rol es exactamente 'Administrador'. */
export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === "Administrador";
}

/** Devuelve true para cualquier rol no-administrador (incluye ausencia de perfil). */
export function isPersonalRole(role: string | null | undefined): boolean {
  return !isAdminRole(role);
}

// ---------------------------------------------------------------------------
// Permisos de Pagos
// ---------------------------------------------------------------------------

export interface PaymentPermissions {
  canViewPayments: boolean;
  canCreatePayments: boolean;
  canEditPayments: boolean;
  canDeletePayments: boolean;
  canExportPayments: boolean;
  canViewFinancialMetrics: boolean;
}

/**
 * Resuelve todos los permisos de pagos para un rol dado.
 * Para Personal todos son false.
 * Para Administrador todos son true.
 */
export function resolvePaymentPermissions(role: string | null | undefined): PaymentPermissions {
  const admin = isAdminRole(role);
  return {
    canViewPayments: admin,
    canCreatePayments: admin,
    canEditPayments: admin,
    canDeletePayments: admin,
    canExportPayments: admin,
    canViewFinancialMetrics: admin,
  };
}

// ---------------------------------------------------------------------------
// Permisos de migración documental
// ---------------------------------------------------------------------------

export interface MigrationPermissions {
  /** Puede ver la herramienta de migración documental en Configuración. */
  canViewDocumentMigration: boolean;
  /** Puede ejecutar análisis dry-run de migración documental. */
  canRunDocumentMigrationDryRun: boolean;
  /** Puede ejecutar la migración real de documentos. */
  canRunDocumentMigration: boolean;
}

/**
 * Resuelve los permisos de la herramienta de migración documental.
 * Solo Administrador Activo puede acceder. Para Personal todos son false.
 */
export function resolveMigrationPermissions(
  role: string | null | undefined,
  status: string | null | undefined,
): MigrationPermissions {
  const admin = isAdminRole(role) && (status ?? "").trim() === "Activo";
  return {
    canViewDocumentMigration: admin,
    canRunDocumentMigrationDryRun: admin,
    canRunDocumentMigration: admin,
  };
}

// ---------------------------------------------------------------------------
// Hook-friendly helper
// ---------------------------------------------------------------------------

/**
 * Recibe el profile completo (o null mientras carga) y devuelve los permisos.
 * Útil para consumir directamente en componentes React.
 *
 * Uso:
 *   const { canViewPayments } = usePermissions(profile);
 */
export function usePermissions(
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null | undefined,
): PaymentPermissions & MigrationPermissions {
  return {
    ...resolvePaymentPermissions(profile?.role),
    ...resolveMigrationPermissions(profile?.role, profile?.status),
  };
}
