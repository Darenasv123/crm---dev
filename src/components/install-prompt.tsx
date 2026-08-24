import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "crm-install-prompt-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Fase 7 (Sección Y): solo se muestra cuando el navegador realmente ofrece
// instalar (evento nativo) o, en iOS (que nunca dispara ese evento), con una
// instrucción breve — nunca un botón de instalación falso en navegadores sin
// soporte.
export function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    let alreadyDismissed = false;
    try {
      alreadyDismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* localStorage unavailable — treat as not dismissed */
    }
    if (alreadyDismissed) return;

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    if (isIOS()) setShowIOSHint(true);

    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore — non-critical convenience persistence */
    }
  }

  async function handleInstall() {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
    dismiss();
  }

  if (dismissed || (!deferredEvent && !showIOSHint)) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 z-40 flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-xl
        bottom-[calc(9.5rem+env(safe-area-inset-bottom))]
        lg:inset-x-auto lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] lg:left-4 lg:w-80"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Download className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 text-xs">
        {deferredEvent ? (
          <>
            <p className="font-semibold text-foreground">Instalar aplicación</p>
            <p className="mt-0.5 text-muted-foreground">
              Instala el CRM para acceder más rápido desde tu dispositivo.
            </p>
            <button
              onClick={handleInstall}
              className="mt-2 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-110"
            >
              Instalar
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-foreground">Instalar en este iPhone/iPad</p>
            <p className="mt-0.5 text-muted-foreground">
              Toca Compartir y luego &quot;Añadir a pantalla de inicio&quot;.
            </p>
          </>
        )}
      </div>
      <button
        onClick={dismiss}
        aria-label="Cerrar sugerencia de instalación"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
