import { AlertTriangle, Inbox, Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingState({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      aria-label="Cargando contenido"
      aria-busy="true"
      role="status"
      className={cn("surface-panel space-y-3 p-4", className)}
    >
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface-panel px-5 py-10 text-center", className)}>
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-bold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "No pudimos cargar esta información",
  description,
  onRetry,
  className,
}: {
  title?: string;
  /** Mensaje de error. No exponer mensajes SQL directamente. */
  description: string;
  onRetry?: () => void;
  className?: string;
}) {
  // Sanitizar: ocultar detalles técnicos SQL al usuario final
  const safeDescription =
    /\b(pg_|sql|postgres|supabase|rls|policy|relation|column|operator)\b/i.test(description)
      ? "Ocurrió un error inesperado. Por favor intenta de nuevo."
      : description;

  return (
    <div
      role="alert"
      className={cn(
        "surface-panel border-destructive/25 bg-destructive/5 px-5 py-8 text-center",
        className,
      )}
    >
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-bold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
        {safeDescription}
      </p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry} className="mt-5">
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function AccessDenied({
  title = "Acceso restringido",
  description = "No tienes permisos para ver este contenido. Contacta al administrador si crees que esto es un error.",
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      aria-label="Acceso denegado"
      className={cn(
        "surface-panel border-warning/30 bg-warning/5 px-5 py-8 text-center",
        className,
      )}
    >
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-warning/10 text-warning-foreground">
        <Lock className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 font-bold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
