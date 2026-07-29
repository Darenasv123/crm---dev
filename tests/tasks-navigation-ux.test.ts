import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("navegación de Tareas y Agenda", () => {
  const layout = read("src/components/app-layout.tsx");
  const tasksPage = read("src/components/tasks/tasks-page.tsx");
  const todayRoute = read("src/routes/_app.tareas.index.tsx");
  const upcomingRoute = read("src/routes/_app.tareas.proximas.tsx");
  const boardRoute = read("src/routes/_app.tareas.tablero.tsx");
  const agenda = read("src/routes/_app.agenda.index.tsx");
  const dashboard = read("src/routes/_app.index.tsx");

  it("añade Tareas antes de Agenda en el menú principal", () => {
    expect(layout.indexOf('to: "/tareas"')).toBeLessThan(layout.indexOf('to: "/agenda"'));
    expect(layout).toContain('label: "Tareas"');
    expect(layout).toContain("taskAttentionCount");
  });

  it("prioriza Inicio, Clientes, Tareas, Agenda y Más en móvil", () => {
    expect(layout).toContain('to: "/tareas", label: "Tareas"');
    expect(layout).toContain("<span>Más</span>");
    expect(layout).toContain("setMobileMenuOpen(true)");
  });

  it("crea las tres rutas sin duplicar TaskCenter", () => {
    expect(todayRoute).toContain('createFileRoute("/_app/tareas/")');
    expect(upcomingRoute).toContain('createFileRoute("/_app/tareas/proximas")');
    expect(boardRoute).toContain('createFileRoute("/_app/tareas/tablero")');
    expect(tasksPage).toContain("<TaskCenter");
    expect(todayRoute).not.toContain("<TaskCenter");
    expect(upcomingRoute).not.toContain("<TaskCenter");
  });

  it("mantiene Mi día, Próximas y Tablero como navegación accesible", () => {
    expect(tasksPage).toContain('aria-label="Vistas de tareas"');
    expect(tasksPage).toContain('to: "/tareas/proximas"');
    expect(tasksPage).toContain('to: "/tareas/tablero"');
    expect(tasksPage).toContain('aria-current={active ? "page"');
  });

  it("deja Agenda enfocada en calendario y filtros de tipo", () => {
    expect(agenda).not.toContain("AgendaTabs");
    expect(agenda).not.toContain('from "@/components/tasks/task-center"');
    expect(agenda).toContain("calendarFilter");
    expect(agenda).toContain('navigate({ to: "/tareas"');
    expect(agenda).toContain("tasksByDay");
  });

  it("dirige el widget del dashboard a Tareas", () => {
    expect(dashboard).toContain('to={"/tareas" as never}');
    expect(dashboard).toContain("useTodayTaskSummary");
  });
});

describe("contrato UX de filtros, tabla y panel", () => {
  const center = read("src/components/tasks/task-center.tsx");
  const filters = read("src/components/tasks/task-filters-sheet.tsx");
  const views = read("src/components/tasks/task-views.tsx");

  it("mantiene visibles búsqueda, alcance, fecha, filtros y creación", () => {
    expect(center).toContain("Buscar por título");
    expect(center).toContain("Mis tareas");
    expect(center).toContain("Día anterior");
    expect(center).toContain("Filtros{activeFilterCount");
    expect(center).toContain("Nueva tarea");
  });

  it("agrupa filtros avanzados en una hoja inferior móvil", () => {
    expect(filters).toContain('side="bottom"');
    expect(filters).toContain("Solo vencidas");
    expect(filters).toContain("Sin cliente");
    expect(filters).toContain("Sin expediente");
    expect(filters).toContain("Limpiar todo");
  });

  it("permite quitar chips individualmente", () => {
    expect(center).toContain("aria-label={`Quitar filtro");
    expect(center).toContain("onClick={chip.clear}");
    expect(center).toContain('aria-label="Filtros activos"');
  });

  it("usa ancho completo, tabla compacta y tarjetas móviles", () => {
    expect(center).toContain("w-full max-w-none");
    expect(views).toContain("table-fixed");
    expect(views).not.toContain("min-w-[1050px]");
    expect(views).toContain("md:hidden");
  });

  it("mantiene el detalle superpuesto y añade historial", () => {
    expect(views).toContain("sm:max-w-[500px]");
    expect(views).toContain("Historial");
    expect(views).toContain("Tarea terminada");
  });
});
