import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContext {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Track whether onAuthStateChange has already resolved the initial state
  const authResolved = useRef(false);

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data ?? null);
  }

  useEffect(() => {
    // Register the listener BEFORE calling getSession to avoid missing events.
    // onAuthStateChange fires an INITIAL_SESSION event synchronously on mount
    // which sets the initial auth state and marks loading as done.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        // Use setTimeout to avoid Supabase internal deadlock when calling
        // other Supabase APIs inside an onAuthStateChange callback.
        setTimeout(() => fetchProfile(newSession.user.id), 0);
      } else {
        setProfile(null);
      }

      // Mark auth as resolved on first event (INITIAL_SESSION)
      if (!authResolved.current) {
        authResolved.current = true;
        setLoading(false);
      }
    });

    // Safety net: if onAuthStateChange somehow doesn't fire within a reasonable
    // time (shouldn't happen, but guards against edge cases), resolve loading anyway.
    const fallback = setTimeout(() => {
      if (!authResolved.current) {
        authResolved.current = true;
        setLoading(false);
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthCtx.Provider value={{ user, session, profile, loading, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
