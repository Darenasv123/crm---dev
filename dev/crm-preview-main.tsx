import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Menu,
  Plus,
  Scale,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import "../src/styles.css";
import { Badge } from "../src/components/ui/badge";
import { Button } from "../src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../src/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../src/components/ui/data-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../src/components/ui/dialog";
import {
  FormActions,
  FormErrorSummary,
  FormField,
  FormSection,
} from "../src/components/ui/form-layout";
import { Input } from "../src/components/ui/input";
import { NativeSelect } from "../src/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/ui/table";
import { Textarea } from "../src/components/ui/textarea";

// DATOS FICTICIOS — no consultan servicios remotos
const DEMO_CLIENTS = [
  {
    id: "1",
    name: "Andrea Mendoza Ruiz",
    phone: "+51 987 654 321",
    email: "andrea.mendoza@example.test",
    status: "Activo",
    initials: "AM",
    color: "#8B5CF6",
    registered_at: "2026-01-15",
    cases: 2,
  },
  {
    id: "2",
    name: "Carlos Ramírez Salazar",
    phone: "+51 912 345 678",
    email: null,
    status: "Activo",
    initials: "CR",
    color: "#3B82F6",
    registered_at: "2026-02-10",
    cases: 1,
  },
  {
    id: "3",
    name: "Consultoría Jurídica Modelo SAC",
    phone: null,
    email: "contacto@modelolegal.test",
    status: "Prospecto",
    initials: "CJ",
    color: "#10B981",
    registered_at: "2026-03-05",
    cases: 0,
  },
];

const DEMO_CASES = [
  {
    id: "1",
    client: "Andrea Mendoza Ruiz",
    number: "00123-2026-0-1801-JP-FC-01",
    materia: "Familia",
    status: "En trámite",
    nextAction: "Elaborar escrito de subsanación",
  },
  {
    id: "2",
    client: "Andrea Mendoza Ruiz",
    number: "00456-2025-0-1801-JR-CI-02",
    materia: "Civil",
    status: "En trámite",
    nextAction: "Revisar resolución judicial recibida",
  },
  {
    id: "3",
    client: "Carlos Ramírez Salazar",
    number: "04782-2025-0-1801-JR-PE-02",
    materia: "Penal",
    status: "En trámite",
    nextAction: "Preparar documentación para presentar",
  },
];

const DEMO_TASKS = [
  { id: "1", title: "Elaborar escrito de subsanación", client: "Andrea Mendoza Ruiz", case: "00123-2026-0-1801-JP-FC-01", status: "pending", priority: "Alta", assignee: null },
  { id: "2", title: "Revisar resolución judicial recibida", client: "Andrea Mendoza Ruiz", case: "00456-2025-0-1801-JR-CI-02", status: "in_progress", priority: "Normal", assignee: "Juan Pérez Demo" },
  { id: "3", title: "Preparar documentación para presentar", client: "Carlos Ramírez Salazar", case: "04782-2025-0-1801-JR-PE-02", status: "pending", priority: "Alta", assignee: null },
  { id: "4", title: "Coordinar entrega de copias certificadas", client: "Andrea Mendoza Ruiz", case: "00123-2026-0-1801-JP-FC-01", status: "blocked", priority: "Normal", assignee: "María López Demo" },
];

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", view: "dashboard" },
  { icon: Users, label: "Clientes", view: "clients" },
  { icon: Briefcase, label: "Expedientes", view: "cases" },
  { icon: ClipboardList, label: "Tareas", view: "tasks" },
  { icon: CalendarDays, label: "Agenda", view: "calendar" },
  { icon: FileText, label: "Documentos", view: "documents" },
  { icon: FileText, label: "Reportes", view: "reports" },
  { icon: CreditCard, label: "Pagos", view: "payments" },
  { icon: Settings, label: "Configuración", view: "settings" },
] as const;

type View = (typeof navItems)[number]["view"];

