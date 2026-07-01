import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_app")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Auth resolved and no user — redirect to login
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
    }
  }, [user, loading, navigate]);

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

  // Not authenticated — redirect is in progress, render nothing
  if (!user) return null;

  return <Outlet />;
}
