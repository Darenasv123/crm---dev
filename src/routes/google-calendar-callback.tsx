/**
 * Google Calendar OAuth 2.0 callback route.
 * Google redirects here after the user authorizes the app.
 * The access token is in the URL fragment (#access_token=...).
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { handleGoogleOAuthCallback } from "@/lib/google-calendar";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export const Route = createFileRoute("/google-calendar-callback")({
  component: GoogleCalendarCallback,
});

function GoogleCalendarCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    const ok = handleGoogleOAuthCallback();
    if (ok) {
      setStatus("success");
      // Redirect to agenda after short delay
      setTimeout(() => navigate({ to: "/agenda" }), 1800);
    } else {
      setStatus("error");
      setTimeout(() => navigate({ to: "/configuracion" }), 2500);
    }
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        {status === "loading" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground">Conectando Google Calendar...</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
            <p className="text-base font-semibold">¡Google Calendar conectado!</p>
            <p className="text-sm text-muted-foreground">Redirigiendo a la agenda...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto" />
            <p className="text-base font-semibold">No se pudo conectar</p>
            <p className="text-sm text-muted-foreground">Redirigiendo a configuración...</p>
          </>
        )}
      </div>
    </div>
  );
}
