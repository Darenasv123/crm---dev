import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const tasksPage = read("src/components/tasks/tasks-page.tsx");
const taskHook = read("src/hooks/use-daily-tasks.ts");
const agendaHook = read("src/hooks/use-agenda.ts");
const agendaRoute = read("src/routes/_app.agenda.index.tsx");
const dashboard = read("src/routes/_app.index.tsx");
const tareasTodasRoute = read("src/routes/_app.tareas.todas.tsx");
const caseDetail = read("src/routes/_app.casos.$id.tsx");
const clientRelatedPage = read("src/components/clients/client-related-page.tsx");
const clientesIndex = read("src/routes/_app.clientes.index.tsx");
const casosIndex = read("src/routes/_app.casos.index.tsx");
const documentosIndex = read("src/routes/_app.documentos.index.tsx");

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

describe("edición de tareas reutiliza la mutation existente", () => {
  it("TaskFormDialog usa useUpdateDailyTask, no una mutation nueva", () => {
    const dialog = read("src/components/tasks/task-form-dialog.tsx");
    expect(dialog).toContain("useUpdateDailyTask");
    expect(dialog).toContain("useCreateDailyTask");
    expect(dialog).not.toMatch(/function\s+useUpdateDailyTask|function\s+useCreateDailyTask/);
  });

  it("el botón Editar tarea solo aparece para Administrador", () => {
    expect(tasksPage).toContain("isAdmin && (");
    expect(tasksPage).toContain("Editar tarea");
  });
});

describe("deep-link a una tarea concreta (?tarea=<id>)", () => {
  it("la ruta /tareas/todas valida el search param y lo pasa a TasksPage", () => {
    expect(tareasTodasRoute).toContain("tarea: typeof search.tarea");
    expect(tareasTodasRoute).toContain("initialTaskId={tarea}");
    expect(tareasTodasRoute).toContain("onTaskUrlChange=");
  });

  it("TasksPage selecciona la tarea por ID y reporta el caso no encontrado sin romper la página", () => {
    expect(tasksPage).toContain("tasks.find((item) => item.id === initialTaskId)");
    expect(tasksPage).toContain("La tarea enlazada ya no está disponible en esta vista.");
  });

  it("abrir/cerrar el detalle actualiza la URL mediante el mismo callback (sin duplicar lógica)", () => {
    expect(tasksPage).toContain("onTaskUrlChange?.(task.id)");
    expect(tasksPage).toContain("onTaskUrlChange?.(null)");
  });

  it("el Dashboard, Expediente y Cliente generan el mismo formato de enlace", () => {
    expect(dashboard).toContain('to={"/tareas/todas" as never}');
    expect(dashboard).toContain("search={{ tarea: task.id } as never}");
    expect(caseDetail).toContain('to={"/tareas/todas" as never}');
    expect(caseDetail).toContain("search={{ tarea: task.id } as never}");
    expect(clientRelatedPage).toContain('to={"/tareas/todas" as never}');
    expect(clientRelatedPage).toContain("search={{ tarea: task.id } as never}");
  });
});

describe("QA-003 — Quick Actions honestas", () => {
  it("Cliente, Expediente y Documento inician realmente el alta reutilizando el diálogo existente", () => {
    expect(dashboard).toContain('label="Nuevo cliente"');
    expect(dashboard).toContain('search={{ nuevo: "1" }}');
    expect(dashboard).toContain('label="Nuevo expediente"');
    expect(dashboard).toContain('label="Subir documento"');
    expect(dashboard).toContain('search={{ subir: "1" }}');
    expect(clientesIndex).toContain('nuevo: search.nuevo === "1"');
    expect(clientesIndex).toContain("if (canCreate) setShowForm(true)");
    expect(casosIndex).toContain('nuevo: search.nuevo === "1"');
    expect(casosIndex).toContain("if (canCreate) setShowForm(true)");
    expect(documentosIndex).toContain('subir: search.subir === "1"');
    expect(documentosIndex).toContain("if (permissions.canUploadDocuments) setShowUpload(true)");
  });

  it("Pagos y Agenda quedan fuera de alcance: el texto describe el destino real, no una alta silenciosa", () => {
    expect(dashboard).toContain('label="Ver pagos"');
    expect(dashboard).toContain('label="Ver agenda"');
    expect(dashboard).not.toContain('label="Registrar pago"');
    expect(dashboard).not.toContain('label="Agendar actividad"');
  });
});

describe("QA-004 — cada tarjeta de Trabajo pendiente abre su propia tarea", () => {
  it("el Link de cada tarjeta usa el id real de la tarea, no una ruta genérica fija", () => {
    // El link de cabecera "Abrir tareas" (vista general) puede seguir siendo
    // genérico; lo que corrige QA-004 es el link de CADA TARJETA individual.
    expect(dashboard).toMatch(
      /to=\{"\/tareas\/todas" as never\}\s*\n\s*search=\{\{ tarea: task\.id \} as never\}/,
    );
  });
});

describe("QA-007 — una tarea disponible no muestra un select falso", () => {
  it("el estado se comunica como texto/badge hasta que la tarea es tomada", () => {
    expect(tasksPage).toContain("available ? (");
    expect(tasksPage).toContain("Disponible — tómala primero");
    expect(tasksPage).toContain('title="Primero debes tomar la tarea para cambiar su estado."');
  });
});

describe("QA-008 — semántica del badge vs. el Total de Todas", () => {
  it('"Todas" no hereda por defecto el filtro de "hoy": cuenta todo el universo, como promete su nombre', () => {
    expect(tasksPage).toContain(
      'dateScope, setDateScope] = useState<DateScope>(mode === "all" ? "all" : "day")',
    );
  });

  it("el Total muestra el alcance de fecha activo para que nunca se confunda con el badge", () => {
    expect(tasksPage).toContain('label="Total"');
    expect(tasksPage).toContain("hint={");
  });

  it("el badge del menú lateral documenta su semántica real (disponibles/mías, cualquier fecha)", () => {
    const layout = read("src/components/app-layout.tsx");
    expect(layout).toContain("taskAttentionHint");
    expect(layout).toContain("Tareas disponibles sin tomar, de cualquier fecha");
    expect(layout).toContain("Tareas asignadas a mí, de cualquier fecha");
  });
});

describe('"Liberar a Disponibles" ya no es una opción de texto largo dentro del select', () => {
  it("es un botón propio con su propio target táctil, junto al select de responsable", () => {
    expect(tasksPage).not.toContain('<option value="">Liberar a Disponibles</option>');
    expect(tasksPage).toContain('<option value="">Sin asignar</option>');
    expect(tasksPage).toContain('title="Liberar a Disponibles"');
    expect(tasksPage).toContain('onAssign(task, "")');
  });
});

describe("navegación Tarea → Expediente → Cliente", () => {
  it("el expediente lleva a su propia ficha, no a la del cliente (corrección de UX documentada)", () => {
    expect(tasksPage).toContain('to={"/casos/$id" as never}');
    expect(tasksPage).toContain("el número identifica precisamente al expediente, y desde su");
  });

  it("el cliente lleva directamente a su ficha cuando la tarea lo tiene", () => {
    expect(tasksPage).toContain('to={"/clientes/$id" as never}');
    expect(tasksPage).toContain("resolvedClientId = task.client_id ?? task.cases?.client_id");
  });

  it("no rompe cuando la tarea no tiene cliente ni expediente (tarea general)", () => {
    expect(tasksPage).toContain(
      '<span className="truncate text-sm text-muted-foreground">General</span>',
    );
    expect(tasksPage).toContain("Sin expediente");
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
