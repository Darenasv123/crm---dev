import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, CheckSquare, FileText, UserRound } from "lucide-react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { useCase } from "@/hooks/use-cases";
import { useDocuments } from "@/hooks/use-documents";
import { useCaseEvents, useCaseTasks } from "@/hooks/legal/use-case-management";

export const Route = createFileRoute("/_app/casos/$id")({
  component: CaseDetail,
});

function CaseDetail() {
  const { id } = Route.useParams();
  const { data: caseItem, isLoading } = useCase(id);
  const { data: documents = [] } = useDocuments();
  const { data: tasks = [] } = useCaseTasks({ caseId: id });
  const { data: events = [] } = useCaseEvents([id]);

  if (isLoading) {
    return (
      <AppLayout title="Expediente" subtitle="Cargando ficha">
        <LoadingState rows={5} />
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

  const caseDocuments = documents.filter((item) => item.case_id === id);
  const activeTasks = tasks.filter((item) => !["completed", "cancelled"].includes(item.status));

  return (
    <AppLayout
      title={caseItem.case_number || caseItem.expediente}
      subtitle={`${caseItem.materia || caseItem.process_type} · ${caseItem.clients?.name || "Sin cliente"}`}
      actions={
        <Button asChild variant="outline">
          <Link to={"/casos" as never}>
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
        </Button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.7fr)]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resumen operativo
              </p>
              <h2 className="mt-1 text-xl font-bold">{caseItem.process_type}</h2>
            </div>
            <StatusBadge tone={caseItem.status === "Archivado" ? "default" : "info"}>
              {caseItem.status}
            </StatusBadge>
          </div>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <Info label="Cliente" value={caseItem.clients?.name || "Sin cliente"} />
            <Info label="Materia" value={caseItem.materia || "Sin clasificar"} />
            <Info label="Prioridad" value={caseItem.priority || "Normal"} />
            <Info label="Próxima acción" value={caseItem.next_action || "Sin acción registrada"} />
            <Info
              label="Última actualización"
              value={new Date(caseItem.updated_at).toLocaleDateString("es-PE")}
            />
          </dl>
          {caseItem.current_summary && (
            <div className="mt-6 border-t pt-5">
              <h3 className="text-sm font-semibold">Resumen actual</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {caseItem.current_summary}
              </p>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Metric icon={CheckSquare} label="Tareas activas" value={activeTasks.length} />
          <Metric icon={FileText} label="Documentos" value={caseDocuments.length} />
          <Metric icon={CalendarClock} label="Movimientos" value={events.length} />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b p-5">
            <h2 className="font-bold">Trabajo relacionado</h2>
          </div>
          {tasks.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No hay tareas relacionadas.</p>
          ) : (
            tasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.profiles?.full_name || "Disponible"}
                  </p>
                </div>
                <StatusBadge tone={task.status === "completed" ? "success" : "info"}>
                  {task.status}
                </StatusBadge>
              </div>
            ))
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b p-5">
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
}: {
  icon: typeof CheckSquare;
  label: string;
  value: number;
}) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
