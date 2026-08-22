import { useEffect, useState } from "react";
import { Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateCase } from "@/hooks/use-cases";
import type { CaseWithClient } from "@/hooks/use-cases";
import { CASE_STATUS_OPTIONS, MATERIA_OPTIONS, validateCaseForm } from "@/lib/case-validation";

/**
 * Diálogo de edición de expediente, reutilizado por el listado de Expedientes
 * y por la ficha de expediente para evitar un segundo formulario.
 */
export function CaseEditDialog({
  open,
  onOpenChange,
  caseItem,
  clients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseItem: CaseWithClient | null;
  clients: Array<{ id: string; name: string }>;
}) {
  const updateCase = useUpdateCase();
  const [form, setForm] = useState({
    client_id: "",
    expediente: "",
    materia: "Familia",
    process_type: "",
    status: "Pendiente de clasificación",
    next_action: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && caseItem) {
      setForm({
        client_id: caseItem.client_id,
        expediente: caseItem.expediente,
        materia: caseItem.materia || "Familia",
        process_type: caseItem.process_type,
        status: caseItem.status,
        next_action: caseItem.next_action || "",
      });
      setError(null);
    }
  }, [open, caseItem]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!caseItem) return;
    setError(null);
    try {
      const values = validateCaseForm(form);
      await updateCase.mutateAsync({
        id: caseItem.id,
        updates: {
          client_id: values.client_id,
          expediente: values.expediente || "Sin número",
          materia: values.materia,
          process_type: values.process_type,
          status: values.status,
          next_action: values.next_action || null,
        },
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el expediente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Edit3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle>Editar expediente</DialogTitle>
          <DialogDescription>Actualiza la información operativa del expediente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <FormSection title="Información principal">
            <FormField id="edit-case-client" label="Cliente" className="sm:col-span-2">
              <NativeSelect
                id="edit-case-client"
                required
                autoFocus
                value={form.client_id}
                onChange={(event) => setForm({ ...form, client_id: event.target.value })}
              >
                <option value="">Selecciona un cliente</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="edit-case-number" label="Número de expediente">
              <Input
                id="edit-case-number"
                value={form.expediente}
                onChange={(event) => setForm({ ...form, expediente: event.target.value })}
              />
            </FormField>
            <FormField id="edit-case-matter" label="Materia">
              <NativeSelect
                id="edit-case-matter"
                value={form.materia}
                onChange={(event) => setForm({ ...form, materia: event.target.value })}
              >
                {MATERIA_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="edit-case-process" label="Tipo de proceso">
              <Input
                id="edit-case-process"
                required
                value={form.process_type}
                onChange={(event) => setForm({ ...form, process_type: event.target.value })}
              />
            </FormField>
            <FormField id="edit-case-status" label="Estado">
              <NativeSelect
                id="edit-case-status"
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                {CASE_STATUS_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id="edit-case-next-action"
              label="Próxima acción"
              optional
              className="sm:col-span-2"
            >
              <Textarea
                id="edit-case-next-action"
                value={form.next_action}
                onChange={(event) => setForm({ ...form, next_action: event.target.value })}
              />
            </FormField>
          </FormSection>
          <FormErrorSummary>{error}</FormErrorSummary>
          <FormActions>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={updateCase.isPending}>
              Guardar cambios
            </Button>
          </FormActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
