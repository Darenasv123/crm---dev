import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPasswordRecoveryEnabled } from "@/lib/feature-flags";
import { supabase } from "@/lib/supabase";
import { AuthShell } from "@/routes/recuperar-contrasena";

export const Route = createFileRoute("/restablecer-contrasena")({ component: ResetPasswordPage });

type RecoveryPhase = "validating" | "ready" | "invalid" | "submitting" | "success" | "error";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const recoveryEnabled = isPasswordRecoveryEnabled();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<RecoveryPhase>(recoveryEnabled ? "validating" : "invalid");

  useEffect(() => {
    // Fail-closed: while disabled, never register the PASSWORD_RECOVERY
    // listener nor call getSession as part of the recovery flow.
    if (!recoveryEnabled) return;
    let active = true;
    let recoveryEventHandled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event !== "PASSWORD_RECOVERY") return;
      recoveryEventHandled = true;
      setPhase(session ? "ready" : "invalid");
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || recoveryEventHandled) return;
        setPhase(!sessionError && data.session ? "ready" : "invalid");
      })
      .catch(() => {
        if (active && !recoveryEventHandled) setPhase("invalid");
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [recoveryEnabled]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Fail-closed guard: never call updateUser for recovery while disabled.
    if (!recoveryEnabled) return;
    if (phase !== "ready" && phase !== "error") return;
    setError(null);
    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      setError("Usa al menos 12 caracteres e incluye mayúsculas, minúsculas y números.");
      setPhase("error");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      setPhase("error");
      return;
    }
    setPhase("submitting");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        setError("El enlace venció o ya fue utilizado. Solicita uno nuevo.");
        setPhase("invalid");
        return;
      }
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError || !updateData.user) {
        setError("No se pudo actualizar la contraseña. Solicita un enlace nuevo.");
        setPhase("error");
        return;
      }
      setPhase("success");
      await supabase.auth.signOut({ scope: "global" });
      await navigate({ to: "/login" });
    } catch {
      setError("No se pudo actualizar la contraseña. Solicita un enlace nuevo.");
      setPhase("error");
    }
  }

  if (phase === "validating") {
    return (
      <AuthShell
        title="Validando enlace"
        description="Estamos verificando tu sesión de recuperación."
      >
        <div className="flex items-center gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
          <LoaderCircle className="h-5 w-5 animate-spin" /> Validando enlace seguro…
        </div>
      </AuthShell>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthShell title="Enlace no válido" description="No pudimos validar esta recuperación.">
        <div className="grid gap-4">
          <FormErrorSummary>
            {error ??
              (recoveryEnabled
                ? "El enlace venció o ya fue utilizado. Solicita uno nuevo."
                : "La recuperación de contraseña está deshabilitada temporalmente. Contacta al administrador del estudio.")}
          </FormErrorSummary>
          <Button asChild variant="outline">
            {recoveryEnabled ? (
              <Link to="/recuperar-contrasena">Solicitar un enlace nuevo</Link>
            ) : (
              <Link to="/login">Volver al inicio de sesión</Link>
            )}
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (phase === "success") {
    return (
      <AuthShell
        title="Contraseña actualizada"
        description="Tu contraseña se cambió correctamente."
      >
        <p className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
          Cerrando las sesiones y redirigiendo al inicio de sesión…
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crear nueva contraseña"
      description="El enlace es temporal y solo puede utilizarse dentro de una sesión de recuperación válida."
    >
      <form onSubmit={submit} className="grid gap-4">
        <PasswordField
          id="new-password"
          label="Nueva contraseña"
          value={password}
          show={show}
          onChange={setPassword}
          onToggle={() => setShow((value) => !value)}
        />
        <PasswordField
          id="confirm-password"
          label="Confirmar contraseña"
          value={confirmation}
          show={show}
          onChange={setConfirmation}
          onToggle={() => setShow((value) => !value)}
        />
        <p className="text-xs text-muted-foreground">
          Mínimo 12 caracteres, con mayúsculas, minúsculas y números.
        </p>
        <FormErrorSummary>{error}</FormErrorSummary>
        <Button type="submit" loading={phase === "submitting"}>
          Guardar contraseña
        </Button>
      </form>
    </AuthShell>
  );
}

function PasswordField({
  id,
  label,
  value,
  show,
  onChange,
  onToggle,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-2">
        <Input
          id={id}
          type={show ? "text" : "password"}
          required
          autoComplete="new-password"
          className="pr-11"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
