import { createFileRoute } from "@tanstack/react-router";
import { ClientRelatedPage } from "@/components/clients/client-related-page";

export const Route = createFileRoute("/_app/clientes/$id_/expedientes")({
  component: ClientCasesPage,
});

function ClientCasesPage() {
  return <ClientRelatedPage clientId={Route.useParams().id} kind="expedientes" />;
}
