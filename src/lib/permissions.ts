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
// Permisos de Tareas
// ---------------------------------------------------------------------------

export interface TaskPermissions {
  /** Puede ver el botón "Nueva tarea" y crear tareas. */
  canCreateTasks: boolean;
  /** Puede ver todas las tareas, filtros administrativos y el tablero. */
  canManageAllTasks: boolean;
  /** Puede asignar tareas a otros usuarios. */
  canAssignTasks: boolean;
  /** Puede reasignar tareas. */
  canReassignTasks: boolean;
  /** Puede eliminar tareas. */
  canDeleteTasks: boolean;
  /** Puede ver Tareas disponibles y tomar una. */
  canClaimTasks: boolean;
}

export function resolveTaskPermissions(role: string | null | undefined): TaskPermissions {
  const admin = isAdminRole(role);
  return {
    canCreateTasks: admin,
    canManageAllTasks: admin,
    canAssignTasks: admin,
    canReassignTasks: admin,
    canDeleteTasks: admin,
    canClaimTasks: true, // Personal también puede tomar tareas disponibles
  };
}

// ---------------------------------------------------------------------------
// Permisos de Agenda
// ---------------------------------------------------------------------------

export interface AgendaPermissions {
  /** Puede ver el botón "Nuevo evento" y crear eventos. */
  canCreateEvents: boolean;
  /** Puede editar eventos. */
  canEditEvents: boolean;
  /** Puede eliminar eventos. */
  canDeleteEvents: boolean;
  /** Puede resolver conflictos de sincronización. */
  canResolveSync: boolean;
  /** Puede configurar Google Calendar. */
  canConfigureSync: boolean;
  /** Puede ver la agenda y eventos (siempre true). */
  canViewAgenda: boolean;
}

export function resolveAgendaPermissions(role: string | null | undefined): AgendaPermissions {
  const admin = isAdminRole(role);
  return {
    canCreateEvents: admin,
    canEditEvents: admin,
    canDeleteEvents: admin,
    canResolveSync: admin,
    canConfigureSync: admin,
    canViewAgenda: true, // Todos pueden ver agenda
  };
}

// ---------------------------------------------------------------------------
// Permisos de Documentos
// ---------------------------------------------------------------------------

export interface DocumentPermissions {
  /** Puede ver documentos. Administrador y Personal tienen acceso igual. */
  canViewDocuments: boolean;
  /** Puede descargar documentos. Administrador y Personal tienen acceso igual. */
  canDownloadDocuments: boolean;
  /** Puede subir documentos. Administrador y Personal tienen acceso igual. */
  canUploadDocuments: boolean;
  /** Puede organizar carpetas. Administrador y Personal tienen acceso igual. */
  canManageFolders: boolean;
  /** Puede eliminar documentos (solo Administrador). */
  canDeleteDocuments: boolean;
}

export function resolveDocumentPermissions(role: string | null | undefined): DocumentPermissions {
  const admin = isAdminRole(role);
  return {
    // Administrador y Personal comparten el mismo acceso operativo a documentos.
    canViewDocuments: true,
    canDownloadDocuments: true,
    canUploadDocuments: true,
    canManageFolders: true,
    // Solo Administrador puede eliminar documentos.
    canDeleteDocuments: admin,
  };
}

// ---------------------------------------------------------------------------
// Permisos de Plantillas (Configuración → Plantillas)
// ---------------------------------------------------------------------------

export interface TemplatePermissions {
  /** Puede ver la biblioteca de plantillas. Administrador y Personal tienen acceso igual. */
  canViewTemplates: boolean;
  /** Puede descargar plantillas. Administrador y Personal tienen acceso igual. */
  canDownloadTemplates: boolean;
  /** Puede crear/subir plantillas (solo Administrador: no hay razón de negocio para Personal). */
  canCreateTemplates: boolean;
  /** Puede eliminar plantillas (solo Administrador). */
  canDeleteTemplates: boolean;
}

export function resolveTemplatePermissions(role: string | null | undefined): TemplatePermissions {
  const admin = isAdminRole(role);
  return {
    canViewTemplates: true,
    canDownloadTemplates: true,
    canCreateTemplates: admin,
    canDeleteTemplates: admin,
  };
}

// ---------------------------------------------------------------------------
// Permisos de Reportes
// ---------------------------------------------------------------------------

