/**
 * Normalize a rich-text value received on a write path into the object shape
 * the Tiptap columns are read with. Accepts a Tiptap document object (kept
 * as-is), a JSON-stringified document (parsed), or plain text (wrapped as one
 * paragraph per line). Blank input normalizes to null. Server-safe: no editor
 * or DOM dependency.
 */
export function normalizeTiptapInput(value: unknown): object | null {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "type" in parsed) {
        return parsed;
      }
    } catch {
      // not a serialized document — treat as plain text
    }
  }

  return {
    type: "doc",
    content: value
      .split(/\r?\n/)
      .map((line) =>
        line === ""
          ? { type: "paragraph" }
          : { type: "paragraph", content: [{ type: "text", text: line }] }
      ),
  };
}
