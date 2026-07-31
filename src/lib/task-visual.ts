/**
 * task-visual.ts
 *
 * Sistema central de estado visual de tareas.
 * Determina etiqueta, icono, clases de estilo y accesibilidad
 * con base en el estado y asignación de la tarea.
 *
 * NO modificar la lógica de negocio, RPC ni base de datos.
 * Solo frontend.
 */

import {
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  UserMinus,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { normalizeTaskStatus, type TaskStatus } from "@/lib/tasks";

// ─── Tipos de salida ────────────────────────────────────────────────────────

export type TaskVisualCategory = "completed" | "blocked" | "mine" | "other" | "available";

export interface TaskVisualState {
  /** Categoría semántica calculada */
  category: TaskVisualCategory;
  /** Etiqueta legible para el usuario */
  label: string;
  /** Icono Lucide */
  icon: LucideIcon;
  /**
   * Clases Tailwind para el fondo de la fila/tarjeta.
   * Diseñadas para usarse con `className={vs.rowBg}`.
   */
  rowBg: string;
  /**
   * Clase de borde lateral izquierdo (accent strip).
   * Usar con `className={vs.accentBorder}` en `border-l-2`.
   */
  accentBorder: string;
  /** Clases para el badge de estado */
  badgeClasses: string;
  /** Texto accesible (aria-label) */
  ariaDescription: string;
  /** Etiqueta del botón de acción principal */
  primaryActionLabel: string | null;
  /** Si la acción principal es tomar la tarea */
  canClaim: boolean;
}

// ─── Implementación ─────────────────────────────────────────────────────────

/**
 * Calcula el estado visual de una tarea en función de su estado
 * normalizado y si está asignada al usuario actual.
 *
 * Precedencia (del spec):
 * 1. Completada
 * 2. Bloqueada / error
 * 3. Asignada al usuario actual
 * 4. Asignada a otra persona
 * 5. Disponible (sin asignar + pending)
 *
 * @param task   Objeto con las propiedades mínimas necesarias
 * @param userId ID del usuario autenticado (puede ser null mientras carga)
 */
export function getTaskVisualState(
  task: {
    status: string;
    assigned_to: string | null;
  },
  userId: string | null | undefined,
): TaskVisualState {
  const status: TaskStatus = normalizeTaskStatus(task.status);
  const assignedToMe = !!userId && task.assigned_to === userId;
  const assignedToSomeone = task.assigned_to !== null;
  const isAvailable = !assignedToSomeone && status === "pending";

  // 1. Completada ─────────────────────────────────────────────────────────
  if (status === "completed") {
    return {
      category: "completed",
      label: "Completada",
      icon: CheckCircle2,
      rowBg: "bg-success/5 dark:bg-success/10 opacity-75 hover:opacity-100 transition-opacity",
      accentBorder: "border-l-success/50",
      badgeClasses: "bg-success/10 text-success-foreground border border-success/25",
      ariaDescription: "Tarea completada",
      primaryActionLabel: "Ver detalle",
      canClaim: false,
    };
  }

  // 2. Bloqueada ───────────────────────────────────────────────────────────
  if (status === "blocked") {
    return {
      category: "blocked",
      label: "Requiere atención",
      icon: AlertTriangle,
      rowBg: "bg-destructive/5 dark:bg-destructive/10 hover:bg-destructive/8",
      accentBorder: "border-l-destructive",
      badgeClasses: "bg-destructive/10 text-destructive border border-destructive/25",
      ariaDescription: "Tarea bloqueada, requiere atención",
      primaryActionLabel: "Ver detalle",
      canClaim: false,
    };
  }

  // 3. Asignada al usuario actual ──────────────────────────────────────────
  if (assignedToMe) {
    return {
      category: "mine",
      label: "Asignada a mí",
      icon: UserCheck,
      rowBg: "bg-[var(--task-mine)] hover:bg-[var(--task-mine)]/80",
      accentBorder: "border-l-[var(--task-mine-border)]",
      badgeClasses: "bg-primary/10 text-primary border border-[var(--task-mine-border)]",
      ariaDescription: "Esta tarea te fue asignada",
      primaryActionLabel: status === "in_progress" ? "Continuar" : "Ver detalle",
      canClaim: false,
    };
  }

  // 4. Asignada a otra persona ─────────────────────────────────────────────
  if (assignedToSomeone) {
    return {
      category: "other",
      label: "Asignada",
      icon: UserMinus,
      rowBg: "bg-[var(--task-other)] hover:bg-[var(--task-other)]/80",
      accentBorder: "border-l-[var(--task-other-foreground)]/30",
      badgeClasses: "bg-muted text-[var(--task-other-foreground)] border border-border",
      ariaDescription: "Tarea asignada a otro integrante del equipo",
      primaryActionLabel: "Ver detalle",
      canClaim: false,
    };
  }

  // 5. Disponible ──────────────────────────────────────────────────────────
  return {
    category: "available",
    label: "Disponible",
    icon: Circle,
    rowBg: "bg-card hover:bg-primary/3 transition-colors",
    accentBorder: "border-l-primary",
    badgeClasses: "bg-primary/10 text-primary border border-primary/20",
    ariaDescription: isAvailable
      ? "Tarea disponible, puedes tomarla"
      : "Tarea pendiente de asignación",
    primaryActionLabel: "Tomar tarea",
    canClaim: true,
  };
}
