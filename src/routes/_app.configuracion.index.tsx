import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { users } from "@/lib/mock-data";
import { useState } from "react";
import { Plus, Bell, MessageCircle, Mail, FileText, Shield, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_app/configuracion/")({
  head: () => ({ meta: [{ title: "Configuración — CRM Jurídico" }] }),
  component: SettingsPage,
});

const TABS = [
  { id: "usuarios", label: "Usuarios y roles", icon: Shield },
  { id: "notificaciones", label: "Notificaciones", icon: Bell },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "correo", label: "Correo", icon: Mail },
  { id: "plantillas", label: "Plantillas", icon: FileText },
];

const roleColor: Record<string, "navy" | "gold" | "info" | "default"> = {
  Administrador: "navy",
  Abogado: "gold",
  Asistente: "info",
  Secretaria: "default",
};

function SettingsPage() {
  const [tab, setTab] = useState("usuarios");

  return (
    <AppLayout title="Configuración" subtitle="Gestión del estudio y preferencias">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <Card className="p-3 h-fit">
          <nav className="space-y-1">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${active ? "bg-primary text-primary-foreground font-semibold shadow-soft" : "hover:bg-muted/50"}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{t.label}</span>
                  <ChevronRight className={`h-4 w-4 ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
                </button>
              );
            })}
          </nav>
        </Card>

        <div>
          {tab === "usuarios" && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h3 className="text-base font-semibold">Usuarios del estudio</h3>
                  <p className="text-xs text-muted-foreground">Roles: Administrador, Abogado, Asistente, Secretaria</p>
                </div>
                <button className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110">
                  <Plus className="h-3.5 w-3.5" /> Invitar usuario
                </button>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><th className="py-3 pl-5">Usuario</th><th className="py-3 px-3">Rol</th><th className="py-3 px-3">Estado</th><th className="py-3 pr-5 text-right">Acciones</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                      <td className="py-3 pl-5">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{u.initials}</div>
                          <div>
                            <div className="font-semibold">{u.name}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3"><StatusBadge tone={roleColor[u.role]}>{u.role}</StatusBadge></td>
                      <td className="py-3 px-3"><StatusBadge tone="success"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{u.status}</StatusBadge></td>
                      <td className="py-3 pr-5 text-right">
                        <button className="h-8 px-3 rounded-md text-xs font-semibold text-primary hover:bg-primary/10">Editar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {tab === "notificaciones" && (
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-1">Notificaciones</h3>
              <p className="text-xs text-muted-foreground mb-5">Configura cómo y cuándo recibir avisos.</p>
              <div className="space-y-1">
                {[
                  { l: "Audiencias próximas", d: "Recibir alerta 24h antes de cada audiencia.", on: true },
                  { l: "Vencimientos legales", d: "Alertar 3 días antes del vencimiento de un plazo.", on: true },
                  { l: "Pagos vencidos", d: "Aviso diario de cuentas por cobrar vencidas.", on: false },
                  { l: "Nuevos documentos", d: "Notificar cuando se cargue un documento al caso.", on: true },
                  { l: "Resumen semanal", d: "Reporte ejecutivo cada lunes a las 8 a. m.", on: true },
                ].map((n, i) => <Toggle key={i} label={n.l} desc={n.d} initial={n.on} />)}
              </div>
            </Card>
          )}

          {tab === "whatsapp" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><MessageCircle className="h-6 w-6" /></div>
                <div>
                  <h3 className="text-base font-semibold">Integración con WhatsApp Business</h3>
                  <p className="text-xs text-muted-foreground">Envía recordatorios y confirmaciones de audiencia a clientes.</p>
                </div>
                <span className="ml-auto"><StatusBadge tone="success">Conectado</StatusBadge></span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Número conectado" value="+51 998 ••• •••" />
                <FormField label="Nombre del remitente" value="Abogados a tu Servicio" />
                <FormField label="Plantilla por defecto" value="Recordatorio audiencia" />
                <FormField label="Idioma" value="Español (Perú)" />
              </div>
              <button className="mt-5 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110">Guardar cambios</button>
            </Card>
          )}

          {tab === "correo" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-sky-50 text-sky-600"><Mail className="h-6 w-6" /></div>
                <div>
                  <h3 className="text-base font-semibold">Configuración de correo</h3>
                  <p className="text-xs text-muted-foreground">Servidor SMTP para envío automático de notificaciones.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Servidor SMTP" value="smtp.abogados.pe" />
                <FormField label="Puerto" value="587" />
                <FormField label="Usuario" value="notificaciones@abogados.pe" />
                <FormField label="Encriptación" value="TLS" />
              </div>
            </Card>
          )}

          {tab === "plantillas" && (
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-1">Plantillas de documentos</h3>
              <p className="text-xs text-muted-foreground mb-5">Documentos preconfigurados para uso rápido.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {["Demanda de divorcio", "Demanda laboral", "Carta notarial", "Poder general", "Contrato de servicios", "Escrito de apelación"].map((t, i) => (
                  <div key={i} className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition cursor-pointer">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{t}</div>
                      <div className="text-[11px] text-muted-foreground">Plantilla DOCX · 12 variables</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Toggle({ label, desc, initial }: { label: string; desc: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <button onClick={() => setOn(!on)} className={`relative h-6 w-11 rounded-full transition ${on ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function FormField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input defaultValue={value} className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm" />
    </div>
  );
}
