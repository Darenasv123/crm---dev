export function isMissingSchemaFieldError(
  error: {
    code?: string;
    message?: string;
    details?: string;
  } | null,
) {
  if (!error) return false;

  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}
