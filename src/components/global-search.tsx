import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  Users,
  Briefcase,
  FileText,
  X,
  Loader2,
  CalendarDays,
  CreditCard,
  ClipboardList,
} from "lucide-react";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { useAuth } from "@/hooks/use-auth";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";

interface SearchResult {
  id: string;
  type: "client" | "case" | "document" | "report" | "event" | "payment" | "party" | "case_event";
  title: string;
  subtitle: string;
  href: string;
}

type ClientSearchRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "name" | "dni" | "process_type" | "status"
>;
type CaseSearchRow = Pick<
  Database["public"]["Tables"]["cases"]["Row"],
  "id" | "expediente" | "process_type" | "status" | "internal_code" | "case_number"
> & { clients?: { name: string } | null };
type DocumentSearchRow = Pick<
  Database["public"]["Tables"]["documents"]["Row"],
  "id" | "name" | "type"
> & { clients?: { name: string } | null };
type ReportSearchRow = Pick<
  Database["public"]["Tables"]["client_reports"]["Row"],
  "id" | "title" | "category"
> & { clients?: { name: string } | null; cases?: { expediente: string } | null };
type EventSearchRow = Pick<
  Database["public"]["Tables"]["agenda_events"]["Row"],
  "id" | "title" | "type" | "event_date" | "event_time"
> & { clients?: { name: string } | null; cases?: { expediente: string } | null };
type PaymentSearchRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "id" | "service" | "status"
> & { clients?: { name: string } | null };
type PartySearchRow = Pick<
  Database["public"]["Tables"]["case_parties"]["Row"],
  "id" | "case_id" | "full_name" | "role" | "document_number"
>;
type CaseEventSearchRow = Pick<
  Database["public"]["Tables"]["case_events"]["Row"],
  "id" | "case_id" | "title" | "event_type" | "event_date"
