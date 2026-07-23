import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients, useCreateClient } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { useAuth } from "@/hooks/use-auth";
import { exportClientsExcel } from "@/lib/export-excel";
import { CSVImport } from "@/components/csv-import";
import { ZipImport } from "@/components/zip-import";
import {
  Search,
  Download,
  Plus,
  ChevronDown,
  Eye,
  X,
  Loader2,
  FolderArchive,
  FileSpreadsheet,
} from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_app/clientes/")({
  head: () => ({
    meta: [{ title: "Clientes â€” Estudio JurÃ­dico" }],
  }),
  component: ClientsPage,
});

const STATUS_OPTIONS = ["Activo", "En espera", "Cerrado"] as const;

function ClientsPage() {
  const { data: clients = [], isLoading, refetch } = useClients();
  const { data: cases = [] } = useCases();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "Administrador";
  const createClient = useCreateClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [specialtyFilter, setSpecialtyFilter] = useState("Todos");

  const casesByClient = useMemo(() => {
    const map = new Map<string, typeof cases>();
    for (const item of cases) {
      const current = map.get(item.client_id) ?? [];
      current.push(item);
      map.set(item.client_id, current);
    }
    return map;
  }, [cases]);

  const specialtyOptions = useMemo(() => {
    const types = new Set<string>();
    for (const item of cases) {
      const base = (item.process_type || item.case_type || "").split(/\s*[—-]\s*/)[0].trim();
      if (base && base !== "Pendiente de clasificacion") types.add(base);
    }
    return ["Todos", ...Array.from(types).sort()];
  }, [cases]);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showZipImportModal, setShowZipImportModal] = useState(false);
  const [form, setForm] = useState({
    name: "",
    dni: "",
    document_type: "DNI",
    phone: "",
    whatsapp: "",
    email: "",
    occupation: "",
    process_type: "",
    status: "Activo" as const,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = clients.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.dni.includes(search) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "Todos" || c.status === statusFilter;
    const clientCases = casesByClient.get(c.id) ?? [];
    const matchSpecialty =
      specialtyFilter === "Todos" ||
      clientCases.some((item) =>
        (item.process_type || item.case_type || "")
          .toLowerCase()
          .includes(specialtyFilter.toLowerCase()),
      );
    return matchSearch && matchStatus && matchSpecialty;
  });
  function getCaseSummary(clientId: string) {
    const clientCases = casesByClient.get(clientId) ?? [];
    if (clientCases.length === 0) {
      return { title: "Pendiente de clasificacion", detail: "Sin expediente vinculado" };
    }
    const main = clientCases[0];
    return {
      title: `${clientCases.length} expediente${clientCases.length === 1 ? "" : "s"}`,
      detail: main.case_number || main.expediente || main.case_name || "Expediente sin numero",
    };
  }
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Validar DNI y telÃ©fono
    if (form.dni.length > 0 && form.dni.length !== 8) {
      setFormError("El DNI debe tener exactamente 8 dÃ­gitos.");
      return;
    }
    if (form.phone.length !== 9) {
      setFormError("El telÃ©fono debe tener exactamente 9 dÃ­gitos.");
      return;
    }
    const existingClient = form.dni ? clients.find((client) => client.dni === form.dni) : null;
    if (existingClient) {
      setFormError(
        `Ya existe un cliente registrado con el DNI ${form.dni}: ${existingClient.name}.`,
      );
      return;
    }

    setSaving(true);
    try {
      await createClient.mutateAsync({
        ...form,
        initials:
          form.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "CL",
        document_number: form.dni || null,
        whatsapp: form.whatsapp || form.phone,
      });
      setShowModal(false);
      setForm({
        name: "",
        dni: "",
        document_type: "DNI",
        phone: "",
        whatsapp: "",
        email: "",
        occupation: "",
        process_type: "",
        status: "Activo",
      });
    } catch (err: unknown) {
      // Mostrar el mensaje real de Supabase
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(msg || "Error al guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout
      title="GestiÃ³n de Clientes"
      subtitle={`${clients.length} clientes registrados Â· Penal & Familia`}
      actions={
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => exportClientsExcel(clients)}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
            >
              <Download className="h-4 w-4" /> Excel
            </button>
          )}
          <button
            onClick={() => setShowZipImportModal(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <FolderArchive className="h-4 w-4" /> Importar cliente desde ZIP
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <FileSpreadsheet className="h-4 w-4" /> Importar lista CSV/XLSX
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo Cliente
          </button>
        </div>
      }
    >
      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o DNI..."
              className="w-full h-10 pl-10 pr-3 rounded-lg bg-muted/40 border border-border focus:bg-card focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm"
            />
          </div>
          <FilterSelect
            value={specialtyFilter}
            onChange={setSpecialtyFilter}
            options={specialtyOptions}
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={["Todos", ...STATUS_OPTIONS]}
          />
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">DNI</th>
                  <th className="py-3 px-3 font-semibold">TelÃ©fono</th>
                  <th className="py-3 px-3 font-semibold">Expedientes</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 px-3 font-semibold">Registro</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                      {search ? "No se encontraron clientes." : "AÃºn no hay clientes registrados."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const caseSummary = getCaseSummary(c.id);
                    return (
                      <tr
                        key={c.id}
                        className="border-t border-border hover:bg-muted/30 transition"
                      >
                        <td className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white shrink-0"
                              style={{ background: c.color }}
                            >
                              {c.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{c.name}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {c.email ?? "â€”"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs">{c.dni}</td>
                        <td className="py-3 px-3 text-muted-foreground">{c.phone}</td>
                        <td className="py-3 px-3">
                          <span className="text-xs text-muted-foreground">
                            {c.process_type || "â€”"}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge
                            tone={
                              c.status === "Activo"
                                ? "success"
                                : c.status === "En espera"
                                  ? "warning"
                                  : "default"
                            }
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${c.status === "Activo" ? "bg-emerald-500" : c.status === "En espera" ? "bg-amber-500" : "bg-muted-foreground"}`}
                            />
                            {c.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {new Date(c.registered_at).toLocaleDateString("es-PE", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-3 pr-5 text-right">
                          <Link
                            to={"/clientes/$id" as never}
                            params={{ id: c.id } as never}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition"
                          >
                            <Eye className="h-3.5 w-3.5" /> Ver ficha
                          </Link>
                        </td>{" "}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
        {!isLoading && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
            <span>
              Mostrando {filtered.length} de {clients.length} clientes
            </span>
          </div>
        )}
      </Card>

      {/* New Client Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Nuevo cliente</h3>
                <p className="text-xs text-muted-foreground">Penal Â· Familia</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <MF
                label="Nombre completo *"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                required
              />
              <div className="grid grid-cols-2 gap-4">
                {/* DNI: solo 8 dÃ­gitos numÃ©ricos */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    DNI (opcional)
                  </label>
                  <input
                    inputMode="numeric"
                    pattern="([0-9]{8})?"
                    maxLength={8}
                    value={form.dni}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dni: e.target.value.replace(/\D/g, "").slice(0, 8) }))
                    }
                    placeholder="12345678"
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm font-mono"
                  />
                  {form.dni.length > 0 && form.dni.length < 8 && (
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      Faltan {8 - form.dni.length} dÃ­gitos
                    </p>
                  )}
                </div>
                {/* TelÃ©fono: solo 9 dÃ­gitos numÃ©ricos */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    TelÃ©fono *
                  </label>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{9}"
                    maxLength={9}
                    value={form.phone}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        phone: e.target.value.replace(/\D/g, "").slice(0, 9),
                      }))
                    }
                    required
                    placeholder="987654321"
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm font-mono"
                  />
                  {form.phone.length > 0 && form.phone.length < 9 && (
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      Faltan {9 - form.phone.length} dÃ­gitos
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MF
                  label="Tipo de documento"
                  value={form.document_type}
                  onChange={(v) => setForm((f) => ({ ...f, document_type: v }))}
                />
                <MF
                  label="WhatsApp"
                  value={form.whatsapp}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, whatsapp: v.replace(/\D/g, "").slice(0, 9) }))
                  }
                />
              </div>
              <MF
                label="Correo electrÃ³nico"
                value={form.email}
                onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                type="email"
              />
              <MF
                label="OcupaciÃ³n"
                value={form.occupation}
                onChange={(v) => setForm((f) => ({ ...f, occupation: v }))}
              />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Proceso *
                </label>
                <input
                  type="text"
                  value={form.process_type}
                  onChange={(e) => setForm((f) => ({ ...f, process_type: e.target.value }))}
                  required
                  placeholder="Ej: Defensa penal por robo agravado"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado *
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as typeof form.status }))
                  }
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Guardando..." : "Guardar cliente"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <CSVImport
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            refetch();
          }}
        />
      )}

      {/* ZIP Import Modal */}
      {showZipImportModal && (
        <ZipImport
          onClose={() => setShowZipImportModal(false)}
          onSuccess={() => {
            refetch();
          }}
        />
      )}
    </AppLayout>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 pl-3 pr-9 rounded-lg bg-card border border-border text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function MF({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}