export interface ReportPermissions {
  /** Puede ver reportes según RLS. */
  canViewReports: boolean;
  /** Puede crear reportes. Administrador y Personal tienen acceso igual. */
  canCreateReports: boolean;
  /** Puede editar reportes. Administrador y Personal tienen acceso igual. */
  canEditReports: boolean;
}

export function resolveReportPermissions(role: string | null | undefined): ReportPermissions {
  // Administrador y Personal tienen el mismo acceso operativo a reportes.
  return {
    canViewReports: true,
    canCreateReports: true,
    canEditReports: true,
  };
}

// ---------------------------------------------------------------------------
// Permisos de Clientes
// ---------------------------------------------------------------------------

export interface ClientPermissions {
  /** Puede ver clientes. */
  canViewClients: boolean;
  /** Puede crear clientes. Administrador y Personal tienen acceso igual. */
  canCreateClients: boolean;
  /** Puede editar clientes. Administrador y Personal tienen acceso igual. */
  canEditClients: boolean;
  /** Puede eliminar clientes (solo Administrador). */
  canDeleteClients: boolean;
}

export function resolveClientPermissions(role: string | null | undefined): ClientPermissions {
  const admin = isAdminRole(role);
  return {
    canViewClients: true,
    // Administrador y Personal gestionan clientes por igual (crear y editar).
    canCreateClients: true,
    canEditClients: true,
    // Solo Administrador puede eliminar registros.
    canDeleteClients: admin,
  };
}

// ---------------------------------------------------------------------------
// Permisos de Expedientes
// ---------------------------------------------------------------------------

export interface CasePermissions {
  /** Puede ver expedientes. */
  canViewCases: boolean;
  /** Puede crear expedientes. Administrador y Personal tienen acceso igual. */
  canCreateCases: boolean;
  /** Puede editar expedientes. Administrador y Personal tienen acceso igual. */
  canEditCases: boolean;
  /** Puede eliminar expedientes (solo Administrador). */
  canDeleteCases: boolean;
}

export function resolveCasePermissions(role: string | null | undefined): CasePermissions {
  const admin = isAdminRole(role);
  return {
    canViewCases: true,
    // Administrador y Personal gestionan expedientes por igual (crear y editar).
    canCreateCases: true,
    canEditCases: true,
    // Solo Administrador puede eliminar registros.
    canDeleteCases: admin,
  };
}

// ---------------------------------------------------------------------------
// Permisos de Usuarios (Configuración → Usuarios y roles)
// ---------------------------------------------------------------------------

export interface UserPermissions {
  /** Puede gestionar personal: listar, crear, editar rol/estado (solo Administrador). */
  canManageUsers: boolean;
}

export function resolveUserPermissions(role: string | null | undefined): UserPermissions {
  return {
    // Solo Administrador gestiona usuarios. La página /configuracion ya
    // gatea el acceso completo por rol; este resolver es la fuente
    // centralizada equivalente para cualquier componente que necesite
    // consultarlo sin comparar role === "Administrador" directamente.
    // La garantía final es la RLS de public.profiles (policy
    // profiles_update_admin, is_admin() en using y with check) y el
    // trigger prevent_last_admin_removal — no este resolver.
    canManageUsers: isAdminRole(role),
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
 *   const permissions = usePermissions(profile);
 *   const { canCreateTasks, canViewAgenda } = permissions;
 */
export function usePermissions(
  profile: Database["public"]["Tables"]["profiles"]["Row"] | null | undefined,
): PaymentPermissions &
  MigrationPermissions &
  TaskPermissions &
  AgendaPermissions &
  DocumentPermissions &
  TemplatePermissions &
  ReportPermissions &
  ClientPermissions &
  CasePermissions &
  UserPermissions {
  return {
    ...resolvePaymentPermissions(profile?.role),
    ...resolveMigrationPermissions(profile?.role, profile?.status),
    ...resolveTaskPermissions(profile?.role),
    ...resolveAgendaPermissions(profile?.role),
    ...resolveDocumentPermissions(profile?.role),
    ...resolveTemplatePermissions(profile?.role),
    ...resolveReportPermissions(profile?.role),
    ...resolveClientPermissions(profile?.role),
    ...resolveCasePermissions(profile?.role),
    ...resolveUserPermissions(profile?.role),
  };
}
