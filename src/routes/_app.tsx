import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user, loading } = useAuth();

  // Show spinner while auth state is being resolved
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  // Auth resolved and no user — redirect to login
  if (!user) {
    // Use window.location for a hard redirect so there's no router state conflict
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  return <Outlet />;
}
