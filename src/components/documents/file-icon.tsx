import { FileText } from "lucide-react";

const EXTENSION_COLORS: Record<string, string> = {
  pdf: "text-red-500",
  doc: "text-blue-600",
  docx: "text-blue-600",
  xls: "text-green-600",
  xlsx: "text-green-600",
  jpg: "text-amber-500",
  jpeg: "text-amber-500",
  png: "text-amber-500",
  gif: "text-amber-500",
};

/** Icono compacto por extensión de archivo, reutilizado por todos los contextos documentales. */
export function FileExtIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const colorClass = EXTENSION_COLORS[ext] ?? "text-muted-foreground";
  return (
    <div
      className={`grid h-8 w-8 place-items-center rounded-lg bg-muted/50 shrink-0 ${className ?? ""}`}
      aria-hidden="true"
    >
      <FileText className={`h-4 w-4 ${colorClass}`} />
    </div>
  );
}
