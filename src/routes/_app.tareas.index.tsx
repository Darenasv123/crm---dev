import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_app/tareas/")({
  head: () => ({ meta: [{ title: "Tareas — CRM Jurídico" }] }),
  component: () => <TasksPage mode="available" />,
});
