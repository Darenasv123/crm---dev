import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, CheckSquare, Edit3, FileText, UserRound } from "lucide-react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { RelatedDocuments } from "@/components/documents/related-documents";
import { CaseEditDialog } from "@/components/cases/case-edit-dialog";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import { useAuth } from "@/hooks/use-auth";
import { useCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useDocuments } from "@/hooks/use-documents";
import { useCaseEvents, useCaseTasks } from "@/hooks/legal/use-case-management";
import { filterDocumentsByCase } from "@/lib/document-actions";
import { normalizeTaskStatus, TASK_STATUS_LABELS } from "@/lib/tasks";
import { usePermissions } from "@/lib/permissions";
import { useState } from "react";

export const Route = createFileRoute("/_app/casos/$id")({
  component: CaseDetail,
});

function CaseDetail() {
  const { id } = Route.useParams();
  const { profile } = useAuth();
  const permissions = usePermissions(profile);
  const { data: caseItem, isLoading, error: caseError } = useCase(id);
  const { data: clients = [] } = useClients();
  const { data: documents = [] } = useDocuments();
  const { data: tasks = [] } = useCaseTasks({ caseId: id });
  const { data: events = [] } = useCaseEvents([id]);
  const [showEdit, setShowEdit] = useState(false);

  if (isLoading) {
    return (
      <AppLayout title="Expediente" subtitle="Cargando ficha">
        <LoadingState rows={5} />
      </AppLayout>
    );
  }

  if (caseError) {
    return (
      <AppLayout title="Error al cargar expediente">
        <Card className="p-8">
          <p className="text-center text-sm text-destructive">
            {caseError instanceof Error ? caseError.message : "Error desconocido"}
          </p>
          <div className="mt-4 text-center">
            <Button asChild variant="outline">
              <Link to={"/casos" as never}>Volver a expedientes</Link>
            </Button>
          </div>
        </Card>
      </AppLayout>
    );
  }

  if (!caseItem) {
    return (
      <AppLayout title="Expediente no encontrado">
        <EmptyState
          icon={FileText}
          title="No encontramos este expediente"
          description="Es posible que haya sido eliminado o que el enlace ya no sea válido."
          action={
            <Button asChild variant="outline">
              <Link to={"/casos" as never}>Volver a expedientes</Link>
            </Button>
          }
        />
      </AppLayout>
    );
  }

  const caseDocuments = filterDocumentsByCase(documents, id);
  const activeTasks = tasks.filter((item) => !["completed", "cancelled"].includes(item.status));

  return (
    <AppLayout
      title={caseItem.case_number || caseItem.expediente}
      subtitle={`${caseItem.materia || caseItem.process_type} · ${caseItem.clients?.name || "Sin cliente"}`}
      actions={
        <>
          <Button asChild variant="outline">
            <Link to={"/casos" as never}>
              <ArrowLeft className="h-4 w-4" /> Volver
            </Link>
          </Button>
          {permissions.canEditCases && (
            <Button type="button" onClick={() => setShowEdit(true)}>
              <Edit3 className="h-4 w-4" /> Editar
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]">
        <Card className="p-6 border-l-4 border-l-info">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Expediente Legal
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {caseItem.case_number || caseItem.expediente}
              </h2>
            </div>
            <StatusBadge
              tone={
                caseItem.status === "Archivado"
                  ? "default"
                  : caseItem.priority === "Alta"
                    ? "danger"
                    : "info"
              }
            >
              {caseItem.status}
            </StatusBadge>
          </div>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2 border-t pt-5">
            <Info label="Cliente" value={caseItem.clients?.name || "Sin cliente"} />
            <Info label="Materia" value={caseItem.materia || "Sin clasificar"} />
            <Info label="Tipo" value={caseItem.process_type} />
            <Info label="Prioridad" value={caseItem.priority || "Normal"} />
            <Info label="Próxima acción" value={caseItem.next_action || "Sin acción registrada"} />
            <Info
              label="Última actualización"
              value={new Date(caseItem.updated_at).toLocaleDateString("es-PE")}
            />
          </dl>
          {caseItem.current_summary && (
            <div className="mt-6 border-t pt-5 bg-primary/5 p-4 rounded-lg">
              <h3 className="text-sm font-semibold">Resumen actual</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {caseItem.current_summary}
              </p>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Metric
            icon={CheckSquare}
            label="Tareas activas"
            value={activeTasks.length}
            color="primary"
          />
          <Metric icon={FileText} label="Documentos" value={caseDocuments.length} color="info" />
          <Metric icon={CalendarClock} label="Movimientos" value={events.length} color="success" />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden border-t-4 border-t-primary">
          <div className="border-b bg-primary/5 p-5 flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" />
            <h2 className="font-bold">Trabajo relacionado</h2>
          </div>
          {tasks.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No hay tareas relacionadas.</p>
          ) : (
            <>
              {tasks.slice(0, 8).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.profiles?.full_name || "Disponible"} · Fecha de trabajo:{" "}
                      {task.scheduled_for}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <TaskPriorityBadge priority={task.priority} iconOnly />
                    <StatusBadge
                      tone={
                        normalizeTaskStatus(task.status) === "completed"
                          ? "success"
                          : normalizeTaskStatus(task.status) === "blocked"
                            ? "danger"
                            : "info"
                      }
                    >
                      {TASK_STATUS_LABELS[normalizeTaskStatus(task.status)]}
                    </StatusBadge>
                  </div>
                </div>
              ))}
              <div className="border-t p-3 text-center">
                <Button asChild variant="outline" size="sm">
                  <Link to={"/tareas/todas" as never}>Abrir tareas</Link>
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card className="overflow-hidden border-t-4 border-t-success">
          <div className="border-b bg-success/5 p-5 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-success" />
            <h2 className="font-bold">Cronología</h2>
          </div>
          {events.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No hay movimientos registrados.</p>
          ) : (
            events.slice(0, 8).map((event) => (
              <div key={event.id} className="flex gap-3 border-b p-4 last:border-b-0">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.event_date).toLocaleDateString("es-PE")}
                  </p>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden border-t-4 border-t-info">
        <div className="border-b bg-info/5 p-5 flex items-center gap-2">
          <FileText className="h-5 w-5 text-info" />
          <h2 className="font-bold">Documentos del expediente</h2>
        </div>
        <div className="p-4">
          <RelatedDocuments
            documents={caseDocuments}
            emptyTitle="Este expediente aún no tiene documentos."
            emptyDescription="Los documentos vinculados a este expediente desde Documentos aparecerán aquí."
          />
        </div>
      </Card>

      <CaseEditDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        caseItem={caseItem}
        clients={clients}
      />
    </AppLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  color = "primary",
}: {
  icon: typeof CheckSquare;
  label: string;
  value: number;
  color?: "primary" | "info" | "success" | "destructive";
}) {
  const colorMap = {
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
  };

  return (
    <Card className="flex items-center gap-4 p-5 hover:shadow-md transition-shadow">
      <span className={`grid h-10 w-10 place-items-center rounded-lg ${colorMap[color]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
