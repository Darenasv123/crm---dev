import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthClient, supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type Template = Database["public"]["Tables"]["templates"]["Row"];

/**
 * Las plantillas viven en el mismo bucket "documents" que el resto de
 * archivos del CRM, bajo este prefijo de ruta. SELECT y DELETE en
 * storage.objects ya estaban correctamente acotados para este caso (staff
 * puede leer, solo Administrador puede borrar) por las policies históricas
 * del bucket; INSERT/UPDATE bajo este prefijo específico quedan
 * restringidos a Administrador mediante policies RESTRICTIVE añadidas en
 * supabase/migrations/20260822110000_add_templates.sql (Fase 5B) -- sin
 * tocar los permisos de Documentos normales fuera de "templates/".
 */
const TEMPLATES_STORAGE_PREFIX = "templates";

export const MAX_TEMPLATE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TEMPLATE_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

export function validateTemplateFile(file: Pick<File, "name" | "size" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.trim()) throw new Error("El archivo debe tener un nombre válido.");
  if (!ALLOWED_TEMPLATE_EXTENSIONS.has(extension)) {
    throw new Error("Formato no permitido. Usa PDF, DOC o DOCX.");
  }
  if (file.size <= 0) throw new Error("El archivo está vacío.");
  if (file.size > MAX_TEMPLATE_SIZE_BYTES) throw new Error("El archivo supera el límite de 10 MB.");
}

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as Template[];
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      name,
      description,
    }: {
      file: File;
      name: string;
      description?: string;
    }) => {
      validateTemplateFile(file);
      if (!name.trim()) throw new Error("La plantilla debe tener un nombre.");

      // Sección 5 (path de Storage): el nombre original del archivo es
      // controlado por el usuario y NUNCA se usa tal cual como ruta. Se
      // eliminan todos los caracteres salvo [a-zA-Z0-9._-] -- en particular
      // "/" desaparece, así que ningún intento de "../" puede producir un
      // segmento de ruta adicional (el resultado sanitizado nunca contiene
      // "/", solo puntos y guiones bajos sueltos). El path final se
      // construye con TEMPLATES_STORAGE_PREFIX + un timestamp servidor
      // (Date.now(), no controlado por el usuario) + el nombre saneado, así
      // que la identidad real del archivo (storage_path) nunca depende
      // únicamente del nombre original. `upsert: false` hace que una
      // colisión (mismo milisegundo + mismo nombre saneado, extremadamente
      // improbable en este flujo) falle explícitamente en vez de
      // sobrescribir un archivo existente en silencio.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${TEMPLATES_STORAGE_PREFIX}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, file, { upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const db = await getAuthClient();
      const { data, error } = await db
        .from("templates")
        .insert({
          name: name.trim(),
          description: description?.trim() || null,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size: file.size,
        })
        .select("*")
        .single();

      // Sección 7 (upload + compensación): no hay una transacción
      // distribuida real entre Storage y Postgres, así que si la metadata
      // falla tras subir el archivo, se intenta borrar el objeto huérfano
      // como mejor esfuerzo. Si ADEMÁS esa limpieza compensatoria falla, no
      // se oculta el error original (metadata) ni se finge que el archivo
      // quedó limpio -- se anexa una advertencia explícita para quien lea
      // el error.
      if (error) {
        const { error: cleanupError } = await supabase.storage.from("documents").remove([path]);
        throw new Error(
          cleanupError
            ? `${error.message} (además, no se pudo limpiar el archivo subido en almacenamiento: ${cleanupError.message})`
            : error.message,
        );
      }
      if (!data) {
        const { error: cleanupError } = await supabase.storage.from("documents").remove([path]);
        const baseMessage = "Supabase no devolvió el registro de la plantilla creada.";
        throw new Error(
          cleanupError
            ? `${baseMessage} (además, no se pudo limpiar el archivo subido en almacenamiento: ${cleanupError.message})`
            : baseMessage,
        );
      }

      return data as Template;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

/**
 * Sección 6 (eliminación y fallos parciales) -- semántica explícita:
 *
 * Orden: DB row delete -> Storage delete -> onSettled refresca el listado.
 *
 * Esta dirección (no la inversa) es deliberada: si en vez borráramos
 * primero el Storage y la fila de la BD fallara después, el listado
 * seguiría mostrando una "plantilla" cuyo archivo real ya no existe --
 * invisible hasta que alguien intente abrirla. Borrando primero la fila,
 * el peor caso posible es un objeto huérfano en Storage sin ninguna fila
 * que lo referencie: invisible en la UI (que solo lista por la tabla
 * `templates`, nunca listando storage.objects directamente), sin ningún
 * impacto funcional ni de seguridad -- es la estrategia de consistencia
 * eventual preferible frente a la alternativa.
 *
 * Mensaje al usuario ante fallo de limpieza de Storage: el error indica
 * explícitamente "la plantilla se eliminó del listado, pero el archivo no
 * pudo borrarse" -- nunca afirma que la eliminación completa falló, porque
 * la metadata (lo único que la UI muestra) sí desapareció.
 *
 * Detección futura de huérfanos (sin implementar infraestructura de jobs
 * en esta fase): un objeto de Storage bajo templates/ es huérfano si su
 * ruta no aparece en ningún `templates.storage_path`. Una tarea de
 * mantenimiento futura podría listar storage.objects bajo ese prefijo y
 * comparar contra la tabla -- no se construye ningún job/cron para esto
 * ahora, según lo pedido.
 */
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      const db = await getAuthClient();
      const { error: dbError } = await db.from("templates").delete().eq("id", id);
      if (dbError) throw new Error(dbError.message);

      const { error: storageError } = await supabase.storage
        .from("documents")
        .remove([storagePath]);
      if (storageError) {
        throw new Error(
          `La plantilla se eliminó del listado, pero el archivo no pudo borrarse de almacenamiento: ${storageError.message}`,
        );
      }
    },
    // onSettled (no solo onSuccess): incluso si la limpieza de Storage
    // falla después del borrado de la fila, el listado debe refrescarse
    // para reflejar la fuente de verdad real (la fila ya no existe),
    // mientras el error de limpieza se sigue propagando al llamador.
    onSettled: () => qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}
