import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/recuperar-contrasena")({ component: PasswordRecoveryPage });

function PasswordRecoveryPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer-contrasena`,
    });
    setSending(false);
    setSent(true);
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
