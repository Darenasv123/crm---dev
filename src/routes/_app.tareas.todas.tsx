import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/todas")({
  head: () => ({ meta: [{ title: "Todas las tareas — CRM Jurídico" }] }),
  component: () => <TasksPage mode="all" />,
});
