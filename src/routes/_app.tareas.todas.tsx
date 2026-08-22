import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/todas")({
  validateSearch: (search: Record<string, unknown>) => ({
    tarea: typeof search.tarea === "string" ? search.tarea : undefined,
  }),
  head: () => ({ meta: [{ title: "Todas las tareas — CRM Jurídico" }] }),
  component: TodasTareasRoute,
});

function TodasTareasRoute() {
  const { tarea } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TasksPage
      mode="all"
      initialTaskId={tarea}
      onTaskUrlChange={(taskId) =>
        // Push (no replace): abrir/cerrar detalle queda en el historial,
        // así Back/Forward navegan naturalmente entre tareas seleccionadas.
        navigate({
          search: (prev) => ({ ...prev, tarea: taskId ?? undefined }),
        })
      }
    />
  );
}
