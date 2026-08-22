import { useId, useState } from "react";
import { Eye, EyeOff, Loader2, Plus, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles, useRegisterStaff, useUpdateProfile } from "@/hooks/use-profiles";

const ROLES = ["Administrador", "Personal"] as const;
type Role = (typeof ROLES)[number];

const roleColor: Record<Role, "navy" | "info"> = {
  Administrador: "navy",
  Personal: "info",
};

interface EditableProfile {
  id: string;
  full_name: string;
  phone: string;
  role: Role;
  status: string;
  /** Estado del usuario cuando se abrió el modal, para detectar si esta
   * edición le quitaría el rol/estado de Administrador activo. */
  original: { role: Role; status: string };
}

/**
 * Configuración → Usuarios y roles. Extraído de _app.configuracion.index.tsx
 * (Fase 6) para aislar la lógica de protección del último Administrador y
 * mantener el archivo de la ruta manejable. Este componente asume que ya
 * corre detrás del gate de página Administrador-only de /configuracion
 * (igual que antes de la extracción); no repite ese chequeo internamente.
 */
export function UsersSettings() {
  const { profile: currentProfile } = useAuth();
  const { data: profiles = [], isLoading } = useProfiles();
  const registerStaff = useRegisterStaff();
  const updateProfile = useUpdateProfile();

  const [showRegister, setShowRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "Personal" as Role,
    phone: "",
  });

  const [editProfile, setEditProfile] = useState<EditableProfile | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const activeAdminCount = profiles.filter(
    (p) => p.role === "Administrador" && p.status === "Activo",
  ).length;

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await registerStaff.mutateAsync({
        email: form.email,
        password: form.password,
        fullName: `${form.firstName} ${form.lastName}`.trim(),
        role: form.role,
        phone: form.phone,
      });
      setShowRegister(false);
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        role: "Personal",
        phone: "",
      });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al registrar. Verifica los datos.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editProfile) return;

    const wasActiveAdmin =
      editProfile.original.role === "Administrador" && editProfile.original.status === "Activo";
    const willLoseAdmin = editProfile.role !== "Administrador" || editProfile.status !== "Activo";

    if (wasActiveAdmin && willLoseAdmin) {
      const isSelf = editProfile.id === currentProfile?.id;
      const confirmed = window.confirm(
        isSelf
          ? "Estás a punto de quitarte a ti mismo el rol de Administrador o desactivar tu propia cuenta. Si eres el único Administrador activo, el sistema rechazará este cambio. ¿Continuar?"
          : `Estás a punto de quitarle el rol de Administrador o desactivar a "${editProfile.full_name}". ¿Continuar?`,
      );
      if (!confirmed) return;
    }

    setEditSaving(true);
    setEditError(null);
    const words = editProfile.full_name.trim().split(/\s+/);
    const initials =
      words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
    try {
      await updateProfile.mutateAsync({
        id: editProfile.id,
        updates: {
          full_name: editProfile.full_name,
          phone: editProfile.phone || null,
          role: editProfile.role,
          status: editProfile.status as "Activo" | "Inactivo",
          initials,
        },
      });
      setEditProfile(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Error al actualizar.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold">Personal del estudio</h3>
            <p className="text-xs text-muted-foreground">Roles: Administrador · Personal</p>
          </div>
          <button
            onClick={() => setShowRegister(true)}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Registrar personal
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <th className="py-3 pl-5">Usuario</th>
              <th className="py-3 px-3">Rol</th>
              <th className="py-3 px-3">Estado</th>
              <th className="py-3 pr-5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="py-10 text-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                </td>
              </tr>
            ) : profiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  No hay personal registrado aún.
                </td>
              </tr>
            ) : (
              profiles.map((u) => {
                const isSelf = u.id === currentProfile?.id;
                const isLastActiveAdmin =
                  u.role === "Administrador" && u.status === "Activo" && activeAdminCount <= 1;
                return (
                  <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                    <td className="py-3 pl-5">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          {u.initials}
                        </div>
                        <div>
                          <div className="font-semibold">
                            {u.full_name}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                                (tú)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge tone={roleColor[u.role as keyof typeof roleColor] || "default"}>
                        {u.role}
                      </StatusBadge>
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge tone={u.status === "Activo" ? "success" : "default"}>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${u.status === "Activo" ? "bg-emerald-500" : "bg-muted-foreground"}`}
                        />{" "}
                        {u.status}
                      </StatusBadge>
                      {isLastActiveAdmin && (
                        <div className="mt-1 text-[10px] text-amber-600">
                          Único Administrador activo
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <button
                        onClick={() =>
                          setEditProfile({
                            id: u.id,
                            full_name: u.full_name,
                            phone: u.phone ?? "",
                            role: u.role as Role,
                            status: u.status,
                            original: { role: u.role as Role, status: u.status },
                          })
                        }
                        className="h-8 px-3 rounded-md text-xs font-semibold text-primary hover:bg-primary/10"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {/* Register Staff Modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Registrar personal</h3>
                <p className="text-xs text-muted-foreground">Añade un miembro al estudio</p>
              </div>
              <button
                onClick={() => setShowRegister(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Nombre *"
                  value={form.firstName}
                  onChange={(v) => setForm((f) => ({ ...f, firstName: v }))}
                />
                <FormField
                  label="Apellidos *"
                  value={form.lastName}
                  onChange={(v) => setForm((f) => ({ ...f, lastName: v }))}
                />
              </div>
              <FormField
                label="Correo electrónico *"
                value={form.email}
                onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              />
              <div>
                <label
                  htmlFor="register-password"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Contraseña *
                </label>
                <div className="relative mt-1.5">
                  <Input
                    id="register-password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rol
                </label>
                <div className="mt-1.5 flex gap-3">
                  {ROLES.map((r) => (
                    <label
                      key={r}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="rol"
                        value={r}
                        checked={form.role === r}
                        onChange={() => setForm((f) => ({ ...f, role: r }))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <FormField
                label="Teléfono (opcional)"
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              />
              {formError && (
                <p
                  role="alert"
                  className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                >
                  {formError}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Registrando..." : "Registrar"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Editar usuario</h3>
                <p className="text-xs text-muted-foreground">
                  Actualiza los datos del miembro
                  {editProfile.id === currentProfile?.id && " — estás editando tu propia cuenta"}
                </p>
              </div>
              <button
                onClick={() => setEditProfile(null)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleEditProfile} className="space-y-4">
              <FormField
                label="Nombre completo *"
                value={editProfile.full_name}
                onChange={(v) => setEditProfile((p) => (p ? { ...p, full_name: v } : p))}
              />
              <FormField
                label="Teléfono"
                value={editProfile.phone}
                onChange={(v) => setEditProfile((p) => (p ? { ...p, phone: v } : p))}
              />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rol
                </label>
                <div className="mt-1.5 flex gap-3">
                  {ROLES.map((r) => (
                    <label
                      key={r}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="edit-rol"
                        value={r}
                        checked={editProfile.role === r}
                        onChange={() => setEditProfile((p) => (p ? { ...p, role: r } : p))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </label>
                <div className="mt-1.5 flex gap-3">
                  {["Activo", "Inactivo"].map((s) => (
                    <label
                      key={s}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="edit-status"
                        value={s}
                        checked={editProfile.status === s}
                        onChange={() => setEditProfile((p) => (p ? { ...p, status: s } : p))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editProfile.original.role === "Administrador" &&
                editProfile.original.status === "Activo" &&
                activeAdminCount <= 1 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Este usuario es el único Administrador activo. El sistema rechazará quitarle el
                    rol o desactivarlo mientras no haya otro Administrador activo.
                  </p>
                )}
              {editError && (
                <p
                  role="alert"
                  className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                >
                  {editError}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setEditProfile(null)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}

function FormField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <Input
        id={id}
        defaultValue={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1.5"
      />
    </div>
  );
}
