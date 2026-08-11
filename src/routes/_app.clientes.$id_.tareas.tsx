import { createFileRoute } from "@tanstack/react-router";
import { ClientRelatedPage } from "@/components/clients/client-related-page";

export const Route = createFileRoute("/_app/clientes/$id_/tareas")({
  component: ClientTasksPage,
});

function ClientTasksPage() {
  return <ClientRelatedPage clientId={Route.useParams().id} kind="tareas" />;
}
