import { useEffect, useState } from "react";
import { Edit3, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateDailyTask, useUpdateDailyTask, type DailyTask } from "@/hooks/use-daily-tasks";
import {
  limaToday,
  TASK_PRIORITIES,
  toDatetimeLocalValue,
  validateTaskEditForm,
  validateTaskForm,
  type TaskFormValues,
} from "@/lib/tasks";

const EMPTY_FORM: TaskFormValues = {
  title: "",
  description: "",
  client_id: "",
  case_id: "",
  priority: "Normal",
  scheduled_for: limaToday(),
  due_date: "",
};

/**
 * Formulario de tarea reutilizado para crear y editar.
 * En modo "edit" nunca toca `status` ni `assigned_to`: esos campos se
 * gestionan exclusivamente desde las acciones de Tomar/Devolver/Responsable
 * en la lista y el detalle, para que editar nunca equivalga a tomar/liberar.
 */
export function TaskFormDialog({
  mode,
  open,
  onOpenChange,
  task,
  clients,
  cases,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Requerida en modo "edit"; ignorada en modo "create". */
  task?: DailyTask | null;
  clients: Array<{ id: string; name: string }>;
  cases: Array<{ id: string; client_id: string; expediente: string; case_number?: string | null }>;
  /** Se invoca con la tarea actualizada tras un guardado exitoso en modo "edit". */
  onSaved?: (task: DailyTask) => void;
}) {
  const createTask = useCreateDailyTask();
  const updateTask = useUpdateDailyTask();
  const [form, setForm] = useState<TaskFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && task) {
      setForm({
        title: task.title,
        description: task.description ?? "",
        client_id: task.client_id ?? task.cases?.client_id ?? "",
        case_id: task.case_id ?? "",
        priority: (task.priority as TaskFormValues["priority"]) ?? "Normal",
        scheduled_for: task.scheduled_for,
        due_date: toDatetimeLocalValue(task.due_date),
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [open, mode, task]);

  const casesForForm = cases.filter((item) => !form.client_id || item.client_id === form.client_id);
  const pending = mode === "edit" ? updateTask.isPending : createTask.isPending;
  const isCompleted = mode === "edit" && task?.status === "completed";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "edit") {
        if (!task) return;
        const payload = validateTaskEditForm(form, cases);
        const updated = await updateTask.mutateAsync({
          id: task.id,
          current: task,
          updates: payload,
        });
        onSaved?.(updated);
      } else {
        await createTask.mutateAsync({ values: form, cases });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `No se pudo ${mode === "edit" ? "guardar los cambios" : "crear la tarea"}.`,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={mode === "edit" ? Edit3 : Plus}>
          <DialogTitle>{mode === "edit" ? "Editar tarea" : "Nueva tarea disponible"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "El estado y el responsable se gestionan desde la lista de tareas, no desde aquí."
              : "Se crea pendiente y sin responsable para que el equipo pueda tomarla."}
          </DialogDescription>
        </DialogHeader>
        {isCompleted && (
          <p className="-mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            Esta tarea ya está completada. Los cambios no alteran su fecha de finalización.
          </p>
        )}
        <form onSubmit={submit}>
          <FormSection title="Información de la tarea">
            <FormField id="task-form-title" label="Tarea" required className="sm:col-span-2">
              <Input
                id="task-form-title"
                autoFocus
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </FormField>
            <FormField id="task-form-client" label="Cliente" optional>
              <NativeSelect
                id="task-form-client"
                value={form.client_id}
                onChange={(event) =>
                  setForm({ ...form, client_id: event.target.value, case_id: "" })
                }
              >
                <option value="">Tarea general</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="task-form-case" label="Expediente" optional>
              <NativeSelect
                id="task-form-case"
                value={form.case_id}
                onChange={(event) => {
                  const selected = cases.find((item) => item.id === event.target.value);
                  setForm({
                    ...form,
                    case_id: event.target.value,
                    client_id: selected?.client_id ?? form.client_id,
                  });
                }}
              >
                <option value="">Sin expediente</option>
                {casesForForm.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.case_number || item.expediente}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="task-form-priority" label="Prioridad" className="sm:col-span-2">
              <NativeSelect
                id="task-form-priority"
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value as TaskFormValues["priority"] })
                }
              >
                {TASK_PRIORITIES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="task-form-scheduled-for" label="Fecha de trabajo" required>
              <Input
                id="task-form-scheduled-for"
                type="date"
                required
                value={form.scheduled_for}
                onChange={(event) => setForm({ ...form, scheduled_for: event.target.value })}
              />
            </FormField>
            <FormField id="task-form-due-date" label="Vencimiento" optional>
              <Input
                id="task-form-due-date"
                type="datetime-local"
                value={form.due_date}
                onChange={(event) => setForm({ ...form, due_date: event.target.value })}
              />
            </FormField>
            <FormField
              id="task-form-description"
              label="Observaciones"
              optional
              className="sm:col-span-2"
            >
              <Textarea
                id="task-form-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </FormField>
            {error && <FormErrorSummary className="sm:col-span-2">{error}</FormErrorSummary>}
          </FormSection>
          <FormActions>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {mode === "edit" ? "Guardar cambios" : "Crear tarea"}
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
