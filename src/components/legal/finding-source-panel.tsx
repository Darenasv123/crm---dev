import { Card } from "@/components/app-layout";
import { FileText } from "lucide-react";

interface FindingSourcePanelProps {
  source: {
    documentName: string;
    page: number | null;
    excerpt: string | null;
    confidence: number;
  };
}

export function FindingSourcePanel({ source }: FindingSourcePanelProps) {
  const confidencePct = Math.round(source.confidence * 100);

  return (
    <Card className="h-fit p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4 text-primary" /> Fuente del dato
      </h2>
      <div className="mt-4 rounded-lg border border-border p-4">
        <div className="text-sm font-semibold">{source.documentName}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {source.page ? `Página ${source.page}` : "Página no especificada"}
        </div>
        <blockquote className="mt-4 border-l-2 border-primary pl-3 text-sm leading-6 text-foreground/80 italic">
          {source.excerpt ?? "Sin fragmento de texto extraído."}
        </blockquote>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Nivel de confianza</span>
          <span className="font-semibold">{confidencePct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${
              source.confidence >= 0.9
                ? "bg-emerald-500"
                : source.confidence >= 0.75
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        El nivel de confianza orienta la revisión, pero nunca sustituye la comprobación del
        documento fuente.
      </p>
    </Card>
  );
}
