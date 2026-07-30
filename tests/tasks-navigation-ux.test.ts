import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const tasksPage = read("src/components/tasks/tasks-page.tsx");
const taskHook = read("src/hooks/use-daily-tasks.ts");
const agendaHook = read("src/hooks/use-agenda.ts");
const agendaRoute = read("src/routes/_app.agenda.index.tsx");
const dashboard = read("src/routes/_app.index.tsx");

describe("navegación final de tareas", () => {
  it("ofrece las vistas por rol y mantiene el tablero", () => {
    expect(tasksPage).toContain('{ to: "/tareas", label: "Disponibles" }');
    expect(tasksPage).toContain('{ to: "/tareas/mias", label: "Mis tareas" }');
    expect(tasksPage).toContain('{ to: "/tareas/mias", label: "En ejecución" }');
    expect(tasksPage).toContain('{ to: "/tareas/todas", label: "Todas" }');
    expect(tasksPage).toContain('{ to: "/tareas/tablero", label: "Tablero" }');
    expect(tasksPage).toContain('aria-label="Vistas de tareas"');
  });

  it("redirige la ruta heredada a la cola disponible", () => {
    const legacyRoute = read("src/routes/_app.tareas.proximas.tsx");
    expect(legacyRoute).toContain('throw redirect({ to: "/tareas" })');
  });

  it("mantiene filtros operativos sin programación temporal", () => {
    expect(tasksPage).toContain("Todos los estados");
    expect(tasksPage).toContain("Toda prioridad");
    expect(tasksPage).toContain("Todos los clientes");
    expect(tasksPage).toContain("Todos los expedientes");
    expect(tasksPage).toContain("Todos los responsables");
    expect(tasksPage).toContain("Sin cliente");
    expect(tasksPage).toContain("Sin expediente");
  });

  it("expone acciones de toma, devolución y administración", () => {
    expect(tasksPage).toContain("Tomar tarea");
    expect(tasksPage).toContain("Devolver tarea");
    expect(tasksPage).toContain("Liberar");
    expect(tasksPage).toContain("Eliminar");
  });

  it("permite revisar el detalle y editar observaciones con autorización", () => {
    expect(tasksPage).toContain("Ver detalle");
    expect(tasksPage).toContain("Guardar observación");
    expect(tasksPage).toContain("selectedTask.assigned_to === user?.id");
    expect(tasksPage).toContain("readOnly={!isAdmin");
  });
});

describe("separación entre tareas y agenda", () => {
  it("las consultas de tareas no invalidan Agenda", () => {
    expect(taskHook).not.toContain('queryKey: ["agenda_events"]');
    expect(taskHook).not.toContain('from("agenda_events")');
  });

  it("Agenda consulta únicamente sus eventos", () => {
    expect(agendaHook).toContain('.from("agenda_events")');
    expect(agendaHook).not.toContain('.from("case_tasks")');
    expect(agendaRoute).not.toContain("case_tasks");
  });

  it("el Dashboard usa métricas de cola, no cálculos por fecha", () => {
    expect(dashboard).toContain("usePendingTaskSummary");
    expect(dashboard).toContain("Trabajo pendiente");
    expect(dashboard).toContain("availableTaskCount");
    expect(dashboard).toContain("runningTaskCount");
  });
});
