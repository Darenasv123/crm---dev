/**
 * zip-import-error-boundary.tsx
 *
 * Boundary de React local al diálogo de importación ZIP.
 *
 * Contexto (bug QA-IMPORT-TEST-20260815): tras el fallo de creación del
 * import_job por el constraint import_jobs_status_check, la UI se rompió
 * con "Cannot read properties of undefined (reading 'includes')". El único
 * boundary de error que existía en la app era el global de
 * src/routes/__root.tsx (`errorComponent`), que reemplaza TODA la página —
 * exactamente el comportamiento que el diagnóstico marca como incorrecto
 * ("NO crash global; NO full error boundary").
 *
 * El try/catch existente alrededor de executeZipImportFn en zip-importer.tsx
 * ya cubre errores lanzados dentro de esa promesa (incluido cualquier
 * TypeError, ya que TypeError es instanceof Error). Lo que NO cubre un
 * try/catch es una excepción durante el render de una etapa del diálogo.
 * Esta boundary cierra exactamente ese hueco: si algo revienta durante el
 * render de cualquier etapa (pick/analyzing/preview/dryrun/confirming/
 * importing/result/error), se muestra el mismo panel de error controlado
 * -local al diálogo, no a toda la app- con la opción de cerrar y reintentar,
 * en vez de dejar que el error suba hasta el boundary global.
 */
import { Component, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeCaughtError } from "@/lib/zip-import/describe-caught-error";

interface Props {
  children: ReactNode;
  /** Se invoca al pulsar "Cerrar": debe resetear el diálogo a su estado inicial. */
  onReset: () => void;
}

interface State {
  hasError: boolean;
  error: unknown;
}

const FALLBACK_MESSAGE =
  "Ocurrió un error inesperado al mostrar el importador. No se realizó ningún cambio en la base de datos.";

export class ZipImportErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    // Solo diagnóstico local — no se reenvía como crash global (ver
    // src/lib/lovable-error-reporting.ts, que sí reporta con
    // mechanism: "react_error_boundary" desde el boundary raíz).
    console.error(
      "[ZipImportErrorBoundary] Error de render capturado:",
      error,
      info.componentStack,
    );
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const message = describeCaughtError(this.state.error, FALLBACK_MESSAGE);

    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">No se puede continuar</p>
            <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap break-words">
              {message}
            </pre>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={this.handleReset}>
            <X className="h-4 w-4 mr-1" />
            Cerrar
          </Button>
        </div>
      </div>
    );
  }
}
