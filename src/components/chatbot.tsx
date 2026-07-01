import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, Bot, User, Sparkles, ChevronDown } from "lucide-react";
import type { ChatContext, ChatHistoryTurn } from "@/lib/ai";
import { checkAIStatus, sendChatMessage } from "@/lib/ai.functions";
import { useAuth } from "@/hooks/use-auth";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { useAgendaEvents, useCreateAgendaEvent } from "@/hooks/use-agenda";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  "¿Qué audiencias tengo hoy?",
  "Resume los casos activos",
  "Redacta un correo de recordatorio de audiencia",
  "¿Cuántos clientes activos hay?",
];

const WELCOME_CONFIGURED = `¡Hola! Soy tu asistente jurídico 👋

Puedo ayudarte con:
• Consultar tu agenda y audiencias
• Redactar correos y comunicaciones
• Información sobre clientes y casos
• Programar citas y recordatorios

¿En qué te puedo ayudar hoy?`;

export function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { session } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const { data: payments = [] } = usePayments();
  const { data: events = [] } = useAgendaEvents();
  const createEvent = useCreateAgendaEvent();

  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter(e => e.event_date === today);
  const upcomingEvents = events.filter(e => e.event_date > today).slice(0, 10);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAiReady(null);
    checkAIStatus()
      .then(({ configured, error }) => {
        if (cancelled) return;
        setAiReady(configured);
        setApiKeyMissing(!configured);
        setMessages(prev => {
          if (prev.length > 0) return prev;
          return [{
            role: "assistant",
            content: configured
              ? WELCOME_CONFIGURED
              : `¡Hola! Soy tu asistente jurídico 👋\n\n⚠️ ${error ?? "Falta configurar GROQ_API_KEY en el servidor."}`,
            timestamp: new Date(),
          }];
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAiReady(false);
          setApiKeyMissing(true);
        }
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildContext(): ChatContext {
    return {
      clientsCount: clients.length,
      activeCasesCount: cases.filter(c => c.status !== "Archivado").length,
      todayEvents: todayEvents.map(e => ({
        title: e.title,
        time: e.event_time,
        type: e.type,
        client: (e as { clients?: { name: string } | null }).clients?.name,
      })),
      upcomingEvents: upcomingEvents.map(e => ({
        title: e.title,
        date: e.event_date,
        time: e.event_time,
        type: e.type,
        client: (e as { clients?: { name: string } | null }).clients?.name,
      })),
      recentClients: clients.slice(0, 8).map(c => ({
        name: c.name,
        process_type: c.process_type,
        status: c.status,
      })),
      recentCases: cases.filter(c => c.status !== "Archivado").slice(0, 8).map(c => ({
        expediente: c.expediente,
        process_type: c.process_type,
        status: c.status,
        juzgado: c.juzgado,
        client: (c as { clients?: { name: string } | null }).clients?.name ?? "—",
      })),
      pendingPayments: payments
        .filter(p => p.status !== "Pagado")
        .slice(0, 6)
        .map(p => ({
          client: (p as { clients?: { name: string } | null }).clients?.name ?? "—",
          service: p.service,
          pending: Number(p.fees) - Number(p.paid),
          status: p.status,
        })),
    };
  }

  function buildHistory(priorMessages: Message[]): ChatHistoryTurn[] {
    return priorMessages
      .slice(1)
      .map(m => ({ role: m.role, content: m.content }));
  }

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const accessToken = session?.access_token;
    if (!accessToken) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "❌ Sesión expirada. Cierra sesión e ingresa de nuevo.",
        timestamp: new Date(),
      }]);
      return;
    }

    setInput("");
    const priorMessages = messages;
    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: new Date() }]);
    setLoading(true);

    try {
      if (apiKeyMissing) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "⚠️ Falta configurar GROQ_API_KEY en el servidor. Revisa `.env` y reinicia el servidor.",
          timestamp: new Date(),
        }]);
        return;
      }

      const { text: responseText } = await sendChatMessage({
        data: {
          accessToken,
          message: msg,
          history: buildHistory(priorMessages),
          context: buildContext(),
        },
      });

      const actionMatch = responseText.match(/\{[\s\S]*"action"\s*:\s*"create_event"[\s\S]*\}/);
      if (actionMatch) {
        try {
          const action = JSON.parse(actionMatch[0]);
          if (action.action === "create_event") {
            await createEvent.mutateAsync({
              title: action.title,
              type: action.type as "Audiencia" | "Cita" | "Recordatorio",
              event_date: action.date,
              event_time: action.time,
              location: action.location ?? null,
              client_id: null,
            });
            setMessages(prev => [...prev, {
              role: "assistant",
              content: `✅ Evento creado: **${action.title}** el ${action.date} a las ${action.time}. Puedes verlo en la agenda.`,
              timestamp: new Date(),
            }]);
            return;
          }
        } catch { /* fallthrough */ }
      }

      setMessages(prev => [...prev, { role: "assistant", content: responseText, timestamp: new Date() }]);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Error al conectar con el asistente.";
      setMessages(prev => [...prev, {
        role: "assistant",
        content: raw.startsWith("❌") ? raw : `❌ ${raw}`,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className={`fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-xl flex items-center justify-center transition-all
          ${open ? "bg-muted text-foreground" : "bg-primary text-primary-foreground hover:brightness-110"}`}
        title="Asistente jurídico"
      >
        {open ? <ChevronDown className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[600px] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-gradient-to-r from-primary to-[oklch(0.28_0.07_255)]">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">Asistente Jurídico</div>
              <div className="text-[11px] text-white/70 flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${apiKeyMissing ? "bg-amber-400" : "bg-emerald-400"}`} />
                {apiKeyMissing ? "API key no configurada" : "Powered by Groq · Llama 3.3"}
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="h-8 w-8 grid place-items-center rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 max-h-[400px]">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold
                  ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                  ${m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted text-foreground rounded-tl-sm"}`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-2.5">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted">
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 && !apiKeyMissing && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => handleSend(p)}
                  disabled={loading}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition disabled:opacity-40"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 px-4 py-3 border-t border-border">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe un mensaje..."
              rows={1}
              disabled={apiKeyMissing}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground max-h-24 overflow-auto disabled:opacity-50"
              style={{ scrollbarWidth: "none" }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading || apiKeyMissing}
              className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-40 transition"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
