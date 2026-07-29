import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/proximas")({
  head: () => ({ meta: [{ title: "Próximas tareas — CRM Jurídico" }] }),
  component: () => <TasksPage mode="upcoming" />,
});
