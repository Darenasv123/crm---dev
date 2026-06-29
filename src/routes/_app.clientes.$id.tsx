import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { cases, clients, currency, paymentHistory, payments, documents } from "@/lib/mock-data";
import { ArrowLeft, Edit3, CreditCard, FileUp, Briefcase, Phone, Mail, MapPin, Cake, Heart, IdCard, Calendar, FileText, Download } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/clientes/$id")({
  loader: ({ params }) => {
    const client = clients.find(c => c.id === params.id);
    if (!client) throw notFound();
    return { client };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.client.name ?? "Cliente"} — CRM Jurídico` }],
  }),
  component: ClientDetail,
});

const TABS = ["Información", "Casos", "Pagos", "Documentos", "Historial"] as const;
type Tab = typeof TABS[number];

function ClientDetail() {
  const { client } = Route.useLoaderData();
  const [tab, setTab] = useState<Tab>("Información");
  const clientCases = cases.filter(c => c.clientId === client.id);
  const clientPayments = payments.filter(p => p.clientId === client.id);
  const clientDocs = documents.filter(d => d.client === client.name || d.client === client.name.split(" ").slice(0, 2).join(" "));

  return (
    <AppLayout
      title={client.name}
      subtitle={`Cliente desde ${new Date(client.registeredAt).toLocaleDateString("es-PE", { month: "long", year: "numeric" })}`}
      actions={
        <Link to={"/clientes" as never} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Profile card */}
        <div className="space-y-4">
          <Card className="p-6 text-center">
            <div className="grid h-24 w-24 mx-auto place-items-center rounded-full text-3xl font-bold text-white shadow-card" style={{ background: client.color }}>
              {client.initials}
            </div>
            <h2 className="mt-4 text-lg font-bold">{client.name}</h2>
            <p className="text-xs text-muted-foreground">{client.processType} · {client.lawyer}</p>
            <div className="mt-3 flex justify-center">
              <StatusBadge tone={client.status === "Activo" ? "success" : client.status === "En espera" ? "warning" : "default"}>
                {client.status}
              </StatusBadge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110">
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </button>
              <button className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-gold text-gold-foreground text-xs font-semibold hover:brightness-105">
                <CreditCard className="h-3.5 w-3.5" /> Pago
              </button>
              <button className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60">
                <FileUp className="h-3.5 w-3.5" /> Documento
              </button>
              <button className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60">
                <Briefcase className="h-3.5 w-3.5" /> Caso
              </button>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contacto</h3>
            <ul className="space-y-3 text-sm">
              <InfoRow icon={Phone} label="Teléfono" value={client.phone} />
              <InfoRow icon={Mail} label="Correo" value={client.email} />
              <InfoRow icon={MapPin} label="Dirección" value={client.address} />
              <InfoRow icon={IdCard} label="DNI / RUC" value={client.dni} />
              <InfoRow icon={Cake} label="Fecha de nacimiento" value={client.birthdate} />
              <InfoRow icon={Heart} label="Estado civil" value={client.civilStatus} />
            </ul>
          </Card>
        </div>

        {/* Tabs + content */}
        <div>
          <div className="flex items-center gap-1 border-b border-border mb-6">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-4 py-3 text-sm font-semibold transition ${tab === t ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
                {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" />}
              </button>
            ))}
          </div>

          {tab === "Información" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-3">Datos generales</h4>
                <dl className="space-y-2 text-sm">
                  <DataRow k="Nombre completo" v={client.name} />
                  <DataRow k="DNI / RUC" v={client.dni} />
                  <DataRow k="Estado civil" v={client.civilStatus} />
                  <DataRow k="Fecha nacimiento" v={client.birthdate} />
                  <DataRow k="Abogado asignado" v={client.lawyer} />
                </dl>
              </Card>
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-3">Resumen jurídico</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat n={clientCases.length} l="Casos" />
                  <Stat n={clientPayments.length} l="Pagos" />
                  <Stat n={clientDocs.length} l="Docs" />
                </div>
                <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
                  Cliente con buen historial. Prioridad alta en seguimiento de audiencias programadas.
                </p>
              </Card>
            </div>
          )}

          {tab === "Casos" && (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th className="py-3 px-4">Expediente</th><th className="py-3 px-4">Proceso</th><th className="py-3 px-4">Estado</th><th className="py-3 px-4">Próxima audiencia</th></tr></thead>
                <tbody>
                  {clientCases.map(c => (
                    <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                      <td className="py-3 px-4 font-mono text-xs">{c.expediente}</td>
                      <td className="py-3 px-4">{c.processType}</td>
                      <td className="py-3 px-4"><StatusBadge tone="navy">{c.status}</StatusBadge></td>
                      <td className="py-3 px-4 text-muted-foreground">{c.nextHearing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {tab === "Pagos" && (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><th className="py-3 px-4">Servicio</th><th className="py-3 px-4">Honorarios</th><th className="py-3 px-4">Pagado</th><th className="py-3 px-4">Estado</th></tr></thead>
                <tbody>
                  {clientPayments.map(p => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-3 px-4">{p.service}</td>
                      <td className="py-3 px-4 font-semibold">{currency(p.fees)}</td>
                      <td className="py-3 px-4">{currency(p.paid)}</td>
                      <td className="py-3 px-4"><StatusBadge tone={p.status === "Pagado" ? "success" : p.status === "Vencido" ? "danger" : "warning"}>{p.status}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {tab === "Documentos" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {clientDocs.length === 0 && <p className="text-sm text-muted-foreground">No hay documentos asociados.</p>}
              {clientDocs.map(d => (
                <Card key={d.id} className="p-4 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.type} · {d.size}</div>
                  </div>
                  <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"><Download className="h-4 w-4" /></button>
                </Card>
              ))}
            </div>
          )}

          {tab === "Historial" && (
            <Card className="p-6">
              <ol className="relative space-y-5 ml-2">
                {[
                  { d: "29 Jun 2026", t: "Audiencia confirmada", desc: "Caso 00231-2025 — citación notificada." },
                  { d: "15 May 2026", t: "Pago registrado", desc: "S/ 1,500 vía transferencia BCP." },
                  { d: "02 Mar 2026", t: "Documento agregado", desc: "Demanda de divorcio (PDF)." },
                  { d: "12 Feb 2025", t: "Cliente registrado", desc: "Alta en el sistema por Dr. Ramírez." },
                ].map((h, i, a) => (
                  <li key={i} className="relative pl-8">
                    {i !== a.length - 1 && <span className="absolute left-2.5 top-7 bottom-[-1.25rem] w-px bg-border" />}
                    <span className="absolute left-0 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary/10 border border-primary/20"><Calendar className="h-2.5 w-2.5 text-primary" /></span>
                    <div className="text-sm font-semibold">{h.t}</div>
                    <p className="text-xs text-muted-foreground">{h.desc}</p>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{h.d}</div>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted/60"><Icon className="h-4 w-4 text-muted-foreground" /></div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </li>
  );
}
function DataRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-sm font-medium text-right truncate">{v}</dd>
    </div>
  );
}
function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-3">
      <div className="text-2xl font-bold text-primary">{n}</div>
      <div className="text-[11px] text-muted-foreground">{l}</div>
    </div>
  );
}
