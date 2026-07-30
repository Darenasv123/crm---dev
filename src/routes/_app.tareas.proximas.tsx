import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/tareas/proximas")({
  beforeLoad: () => {
    throw redirect({ to: "/tareas" });
  },
});