export function CRMPreview() {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-gold-foreground">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">CRM Jurídico</p>
            <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
              Preview visual
            </p>
          </div>
        </div>
        <nav className="space-y-1 p-3" aria-label="Navegación de demostración">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => setCurrentView(item.view)}
              aria-current={currentView === item.view ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                currentView === item.view
                  ? "bg-sidebar-accent text-white ring-1 ring-inset ring-sidebar-border"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white"
              }`}
            >
              <item.icon className={currentView === item.view ? "h-4 w-4 text-gold" : "h-4 w-4"} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu />
          </Button>
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Búsqueda"
              placeholder="Buscar clientes, expedientes o tareas"
              className="bg-muted/50 pl-9"
              readOnly
            />
          </div>
          <Badge variant="warning">Datos ficticios — Solo preview</Badge>
        </header>

        {/* Content */}
        <main className="p-4 pb-24 lg:p-8">
          {currentView === "dashboard" && <DashboardView onOpenDialog={() => setDialogOpen(true)} />}
          {currentView === "clients" && <ClientsView onOpenDialog={() => setDialogOpen(true)} />}
          {currentView === "cases" && <CasesView onOpenDialog={() => setDialogOpen(true)} />}
          {currentView === "tasks" && <TasksView />}
          {currentView === "calendar" && <CalendarView />}
          {currentView === "documents" && <DocumentsView />}
          {currentView === "reports" && <ReportsView />}
          {currentView === "payments" && <PaymentsView />}
          {currentView === "settings" && <SettingsView />}
        </main>

        {/* Mobile Navigation */}
        <nav className="fixed inset-x-0 bottom-0 z-20 grid h-16 grid-cols-4 border-t bg-card lg:hidden">
          {navItems.slice(0, 4).map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => setCurrentView(item.view)}
              className={
                currentView === item.view ? "text-primary" : "text-muted-foreground"
              }
            >
              <item.icon className="mx-auto h-5 w-5" />
              <span className="mt-0.5 block text-[10px]">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-64 bg-sidebar text-sidebar-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-sidebar-border px-5 py-5">
              <div className="flex items-center gap-3">
                <Scale className="h-6 w-6 text-gold" />
                <span className="font-semibold text-white">CRM Jurídico</span>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="space-y-1 p-3">
              {navItems.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => {
                    setCurrentView(item.view);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                    currentView === item.view
                      ? "bg-sidebar-accent text-white"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Example Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Ejemplo de formulario</DialogTitle>
            <DialogDescription>
              Este diálogo muestra el sistema de formularios y controles compartidos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => e.preventDefault()}>
            <FormSection title="Información principal">
              <FormField id="demo-name" label="Nombre completo" className="sm:col-span-2">
                <Input id="demo-name" defaultValue="Andrea Mendoza Ruiz" />
              </FormField>
              <FormField id="demo-phone" label="Teléfono">
                <Input id="demo-phone" defaultValue="+51 987 654 321" />
              </FormField>
              <FormField id="demo-email" label="Correo" optional>
                <Input id="demo-email" type="email" defaultValue="demo@example.test" />
              </FormField>
              <FormField id="demo-status" label="Estado" className="sm:col-span-2">
                <NativeSelect id="demo-status" defaultValue="active">
                  <option value="active">Activo</option>
                  <option value="prospect">Prospecto</option>
                  <option value="inactive">Inactivo</option>
                </NativeSelect>
              </FormField>
              <FormField id="demo-notes" label="Observaciones" optional className="sm:col-span-2">
                <Textarea id="demo-notes" placeholder="Notas adicionales" />
              </FormField>
            </FormSection>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Guardar</Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashboardView({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen operativo del CRM</p>
        </div>
        <Button onClick={onOpenDialog}>
          <Plus /> Acción rápida
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Clientes activos" value="24" icon={Users} />
        <MetricCard label="Expedientes" value="18" icon={Briefcase} />
        <MetricCard label="Tareas pendientes" value="7" icon={ClipboardList} />
        <MetricCard label="Eventos próximos" value="5" icon={CalendarDays} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trabajo pendiente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {DEMO_TASKS.filter((t) => t.status === "pending").map((task) => (
                <div key={task.id} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-muted-foreground">{task.client}</p>
                  </div>
                  <Badge variant="default">{task.priority}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos eventos</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={CalendarDays}
              title="Sin eventos programados"
              description="Los próximos eventos del calendario aparecerán aquí."
              className="border-0 shadow-none"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ClientsView({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">Directorio operativo de clientes</p>
        </div>
        <Button onClick={onOpenDialog}>
          <Plus /> Nuevo cliente
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Expedientes</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_CLIENTS.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="font-semibold">{client.name}</TableCell>
                <TableCell>{client.phone || "Sin teléfono"}</TableCell>
                <TableCell>{client.email || "Sin correo"}</TableCell>
                <TableCell>{client.cases}</TableCell>
                <TableCell>
                  <Badge variant={client.status === "Activo" ? "success" : "warning"}>
                    {client.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CasesView({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expedientes</h1>
          <p className="text-sm text-muted-foreground">Seguimiento jurídico y próximas acciones</p>
        </div>
        <Button onClick={onOpenDialog}>
          <Plus /> Nuevo expediente
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expediente</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Materia</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Próxima acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_CASES.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-semibold">{item.number}</TableCell>
                <TableCell>{item.client}</TableCell>
                <TableCell>{item.materia}</TableCell>
                <TableCell>
                  <Badge variant="info">{item.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.nextAction}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function TasksView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tareas</h1>
          <p className="text-sm text-muted-foreground">Cola compartida de trabajo y seguimiento</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Disponibles" value="2" icon={ClipboardList} />
        <MetricCard label="En proceso" value="1" icon={ClipboardList} />
        <MetricCard label="Bloqueadas" value="1" icon={ClipboardList} />
        <MetricCard label="Completadas" value="0" icon={CheckCircle2} />
      </section>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarea</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Expediente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Responsable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DEMO_TASKS.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-semibold">{task.title}</TableCell>
                <TableCell>{task.client}</TableCell>
                <TableCell className="text-sm">{task.case}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      task.status === "completed"
                        ? "success"
                        : task.status === "blocked"
                          ? "destructive"
                          : "default"
                    }
                  >
                    {task.status === "pending" && "Disponible"}
                    {task.status === "in_progress" && "En proceso"}
                    {task.status === "blocked" && "Bloqueada"}
                    {task.status === "completed" && "Completada"}
                  </Badge>
                </TableCell>
                <TableCell>{task.priority}</TableCell>
                <TableCell>{task.assignee || "Disponible"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function CalendarView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-sm text-muted-foreground">Calendario y eventos próximos</p>
        </div>
        <Button>
          <Plus /> Nuevo evento
        </Button>
      </div>

      <Card className="p-8">
        <EmptyState
          icon={CalendarDays}
          title="Sin eventos programados"
          description="Los eventos del calendario aparecerán aquí cuando estén sincronizados con Google Calendar."
        />
      </Card>
    </div>
  );
}

function DocumentsView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documentos</h1>
          <p className="text-sm text-muted-foreground">Almacenamiento organizado por carpetas</p>
        </div>
        <Button>
          <Plus /> Cargar documento
        </Button>
      </div>

      <Card className="p-8">
        <EmptyState
          icon={FolderOpen}
          title="Sin documentos"
          description="Los archivos cargados aparecerán organizados en carpetas por cliente o expediente."
        />
      </Card>
    </div>
  );
}

function ReportsView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-sm text-muted-foreground">Generación de reportes para clientes</p>
        </div>
        <Button>
          <Plus /> Nuevo reporte
        </Button>
      </div>

      <Card className="p-8">
        <EmptyState
          icon={FileText}
          title="Sin reportes generados"
          description="Los reportes de clientes aparecerán aquí con opciones de descarga y envío por WhatsApp."
        />
      </Card>
    </div>
  );
}

function PaymentsView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pagos</h1>
          <p className="text-sm text-muted-foreground">Registro de honorarios y abonos</p>
        </div>
        <Button>
          <Plus /> Registrar pago
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total pendiente" value="S/ 15,200" icon={CreditCard} />
        <MetricCard label="Total cobrado" value="S/ 8,500" icon={CheckCircle2} />
        <MetricCard label="Pagos parciales" value="3" icon={CreditCard} />
        <MetricCard label="Al día" value="12" icon={CheckCircle2} />
      </section>

      <Card className="p-8">
        <LoadingState rows={3} />
      </Card>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-sm text-muted-foreground">Gestión de usuarios, roles e integraciones</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usuarios y roles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Administra el equipo y sus permisos operativos.
            </p>
            <Button variant="outline" className="mt-4">
              Gestionar usuarios
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integración con Google Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="success" className="mb-2">
              Conectado
            </Badge>
            <p className="text-sm text-muted-foreground">
              Los eventos se sincronizan bidireccionalmente con Google Calendar.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Estado del sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorState
              description="No fue posible cargar el estado del sistema. Este es un ejemplo de estado de error."
              onRetry={() => undefined}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Users;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </Card>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el contenedor del preview.");

createRoot(root).render(
  <StrictMode>
    <CRMPreview />
  </StrictMode>,
);
