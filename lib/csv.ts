export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheet formulas, including after whitespace.
  if (typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
