import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, FolderArchive } from "lucide-react";
import { AppLayout, Card } from "@/components/app-layout";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app/importaciones/")({
  head: () => ({ meta: [{ title: "Importaciones - CRM Juridico" }] }),
  component: ImportsPage,
});

function ImportsPage() {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && profile && profile.role !== "Administrador") {
      navigate({ to: "/", replace: true });
    }
  }, [profile, loading, navigate]);

  if (loading || !profile || profile.role !== "Administrador") return null;

  return (
    <AppLayout
      title="Importaciones"
      subtitle="Las acciones operativas ahora se realizan desde Clientes"
    >
      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderArchive className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Herramientas administrativas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                El ZIP individual y la lista CSV/XLSX se importan desde Clientes. El historial,
                diagnostico y limpieza segura estan en Configuracion.
              </p>
            </div>
          </div>

          <Link
            to={"/configuracion" as never}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            Abrir Configuracion
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>
    </AppLayout>
  );
}
