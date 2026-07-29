import { Link, useRouterState } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-layout";
import { TaskCenter } from "@/components/tasks/task-center";

export function TasksPage({
  mode,
  board = false,
}: {
  mode: "today" | "upcoming";
  board?: boolean;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tabs = [
    { to: "/tareas", label: "Mi día", exact: true },
    { to: "/tareas/proximas", label: "Próximas" },
    { to: "/tareas/tablero", label: "Tablero" },
  ];

  return (
    <AppLayout title="Tareas" subtitle="Trabajo diario, responsables y próximos vencimientos">
      <nav
        aria-label="Vistas de tareas"
        className="mb-3 flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to as never}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <TaskCenter mode={mode} initialLayout={board ? "board" : "list"} lockLayout={board} />
    </AppLayout>
  );
}
