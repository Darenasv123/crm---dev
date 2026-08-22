import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { TemplatesSettings } from "@/components/settings/templates-settings";

/**
 * Biblioteca de Plantillas, accesible para todo el staff (Administrador y
 * Personal) -- a diferencia de /configuracion, que permanece exclusiva de
 * Administrador (Usuarios, Backup, Herramientas administrativas, Google
 * Calendar, Correo). Reutiliza exactamente TemplatesSettings, el mismo
 * componente que Configuración → Plantillas usa para Administrador; no hay
 * una segunda implementación. Ver/descargar quedan abiertos a ambos roles
 * porque TemplatesSettings ya gatea crear/eliminar internamente vía
 * resolveTemplatePermissions (canCreateTemplates/canDeleteTemplates,
 * solo Administrador) y la RLS de la base de datos es la garantía final,
 * no esta página.
 */
export const Route = createFileRoute("/_app/plantillas/")({
  head: () => ({ meta: [{ title: "Plantillas — CRM Jurídico" }] }),
  component: PlantillasPage,
});

function PlantillasPage() {
  return (
    <AppLayout title="Plantillas" subtitle="Biblioteca de plantillas de documentos del estudio">
      <TemplatesSettings />
    </AppLayout>
  );
}
