/**
 * TaskPriorityBadge
 *
 * Componente compartido para mostrar la prioridad de una tarea.
 * Usa tokens semánticos definidos en styles.css.
 *
 * Prioridades: Baja (gris), Normal (azul), Alta (ámbar), Urgente (rojo).
 * No colorea la fila completa — solo el badge.
 */

import { cn } from "@/lib/utils";
import { normalizeTaskPriority } from "@/lib/tasks";
import { ChevronDown, Minus, ChevronUp, ChevronsUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Priority = "Baja" | "Normal" | "Alta" | "Urgente";

interface PriorityConfig {
  classes: string;
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
}

const PRIORITY_CONFIG: Record<Priority, PriorityConfig> = {
  Baja: {
    classes:
      "bg-[var(--priority-low)] text-[var(--priority-low-foreground)] border border-[var(--priority-low-foreground)]/20",
    icon: ChevronDown,
    label: "Baja",
    ariaLabel: "Prioridad baja",
  },
  Normal: {
    classes:
      "bg-[var(--priority-normal)] text-[var(--priority-normal-foreground)] border border-[var(--priority-normal-foreground)]/25",
    icon: Minus,
    label: "Normal",
    ariaLabel: "Prioridad normal",
  },
  Alta: {
    classes:
      "bg-[var(--priority-high)] text-[var(--priority-high-foreground)] border border-[var(--priority-high-foreground)]/30",
    icon: ChevronUp,
    label: "Alta",
    ariaLabel: "Prioridad alta",
  },
  Urgente: {
    classes:
      "bg-[var(--priority-urgent)] text-[var(--priority-urgent-foreground)] border border-[var(--priority-urgent-foreground)]/30",
    icon: ChevronsUp,
    label: "Urgente",
    ariaLabel: "Prioridad urgente — acción inmediata requerida",
  },
};

interface TaskPriorityBadgeProps {
  priority: string;
  /** Si true, solo muestra el icono (útil en columnas compactas) */
  iconOnly?: boolean;
  className?: string;
}

export function TaskPriorityBadge({
  priority,
  iconOnly = false,
  className,
}: TaskPriorityBadgeProps) {
  const normalized = normalizeTaskPriority(priority) as Priority;
  const config = PRIORITY_CONFIG[normalized] ?? PRIORITY_CONFIG.Normal;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        config.classes,
        className,
      )}
      aria-label={config.ariaLabel}
      title={config.ariaLabel}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {!iconOnly && <span>{config.label}</span>}
    </span>
  );
}
