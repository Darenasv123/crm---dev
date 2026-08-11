import { Link } from "@tanstack/react-router";
import { ArrowLeft, Briefcase, CheckSquare, FileText } from "lucide-react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { useCases } from "@/hooks/use-cases";
import { useClient } from "@/hooks/use-clients";
import { useDocuments } from "@/hooks/use-documents";
import { useDailyTasks } from "@/hooks/use-daily-tasks";
import { useClientReports } from "@/hooks/use-reports";
import { normalizeTaskStatus, TASK_STATUS_LABELS } from "@/lib/tasks";

export type ClientRelatedKind = "documentos" | "tareas" | "reportes" | "expedientes";

const META = {
  documentos: { title: "Documentos", icon: FileText },
  tareas: { title: "Tareas", icon: CheckSquare },
  reportes: { title: "Reportes", icon: FileText },
  expedientes: { title: "Expedientes", icon: Briefcase },
} satisfies Record<ClientRelatedKind, { title: string; icon: typeof FileText }>;

export function ClientRelatedPage({
  clientId,
  kind,
}: {
  clientId: string;
  kind: ClientRelatedKind;
}) {
  const { data: client, isLoading: loadingClient } = useClient(clientId);
  const { data: cases = [], isLoading: loadingCases } = useCases();
  const { data: documents = [], isLoading: loadingDocuments } = useDocuments();
  const { data: reports = [], isLoading: loadingReports } = useClientReports();
  const { data: tasks = [], isLoading: loadingTasks } = useDailyTasks({
    view: "all",
    clientId,
    showCompleted: true,
  });

  const clientCases = cases.filter((item) => item.client_id === clientId);
  const caseIds = new Set(clientCases.map((item) => item.id));
  const clientDocuments = documents.filter(
    (item) => item.client_id === clientId || (!!item.case_id && caseIds.has(item.case_id)),
  );
  const clientReports = reports.filter((item) => item.client_id === clientId);
  const activeTasks = tasks.filter((item) => !["completed", "cancelled"].includes(item.status));
  const historyTasks = tasks.filter((item) => ["completed", "cancelled"].includes(item.status));
  const meta = META[kind];
  const loading =
    loadingClient || loadingCases || loadingDocuments || loadingReports || loadingTasks;

  return (
    <AppLayout
      title={`${meta.title}${client ? ` · ${client.name}` : ""}`}
      subtitle="Información exclusiva de este cliente"
      actions={
        <Button asChild variant="outline">
          <Link to={"/clientes/$id" as never} params={{ id: clientId } as never}>
            <ArrowLeft className="h-4 w-4" /> Volver a la ficha
          </Link>
        </Button>
      }
    >
      {loading ? (
        <LoadingState rows={5} />
      ) : !client ? (
        <EmptyState
          icon={meta.icon}
          title="Cliente no encontrado"
          description="La ficha solicitada no existe o no está disponible para tu cuenta."
        />
      ) : kind === "expedientes" ? (
        <RelatedList
          icon={Briefcase}
          empty="Este cliente aún no tiene expedientes."
          rows={clientCases.map((item) => ({
            id: item.id,
            title: item.case_number || item.expediente,
            detail: `${item.materia || item.process_type} · ${item.status}`,
            href: `/casos/${item.id}`,
          }))}
        />
      ) : kind === "documentos" ? (
        <RelatedList
          icon={FileText}
          empty="Este cliente aún no tiene documentos."
          rows={clientDocuments.map((item) => ({
            id: item.id,
            title: item.display_name || item.name,
            detail: `${item.document_type || item.type} · ${new Date(item.uploaded_at).toLocaleDateString("es-PE")}`,
            href: `/documentos?documento=${item.id}`,
          }))}
        />
      ) : kind === "reportes" ? (
        <RelatedList
          icon={FileText}
          empty="Este cliente aún no tiene reportes."
          rows={clientReports.map((item) => ({
            id: item.id,
            title: item.title,
            detail: `${item.category} · ${new Date(item.created_at).toLocaleDateString("es-PE")}`,
            href: "/reportes",
          }))}
        />
      ) : (
        <div className="grid gap-5">
          <TaskSection title="Tareas activas" rows={activeTasks} />
          <TaskSection title="Historial de tareas terminadas" rows={historyTasks} muted />
        </div>
      )}
    </AppLayout>
  );
}

function RelatedList({
  icon,
  empty,
  rows,
}: {
  icon: typeof FileText;
  empty: string;
  rows: Array<{ id: string; title: string; detail: string; href: string }>;
}) {
  const Icon = icon;
  if (rows.length === 0)
    return (
      <EmptyState
        icon={Icon}
        title={empty}
        description="Los cambios realizados en el módulo general aparecerán aquí automáticamente."
      />
    );
  return (
    <Card className="overflow-hidden">
      {rows.map((row) => (
        <Link
          key={row.id}
          to={row.href as never}
          className="flex items-center gap-3 border-b p-4 last:border-0 hover:bg-primary/5"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{row.title}</span>
            <span className="block truncate text-sm text-muted-foreground">{row.detail}</span>
          </span>
        </Link>
      ))}
    </Card>
  );
}

function TaskSection({
  title,
  rows,
  muted = false,
}: {
  title: string;
  rows: Array<{
    id: string;
    title: string;
    status: string;
    scheduled_for: string;
    assignee: { full_name: string } | null;
  }>;
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">
          No hay registros en este apartado.
        </Card>
      ) : (
        <Card className={muted ? "overflow-hidden opacity-80" : "overflow-hidden"}>
          {rows.map((task) => (
            <div
              key={task.id}
              className="grid gap-2 border-b p-4 last:border-0 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            >
              <div>
                <p className="font-semibold">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  Fecha de trabajo: {task.scheduled_for} ·{" "}
                  {task.assignee?.full_name || "Sin responsable"}
                </p>
              </div>
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
              <Button asChild variant="outline" size="sm">
                <Link to={"/tareas/todas" as never}>Abrir tareas</Link>
              </Button>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
