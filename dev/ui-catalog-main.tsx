import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  Scale,
  Search,
  Settings,
  Users,
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

const navItems = [
  [LayoutDashboard, "Inicio"],
  [Users, "Clientes"],
  [Briefcase, "Expedientes"],
  [ClipboardList, "Tareas"],
  [CalendarDays, "Agenda"],
  [FileText, "Documentos"],
  [Settings, "Configuración"],
] as const;

const fictitiousClients = [
  { name: "Cliente Demostración", case: "EXP-DEMO-001", status: "Activo", task: "Revisar escrito" },
  { name: "Empresa Ejemplo SAC", case: "EXP-DEMO-002", status: "Activo", task: "Preparar reunión" },
  {
    name: "Persona de Prueba",
    case: "Sin expediente",
    status: "Prospecto",
    task: "Confirmar datos",
  },
];

export function Catalog() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-gold-foreground">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">CRM Jurídico Demo</p>
            <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
              Catálogo local
            </p>
          </div>
        </div>
        <nav className="space-y-1 p-3" aria-label="Navegación de demostración">
          {navItems.map(([Icon, label], index) => (
            <button
              key={label}
              type="button"
              aria-current={index === 1 ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                index === 1
                  ? "bg-sidebar-accent text-white ring-1 ring-inset ring-sidebar-border"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white"
              }`}
            >
              <Icon className={index === 1 ? "h-4 w-4 text-gold" : "h-4 w-4"} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú">
            <Menu />
          </Button>
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Búsqueda de demostración"
              placeholder="Buscar clientes, expedientes o tareas"
              className="bg-muted/50 pl-9"
            />
          </div>
          <Badge variant="info">Datos ficticios</Badge>
        </header>

        <section className="border-b bg-card/45 px-4 py-4 lg:px-8 lg:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
              <p className="text-sm text-muted-foreground">
                Catálogo visual local; no consulta servicios remotos.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus /> Nuevo cliente
            </Button>
          </div>
        </section>

        <main className="space-y-6 p-4 pb-24 lg:p-8">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Clientes activos" value="24" icon={Users} />
            <Metric label="Expedientes" value="18" icon={Briefcase} />
            <Metric label="Tareas pendientes" value="7" icon={ClipboardList} />
            <Metric label="Eventos próximos" value="5" icon={CalendarDays} />
          </section>

          <Card>
            <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Directorio operativo</CardTitle>
                <p className="text-sm text-muted-foreground">Controles y tabla administrativa</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="Filtrar clientes" placeholder="Filtrar clientes" />
                <NativeSelect aria-label="Filtrar estado" defaultValue="all">
                  <option value="all">Todos los estados</option>
                  <option value="active">Activos</option>
                  <option value="prospect">Prospectos</option>
                </NativeSelect>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Expediente</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Próxima tarea</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fictitiousClients.map((client) => (
                      <TableRow key={client.name}>
                        <TableCell className="font-semibold">{client.name}</TableCell>
                        <TableCell>{client.case}</TableCell>
                        <TableCell>
                          <Badge variant={client.status === "Activo" ? "success" : "warning"}>
                            {client.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{client.task}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm">
                            Ver ficha
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-3 p-4 md:hidden">
                {fictitiousClients.map((client) => (
                  <article key={client.name} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">{client.name}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{client.case}</p>
                      </div>
                      <Badge variant={client.status === "Activo" ? "success" : "warning"}>
                        {client.status}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm">{client.task}</p>
                    <Button variant="outline" size="sm" className="mt-3 w-full">
                      Ver ficha
                    </Button>
                  </article>
                ))}
              </div>
            </CardContent>
          </Card>

          <section>
            <h2 className="mb-3 text-base font-bold">Estados del sistema</h2>
            <div className="grid gap-4 xl:grid-cols-3">
              <LoadingState rows={2} />
              <EmptyState
                icon={CheckCircle2}
                title="No hay tareas disponibles"
                description="El equipo está al día. Vuelve a revisar cuando ingrese nuevo trabajo."
                action={<Button variant="outline">Ver todas las tareas</Button>}
              />
              <ErrorState
                description="No fue posible cargar esta sección de demostración."
                onRetry={() => undefined}
              />
            </div>
          </section>

          <FormErrorSummary>
            Ejemplo de error general: revisa los campos marcados antes de guardar.
          </FormErrorSummary>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-20 grid h-16 grid-cols-4 border-t bg-card lg:hidden">
          {navItems.slice(0, 4).map(([Icon, label], index) => (
            <button
              key={label}
              type="button"
              className={index === 1 ? "text-primary" : "text-muted-foreground"}
            >
              <Icon className="mx-auto h-5 w-5" />
              <span className="mt-0.5 block text-[10px]">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader icon={Users}>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>
              Completa la información principal. Todos los datos de este catálogo son ficticios.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => event.preventDefault()}>
            <FormSection title="Información principal">
              <FormField
                id="catalog-name"
                label="Nombre completo"
                required
                className="sm:col-span-2"
              >
                <Input id="catalog-name" defaultValue="Cliente Demostración" />
              </FormField>
              <FormField id="catalog-phone" label="Teléfono" optional>
                <Input id="catalog-phone" placeholder="+51 900 000 000" />
              </FormField>
              <FormField id="catalog-email" label="Correo" optional>
                <Input id="catalog-email" type="email" placeholder="demo@example.test" />
              </FormField>
              <FormField id="catalog-status" label="Estado">
                <NativeSelect id="catalog-status" defaultValue="active">
                  <option value="active">Activo</option>
                  <option value="prospect">Prospecto</option>
                </NativeSelect>
              </FormField>
              <FormField
                id="catalog-notes"
                label="Observaciones"
                optional
                className="sm:col-span-2"
              >
                <Textarea id="catalog-notes" placeholder="Contexto operativo breve" />
              </FormField>
            </FormSection>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Guardar cliente</Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Metric({
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
if (!root) throw new Error("No se encontró el contenedor del catálogo.");

createRoot(root).render(
  <StrictMode>
    <Catalog />
  </StrictMode>,
);
