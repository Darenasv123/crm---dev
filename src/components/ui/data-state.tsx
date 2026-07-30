import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingState({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div
      aria-label="Cargando contenido"
      aria-busy="true"
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
  description: string;
  onRetry?: () => void;
  className?: string;
}) {
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
        {description}
      </p>
      {onRetry && (
        <Button type="button" variant="outline" onClick={onRetry} className="mt-5">
          Reintentar
        </Button>
      )}
    </div>
  );
}
