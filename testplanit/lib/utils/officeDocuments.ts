/**
 * Maps an attachment's MIME type / filename to a previewable Microsoft Office
 * document kind. Only the OOXML formats (and legacy binary `.xls`, which
 * SheetJS reads) are previewable client-side; legacy binary `.doc`/`.ppt`
 * return null and fall back to the generic file icon.
 */
export type OfficeKind = "word" | "excel" | "powerpoint";

const WORD_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel", // legacy .xls — SheetJS reads it
]);

const POWERPOINT_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const WORD_EXTENSIONS = [".docx"];
const EXCEL_EXTENSIONS = [".xlsx", ".xls"];
const POWERPOINT_EXTENSIONS = [".pptx"];

const endsWithAny = (name: string, extensions: string[]) =>
  extensions.some((ext) => name.endsWith(ext));

/**
 * Returns the previewable Office kind for an attachment, or null when it is not
 * a client-side-previewable Office document.
 *
 * The filename extension is used as a fallback because the storage layer
 * sometimes records OOXML uploads with a generic Content-Type such as
 * `application/zip` or `application/octet-stream`.
 *
 * Legacy binary `.doc` (`application/msword`) and `.ppt`
 * (`application/vnd.ms-powerpoint`) intentionally return null: no viable
 * client-side renderer exists for them.
 */
export function getOfficeKind(
  mimeType?: string | null,
  filename?: string | null
): OfficeKind | null {
  const mime = (mimeType ?? "").toLowerCase();
  const name = (filename ?? "").toLowerCase();

  if (WORD_MIME_TYPES.has(mime) || endsWithAny(name, WORD_EXTENSIONS)) {
    return "word";
  }
  if (EXCEL_MIME_TYPES.has(mime) || endsWithAny(name, EXCEL_EXTENSIONS)) {
    return "excel";
  }
  if (
    POWERPOINT_MIME_TYPES.has(mime) ||
    endsWithAny(name, POWERPOINT_EXTENSIONS)
  ) {
    return "powerpoint";
  }
  return null;
}

/** True when the attachment can be previewed as an Office document. */
export function isOfficeDocument(
  mimeType?: string | null,
  filename?: string | null
): boolean {
  return getOfficeKind(mimeType, filename) !== null;
}
