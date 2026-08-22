import { useId, useState } from "react";
import { CheckCircle, Loader2, Mail, Send, XCircle } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { Input } from "@/components/ui/input";
import { useEmailConfigStatus, useSendTestEmail } from "@/hooks/use-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailSettings() {
  const { data: status, isLoading, error } = useEmailConfigStatus();
  const sendTest = useSendTestEmail();
  const inputId = useId();
  const [testEmail, setTestEmail] = useState("");
  const [testFeedback, setTestFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const testEmailValid = EMAIL_RE.test(testEmail.trim());

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmailValid || sendTest.isPending) return;
    setTestFeedback(null);
    try {
      await sendTest.mutateAsync(testEmail.trim());
      setTestFeedback({
        kind: "success",
        message: `Correo de prueba enviado a ${testEmail.trim()}.`,
      });
    } catch (err) {
      setTestFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "No se pudo enviar el correo de prueba.",
      });
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-sky-50 text-sky-600">
          <Mail className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold">Configuración de correo</h3>
          <p className="text-xs text-muted-foreground">
            Servidor SMTP configurado exclusivamente mediante variables de entorno del servidor.
          </p>
        </div>
        {!isLoading && status && (
          <StatusBadge tone={status.configured ? "success" : "default"}>
            {status.configured ? "Configurado" : "No configurado"}
          </StatusBadge>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Consultando estado de Correo...
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error instanceof Error ? error.message : "No se pudo consultar el estado de Correo."}
        </p>
      ) : !status ? null : status.configured ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Remitente
              </dt>
              <dd className="mt-0.5 font-medium">
                {status.fromName ? `${status.fromName} <${status.fromEmail}>` : status.fromEmail}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Seguridad
              </dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                {status.secure ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> TLS (SMTPS)
                  </>
                ) : (
                  "STARTTLS / sin cifrado implícito"
                )}
              </dd>
            </div>
          </dl>

          <form onSubmit={handleSendTest} className="space-y-3">
            <label
              htmlFor={inputId}
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Enviar correo de prueba
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={inputId}
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="destino@ejemplo.com"
                aria-label="Correo de destino para la prueba"
                className="max-w-xs"
              />
              <button
                type="submit"
                disabled={!testEmailValid || sendTest.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendTest.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sendTest.isPending ? "Enviando..." : "Enviar prueba"}
              </button>
            </div>
            {testFeedback && (
              <p
                role={testFeedback.kind === "error" ? "alert" : "status"}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  testFeedback.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-600"
                }`}
              >
                {testFeedback.kind === "success" ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {testFeedback.message}
              </p>
            )}
          </form>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Correo no está configurado. Define las siguientes variables de entorno en el servidor
            para habilitarlo:
          </p>
          <ul className="flex flex-wrap gap-2">
            {status.missingVars.map((name) => (
              <li
                key={name}
                className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px]"
              >
                {name}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Por seguridad, ningún valor (incluida la contraseña SMTP) se muestra ni se edita desde
            el navegador.
          </p>
        </div>
      )}
    </Card>
  );
}
