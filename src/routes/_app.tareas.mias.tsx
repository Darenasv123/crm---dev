import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/mias")({
  head: () => ({ meta: [{ title: "Trabajo asignado — CRM Jurídico" }] }),
  component: () => <TasksPage mode="assigned" />,
});
