import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Scale, Eye, EyeOff, Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Iniciar sesión — CRM Jurídico" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the user is already logged in, redirect to dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/" });
    }
  }, [user, loading, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email, password);
    setSubmitting(false);
    if (signInError) {
      // Show the actual error in dev; generic message in production
      setError("Correo o contraseña incorrectos. Intenta de nuevo.");
      console.error("Sign-in error:", signInError);
    }
    // On success: onAuthStateChange in use-auth.tsx will update `user`,
    // triggering the useEffect above which will navigate to "/".
  }

  // While loading initial session, show nothing to avoid flicker
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Already logged in — the effect will navigate, show nothing
  if (user) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gold text-gold-foreground shadow-soft mb-4">
            <Scale className="h-7 w-7" strokeWidth={2.2} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Estudio Jurídico Arenas</h1>
          <p className="text-sm text-muted-foreground mt-1">Derecho Penal & Familia · Acceso privado</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-card border border-border shadow-soft p-8">
          <h2 className="text-lg font-semibold mb-1">Iniciar sesión</h2>
          <p className="text-sm text-muted-foreground mb-6">Ingresa con tu cuenta del estudio</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="nombre@abogados.pe"
                required
                autoComplete="email"
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm transition"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Contraseña
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Tu contraseña"
                  required
                  autoComplete="current-password"
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 active:scale-[0.99] transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Ingresando..." : "Ingresar al sistema"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          ¿No tienes cuenta? Contacta al administrador del estudio.
        </p>
      </div>
    </div>
  );
}
