import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPasswordRecoveryEnabled } from "@/lib/feature-flags";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/recuperar-contrasena")({ component: PasswordRecoveryPage });

function PasswordRecoveryPage() {
  const recoveryEnabled = isPasswordRecoveryEnabled();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Fail-closed guard: even if this handler were reached while the
    // feature is disabled, never call resetPasswordForEmail.
    if (!recoveryEnabled) return;
    setError(null);
    setSending(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/restablecer-contrasena`,
      });
      if (resetError) {
        setError("No pudimos enviar el enlace en este momento. Inténtalo nuevamente más tarde.");
        return;
      }
      setSent(true);
    } catch {
      setError("No pudimos enviar el enlace en este momento. Inténtalo nuevamente más tarde.");
    } finally {
      setSending(false);
    }
  }

  if (!recoveryEnabled) {
    return (
      <AuthShell
        title="Función no disponible"
        description="La recuperación de contraseña está deshabilitada temporalmente."
      >
        <div className="grid gap-4">
          <p className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
            Esta función no está disponible en este momento. Contacta al administrador del estudio
            para restablecer tu contraseña.
          </p>
          <Button asChild variant="outline">
            <Link to="/login">Volver al inicio de sesión</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recuperar contraseña"
      description="Te enviaremos un enlace temporal para crear una contraseña nueva."
    >
      {sent ? (
        <div className="grid gap-4">
          <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
            Si el correo corresponde a una cuenta, recibirás las instrucciones en unos minutos.
          </p>
          <Button asChild variant="outline">
            <Link to="/login">Volver al inicio de sesión</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div>
            <Label htmlFor="recovery-email">Correo electrónico</Label>
            <div className="relative mt-2">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="recovery-email"
                type="email"
                required
                autoComplete="email"
                className="pl-9"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>
          <Button type="submit" loading={sending}>
            Enviar enlace seguro
          </Button>
          <FormErrorSummary>{error}</FormErrorSummary>
          <Button asChild variant="ghost">
            <Link to="/login">Cancelar</Link>
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gold text-gold-foreground">
            <Scale className="h-6 w-6" />
          </div>
          <p className="font-semibold">Estudio Jurídico Arenas</p>
        </div>
        <div className="rounded-2xl border bg-card p-8 shadow-soft">
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
