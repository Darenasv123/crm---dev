import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CreditCard,
  ClipboardList,
  CalendarDays,
  FolderOpen,
  Settings,
  Bell,
  Scale,
  LogOut,
  Menu,
  X,
  ExternalLink,
  ListTodo,
  MoreHorizontal,
} from "lucide-react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationsPanel } from "@/components/notifications-panel";
import { Chatbot } from "@/components/chatbot";
import { GlobalSearch } from "@/components/global-search";
import { usePendingTaskSummary } from "@/hooks/use-daily-tasks";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  adminOnly?: boolean;
};

const nav: NavItem[] = [
  { to: "/", label: "Inicio", icon: LayoutDashboard, exact: true },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/casos", label: "Expedientes", icon: Briefcase },
  { to: "/tareas", label: "Tareas", icon: ListTodo },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/documentos", label: "Documentos", icon: FolderOpen },
  { to: "/pagos", label: "Pagos", icon: CreditCard, adminOnly: true },
  { to: "/reportes", label: "Reportes", icon: ClipboardList },
  { to: "/configuracion", label: "Configuración", icon: Settings, adminOnly: true },
];

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppLayout({ children, title, subtitle, actions }: AppLayoutProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { attentionCount: taskAttentionCount } = usePendingTaskSummary();
  // QA-008: el badge no es "total de tareas" — es "lo que requiere tu
  // atención ahora" (Admin: disponibles sin tomar; Personal: asignadas a mí).
  // El texto explícito evita que se confunda con el Total de la pestaña Todas,
  // que cuenta algo distinto (todas las tareas de la fecha seleccionada).
  const taskAttentionHint =
    profile?.role === "Administrador"
      ? "Tareas disponibles sin tomar, de cualquier fecha"
      : "Tareas asignadas a mí, de cualquier fecha";

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const displayName = profile?.full_name ?? "Usuario";
  const initials = profile?.initials ?? displayName.slice(0, 2).toUpperCase();
  const role = profile?.role ?? "";
  const isAdmin = role === "Administrador";
  const urgentCount = notifications.filter((n) => n.urgent).length;
  const totalCount = notifications.length;

  // Filter nav items based on role
  const visibleNav = nav.filter((item) => !item.adminOnly || isAdmin);

  // Four primary mobile destinations; the fifth slot opens the full menu.
  const bottomNav = [
    { to: "/", label: "Inicio", icon: LayoutDashboard, exact: true },
    { to: "/clientes", label: "Clientes", icon: Users },
    { to: "/tareas", label: "Tareas", icon: ListTodo },
    { to: "/agenda", label: "Agenda", icon: CalendarDays },
  ];

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* ── Sidebar desktop ── */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-gold-foreground shadow-soft">
            <Scale className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight text-white truncate">
              Estudio Jurídico Arenas
            </div>
            <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
              Penal · Familia
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Menú principal
          </div>
          {visibleNav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-sidebar-accent text-white shadow-soft ring-1 ring-inset ring-sidebar-border"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                ].join(" ")}
              >
                <Icon
                  className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? "text-gold" : "text-sidebar-foreground/60 group-hover:text-white"}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                {item.to === "/tareas" && taskAttentionCount > 0 && (
                  <span
                    aria-label={`${taskAttentionCount} tareas requieren atención: ${taskAttentionHint}`}
                    title={taskAttentionHint}
                    className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-[10px] font-bold text-destructive-foreground"
                  >
                    {taskAttentionCount > 99 ? "99+" : taskAttentionCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gold text-gold-foreground shrink-0">
              <Scale className="h-4 w-4" strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                Estudio Jurídico Arenas
              </div>
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Penal · Familia
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-sidebar-accent/60 shrink-0"
            aria-label="Cerrar menú"
          >
            <X className="h-4 w-4 text-sidebar-foreground/70" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all",
                  active
                    ? "bg-sidebar-accent text-white shadow-soft ring-1 ring-inset ring-sidebar-border"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                ].join(" ")}
              >
                <Icon className={`h-5 w-5 ${active ? "text-gold" : ""}`} />
                <span>{item.label}</span>
                {item.to === "/tareas" && taskAttentionCount > 0 && (
                  <span
                    aria-label={`${taskAttentionCount} tareas requieren atención: ${taskAttentionHint}`}
                    title={taskAttentionHint}
                    className="ml-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-[10px] font-bold text-destructive-foreground"
                  >
                    {taskAttentionCount > 99 ? "99+" : taskAttentionCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        {/* User info at bottom of drawer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <a
            href="https://cej.pj.gob.pe/cej/forms/busquedaform.html"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Consultar expediente en el Portal del Poder Judicial"
            className="flex items-center gap-2 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white transition mb-2"
          >
            <ExternalLink className="h-5 w-5" />
            Consultar expediente (CEJ)
          </a>
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">{displayName}</div>
              <div className="text-[11px] text-sidebar-foreground/60">{role}</div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Cerrar sesión"
              className="h-8 w-8 grid place-items-center rounded-lg text-sidebar-foreground/60 transition hover:bg-destructive/20 hover:text-destructive-foreground"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 lg:px-8 h-14 lg:h-16">
            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-muted/60 shrink-0"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>

            <GlobalSearch />

            <div className="flex items-center gap-1.5 ml-auto lg:ml-0">
              {/* Botón CEJ — Consultar expediente */}
              <a
                href="https://cej.pj.gob.pe/cej/forms/busquedaform.html"
                target="_blank"
                rel="noopener noreferrer"
                title="Consultar expediente en el CEJ"
                aria-label="Consultar expediente en el Portal del Poder Judicial"
                className="hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-muted/60 hover:bg-primary/10 hover:text-primary text-sm font-medium transition"
              >
                <ExternalLink className="h-[16px] w-[16px]" />
                <span>Consultar expediente</span>
              </a>

              {/* Notifications bell */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotifOpen((v) => !v)}
                  className="relative grid place-items-center h-9 w-9 rounded-lg bg-muted/60 hover:bg-muted transition"
                  aria-label="Ver notificaciones"
                >
                  <Bell className="h-[18px] w-[18px] text-foreground/70" />
                  {totalCount > 0 && (
                    <span
                      className={`absolute top-1 right-1 h-4 w-4 rounded-full text-[9px] font-bold grid place-items-center ring-2 ring-card
                      ${urgentCount > 0 ? "bg-destructive text-destructive-foreground" : "bg-gold text-gold-foreground"}`}
                    >
                      {totalCount > 9 ? "9+" : totalCount}
                    </span>
                  )}
                </button>
                <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
              </div>

              {/* User menu — desktop only */}
              <div className="hidden lg:flex items-center gap-2 h-10 pl-1 pr-2 rounded-lg">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {initials}
                </div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-semibold">{displayName}</div>
                  <div className="text-[10px] text-muted-foreground">{role}</div>
                </div>
              </div>

              {/* Logout — desktop only */}
              <button
                type="button"
                onClick={handleSignOut}
                title="Cerrar sesión"
                className="hidden lg:grid h-10 w-10 place-items-center rounded-lg bg-muted/60 transition hover:bg-destructive/10 hover:text-destructive"
                aria-label="Cerrar sesión"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </header>

        {/* Page header */}
        <div className="border-b border-border/70 bg-card/45 px-4 py-4 lg:px-8 lg:py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl lg:text-2xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
              {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
          </div>
        </div>

        <main className="flex-1 px-4 py-4 pb-24 lg:px-8 lg:py-6 lg:pb-6">{children}</main>

        <footer className="hidden lg:block px-8 py-4 text-xs text-muted-foreground border-t border-border">
          © 2026 Estudio Jurídico Arenas · Derecho Penal & Familia
        </footer>
      </div>

      <nav
        aria-label="Navegación principal móvil"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border safe-area-inset-bottom"
      >
        <div className="grid grid-cols-5 h-16">
          {bottomNav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors min-h-[44px]
                  ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
                <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                {item.to === "/tareas" && taskAttentionCount > 0 && (
                  <span
                    aria-label={`${taskAttentionCount} tareas requieren atención: ${taskAttentionHint}`}
                    title={taskAttentionHint}
                    className="absolute ml-5 mt-[-24px] min-w-4 rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground"
                  >
                    {taskAttentionCount > 9 ? "9+" : taskAttentionCount}
                  </span>
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menú completo"
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground min-h-[44px]"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            <span>Más</span>
          </button>
        </div>
      </nav>

      {/* Chatbot — visible en todas las páginas del CRM */}
      <Chatbot />
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info" | "gold" | "navy";
}) {
  const tones: Record<string, string> = {
    default: "bg-muted text-foreground/80 border-border",
    success: "bg-success/10 text-success-foreground border-success/25",
    warning: "bg-warning/14 text-warning-foreground border-warning/30",
    danger: "bg-destructive/10 text-destructive border-destructive/25",
    info: "bg-info/10 text-info-foreground border-info/25",
    gold: "bg-[oklch(0.96_0.04_85)] text-[oklch(0.45_0.1_75)] border-[oklch(0.85_0.08_80)]",
    navy: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone] ?? tones.default}`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={`rounded-xl bg-card border border-border shadow-soft ${className}`} {...props}>
      {children}
    </div>
  );
}
