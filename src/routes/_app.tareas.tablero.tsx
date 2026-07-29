import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/tablero")({
  head: () => ({ meta: [{ title: "Tablero de tareas — CRM Jurídico" }] }),
  component: () => <TasksPage mode="today" />,
});
