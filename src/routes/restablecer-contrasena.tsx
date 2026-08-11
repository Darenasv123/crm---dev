import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorSummary } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { AuthShell } from "@/routes/recuperar-contrasena";

export const Route = createFileRoute("/restablecer-contrasena")({ component: ResetPasswordPage });

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      setError("Usa al menos 12 caracteres e incluye mayúsculas, minúsculas y números.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setSaving(false);
      setError("El enlace venció o ya fue utilizado. Solicita uno nuevo.");
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError("No se pudo actualizar la contraseña. Solicita un enlace nuevo.");
      return;
    }
    await supabase.auth.signOut({ scope: "global" });
    await navigate({ to: "/login" });
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
        <Button type="submit" loading={saving}>
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
