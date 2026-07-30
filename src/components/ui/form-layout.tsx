import { AlertCircle } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-4", className)}>
      {(title || description) && (
        <div className="border-b pb-3">
          {title && <h3 className="text-sm font-bold text-foreground">{title}</h3>}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function FormField({
  id,
  label,
  required,
  optional,
  description,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  description?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>
          {label} {required && <RequiredIndicator />}
        </Label>
        {optional && <span className="text-xs text-muted-foreground">Opcional</span>}
      </div>
      {children}
      {description && (
        <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-5 -mb-5 mt-2 flex flex-col-reverse gap-2 border-t bg-card/95 px-5 py-4 backdrop-blur sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6 [&>button]:w-full sm:[&>button]:w-auto",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FormErrorSummary({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 p-3 text-sm text-destructive",
        className,
      )}
      {...props}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function RequiredIndicator() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}
