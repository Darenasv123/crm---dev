import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  CreditCard,
  CalendarDays,
  FolderOpen,
  Settings,
  Bell,
  Scale,
  ChevronDown,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationsPanel } from "@/components/notifications-panel";
import { Chatbot } from "@/components/chatbot";
import { GlobalSearch } from "@/components/global-search";

const nav: { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/casos", label: "Casos", icon: Briefcase },
  { to: "/pagos", label: "Pagos", icon: CreditCard },
  { to: "/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/documentos", label: "Documentos", icon: FolderOpen },
  { to: "/configuracion", label: "Configuración", icon: Settings },
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

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  const displayName = profile?.full_name ?? "Usuario";
  const initials = profile?.initials ?? displayName.slice(0, 2).toUpperCase();
  const role = profile?.role ?? "";
  const urgentCount = notifications.filter(n => n.urgent).length;
  const totalCount = notifications.length;

  // Bottom nav items (5 most important for mobile)
  const bottomNav = [
    { to: "/", label: "Inicio", icon: LayoutDashboard, exact: true },
    { to: "/clientes", label: "Clientes", icon: Users },
    { to: "/casos", label: "Casos", icon: Briefcase },
    { to: "/agenda", label: "Agenda", icon: CalendarDays },
    { to: "/pagos", label: "Pagos", icon: CreditCard },
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
            <div className="text-sm font-semibold tracking-tight text-white truncate">Estudio Jurídico Arenas</div>
            <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60">Penal · Familia</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Menú principal</div>
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-sidebar-accent text-white shadow-soft border-l-2 border-gold"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                ].join(" ")}
              >
                <Icon className={`h-[18px] w-[18px] ${active ? "text-gold" : ""}`} />
                <span>{item.label}</span>
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
      <aside className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gold text-gold-foreground shrink-0">
              <Scale className="h-4 w-4" strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">Estudio Jurídico Arenas</div>
              <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Penal · Familia</div>
            </div>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-sidebar-accent/60 shrink-0">
            <X className="h-4 w-4 text-sidebar-foreground/70" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                onClick={() => setMobileMenuOpen(false)}
                className={[
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all",
                  active
                    ? "bg-sidebar-accent text-white shadow-soft border-l-2 border-gold"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                ].join(" ")}
              >
                <Icon className={`h-5 w-5 ${active ? "text-gold" : ""}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {/* User info at bottom of drawer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-white text-xs font-bold shrink-0">{initials}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">{displayName}</div>
              <div className="text-[11px] text-sidebar-foreground/60">{role}</div>
            </div>
            <button onClick={handleSignOut} title="Cerrar sesión" className="h-8 w-8 grid place-items-center rounded-lg hover:bg-red-500/20 text-sidebar-foreground/60 hover:text-red-400 transition">
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
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-muted/60 shrink-0"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>

            <GlobalSearch />

            <div className="flex items-center gap-1.5 ml-auto lg:ml-0">
              {/* Notifications bell */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen(v => !v)}
                  className="relative grid place-items-center h-9 w-9 rounded-lg bg-muted/60 hover:bg-muted transition"
                >
                  <Bell className="h-[18px] w-[18px] text-foreground/70" />
                  {totalCount > 0 && (
                    <span className={`absolute top-1 right-1 h-4 w-4 rounded-full text-[9px] font-bold grid place-items-center ring-2 ring-card
                      ${urgentCount > 0 ? "bg-red-500 text-white" : "bg-gold text-gold-foreground"}`}>
                      {totalCount > 9 ? "9+" : totalCount}
                    </span>
                  )}
                </button>
                <NotificationsPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
              </div>

              {/* User menu — desktop only */}
              <button className="hidden lg:flex items-center gap-2 h-10 pl-1 pr-2 rounded-lg hover:bg-muted/60 transition">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-white text-xs font-bold">{initials}</div>
                <div className="text-left leading-tight">
                  <div className="text-xs font-semibold">{displayName}</div>
                  <div className="text-[10px] text-muted-foreground">{role}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>

              {/* Logout — desktop only */}
              <button
                onClick={handleSignOut}
                title="Cerrar sesión"
                className="hidden lg:grid place-items-center h-10 w-10 rounded-lg bg-muted/60 hover:bg-red-50 hover:text-red-600 transition"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </header>

        {/* Page header */}
        <div className="px-4 lg:px-8 pt-5 pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-xl lg:text-2xl font-bold tracking-tight text-foreground">{title}</h1>
              {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
          </div>
        </div>

        <main className="flex-1 px-4 lg:px-8 py-4 lg:py-6 pb-24 lg:pb-6">{children}</main>

        <footer className="hidden lg:block px-8 py-4 text-xs text-muted-foreground border-t border-border">
          © 2026 Estudio Jurídico Arenas · Derecho Penal & Familia
        </footer>
      </div>

      {/* ── Bottom navigation — mobile only ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border safe-area-inset-bottom">
        <div className="grid grid-cols-5 h-16">
          {bottomNav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to as never}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
                  ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
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
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    gold: "bg-[oklch(0.96_0.04_85)] text-[oklch(0.45_0.1_75)] border-[oklch(0.85_0.08_80)]",
    navy: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-card border border-border shadow-soft ${className}`}>{children}</div>
  );
}