>;

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canSearchPayments = profile?.role === "Administrador";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Keyboard shortcut Ctrl+K
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const db = await getAuthClient();
        const term = q.trim();

        const [
          clientsRes,
          casesRes,
          docsRes,
          reportsRes,
          eventsRes,
          paymentsRes,
          partiesRes,
          caseEventsRes,
        ] = await Promise.all([
          db
            .from("clients")
            .select("id, name, dni, process_type, status")
            .or(`name.ilike.%${term}%,dni.ilike.%${term}%,email.ilike.%${term}%`)
            .limit(4),
          (async () => {
            const expanded = await db
              .from("cases")
              .select(
                "id, expediente, process_type, status, internal_code, case_number, clients(name)",
              )
              .or(
                `expediente.ilike.%${term}%,process_type.ilike.%${term}%,internal_code.ilike.%${term}%,case_number.ilike.%${term}%,next_action.ilike.%${term}%`,
              )
              .limit(4);

            if (!isMissingSchemaFieldError(expanded.error)) return expanded;

            return db
              .from("cases")
              .select("id, expediente, process_type, status, clients(name)")
              .or(`expediente.ilike.%${term}%,process_type.ilike.%${term}%`)
              .limit(4);
          })(),
          db
            .from("documents")
            .select("id, name, type, clients(name)")
            .ilike("name", `%${term}%`)
            .limit(3),
          db
            .from("client_reports")
            .select("id, title, category, clients(name), cases(expediente)")
            .or(`title.ilike.%${term}%,body.ilike.%${term}%`)
            .limit(3),
          db
            .from("agenda_events")
            .select("id, title, type, event_date, event_time, clients(name), cases(expediente)")
            .or(`title.ilike.%${term}%,location.ilike.%${term}%`)
            .limit(3),
          canSearchPayments
            ? db
                .from("payments")
                .select("id, service, status, clients(name)")
                .ilike("service", `%${term}%`)
                .limit(3)
            : Promise.resolve({ data: [] }),
          db
            .from("case_parties")
            .select("id, case_id, full_name, role, document_number")
            .or(`full_name.ilike.%${term}%,document_number.ilike.%${term}%`)
            .limit(3),
          db
            .from("case_events")
            .select("id, case_id, title, event_type, event_date")
            .or(`title.ilike.%${term}%,description.ilike.%${term}%,source_excerpt.ilike.%${term}%`)
            .limit(3),
        ]);

        const clientRows = (clientsRes.data ?? []) as ClientSearchRow[];
        const caseRows = (casesRes.data ?? []) as CaseSearchRow[];
        const documentRows = (docsRes.data ?? []) as DocumentSearchRow[];
        const reportRows = (reportsRes.data ?? []) as ReportSearchRow[];
        const eventRows = (eventsRes.data ?? []) as EventSearchRow[];
        const paymentRows = (paymentsRes.data ?? []) as PaymentSearchRow[];
        const partyRows = (partiesRes.data ?? []) as PartySearchRow[];
        const caseEventRows = (caseEventsRes.data ?? []) as CaseEventSearchRow[];

        const combined: SearchResult[] = [
          ...clientRows.map((c) => ({
            id: c.id,
            type: "client" as const,
            title: c.name,
            subtitle: `DNI: ${c.dni} · ${c.process_type} · ${c.status}`,
            href: `/clientes/${c.id}`,
          })),
          ...caseRows.map((c) => ({
            id: c.id,
            type: "case" as const,
            title: c.expediente,
            subtitle: `${c.process_type} · ${c.status}${(c as { clients?: { name: string } | null }).clients?.name ? ` · ${(c as { clients?: { name: string } | null }).clients!.name}` : ""}`,
            href: `/casos/${c.id}`,
          })),
          ...documentRows.map((d) => ({
            id: d.id,
            type: "document" as const,
            title: d.name,
            subtitle: `${d.type}${(d as { clients?: { name: string } | null }).clients?.name ? ` · ${(d as { clients?: { name: string } | null }).clients!.name}` : ""}`,
            href: `/documentos`,
          })),
          ...reportRows.map((r) => ({
            id: r.id,
            type: "report" as const,
            title: r.title,
            subtitle: `${r.category}${r.clients?.name ? ` · ${r.clients.name}` : ""}${r.cases?.expediente ? ` · ${r.cases.expediente}` : ""}`,
            href: `/reportes`,
          })),
          ...eventRows.map((e) => ({
            id: e.id,
            type: "event" as const,
            title: e.title,
            subtitle: `${e.type} · ${e.event_date} ${String(e.event_time).slice(0, 5)}${e.clients?.name ? ` · ${e.clients.name}` : ""}`,
            href: `/agenda`,
          })),
          ...paymentRows.map((p) => ({
            id: p.id,
            type: "payment" as const,
            title: p.service,
            subtitle: `${p.status}${p.clients?.name ? ` · ${p.clients.name}` : ""}`,
            href: `/pagos`,
          })),
          ...partyRows.map((party) => ({
            id: party.id,
            type: "party" as const,
            title: party.full_name,
            subtitle: `${party.role}${party.document_number ? ` · ${party.document_number}` : ""}`,
            href: `/casos/${party.case_id}`,
          })),
          ...caseEventRows.map((event) => ({
            id: event.id,
            type: "case_event" as const,
            title: event.title,
            subtitle: `${event.event_type} · ${event.event_date}`,
            href: `/casos/${event.case_id}`,
          })),
        ];

        setResults(combined);
        setSelected(0);
      } catch (_) {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [canSearchPayments],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length >= 2) {
      setLoading(true);
      debounceRef.current = setTimeout(() => search(v), 300);
    } else {
      setResults([]);
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    }
    if (e.key === "Enter" && results[selected]) {
      navigate({ to: results[selected].href as never });
      setOpen(false);
      setQuery("");
    }
  }

  function handleSelect(r: SearchResult) {
    navigate({ to: r.href as never });
    setOpen(false);
    setQuery("");
  }

  const icons = {
    client: <Users className="h-4 w-4 text-primary" />,
    case: <Briefcase className="h-4 w-4 text-amber-600" />,
    document: <FileText className="h-4 w-4 text-red-500" />,
    report: <ClipboardList className="h-4 w-4 text-primary" />,
    event: <CalendarDays className="h-4 w-4 text-emerald-600" />,
    payment: <CreditCard className="h-4 w-4 text-sky-600" />,
    party: <Users className="h-4 w-4 text-violet-600" />,
    case_event: <CalendarDays className="h-4 w-4 text-amber-600" />,
  };

  const labels = {
    client: "Cliente",
    case: "Caso",
    document: "Documento",
    report: "Reporte",
    event: "Agenda",
    payment: "Pago",
    party: "Parte",
    case_event: "Actuación",
  };
  const labelClass = {
    client: "bg-primary/10 text-primary",
    case: "bg-amber-50 text-amber-700",
    document: "bg-red-50 text-red-600",
    report: "bg-primary/10 text-primary",
    event: "bg-emerald-50 text-emerald-700",
    payment: "bg-sky-50 text-sky-700",
    party: "bg-violet-50 text-violet-700",
    case_event: "bg-amber-50 text-amber-700",
  };

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        placeholder="Buscar clientes, expedientes, documentos, reportes... (Ctrl+K)"
        className="w-full h-10 pl-10 pr-10 rounded-lg bg-muted/60 border border-transparent focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm placeholder:text-muted-foreground transition"
      />
      {/* Loading / clear */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        {loading ? (
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        ) : query ? (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
            }}
          >
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        ) : null}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1.5 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
          {results.length === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No se encontraron resultados para "{query}"
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    onClick={() => handleSelect(r)}
                    onMouseEnter={() => setSelected(i)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${i === selected ? "bg-primary/5" : "hover:bg-muted/40"} ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted/60">
                      {icons[r.type]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{r.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0
                      ${labelClass[r.type]}`}
                    >
                      {labels[r.type]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>↑↓ navegar</span>
            <span>Enter seleccionar</span>
            <span>Esc cerrar</span>
          </div>
        </div>
      )}
    </div>
  );
}
