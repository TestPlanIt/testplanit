/**
 * Canonical "is this rich-text value empty?" check, shared by client and
 * server so emptiness is decided identically everywhere (field values,
 * comments, result notes, field counting, justification enforcement).
 *
 * A value is empty when it carries no renderable content: no non-whitespace
 * text AND no media/atom node (image, mention, horizontal rule, or any custom
 * embed). Treats `null`, `undefined`, blank strings, and the canonical empty
 * doc ({ type: "doc", content: [{ type: "paragraph" }] }) as empty. Accepts a
 * Tiptap JSON object, a JSON-stringified doc, or a plain string.
 */
export function isTiptapEmpty(value: unknown): boolean {
  if (value == null) return true;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    // Stored field values are often the JSON-stringified doc.
    try {
      return isTiptapEmpty(JSON.parse(trimmed));
    } catch {
      // A non-JSON, non-blank string is meaningful text.
      return false;
    }
  }

  if (typeof value !== "object") return false;

  return !hasRenderableContent(value);
}

/**
 * Structural nodes that hold no content of their own — they are empty unless
 * a descendant is contentful. Anything NOT listed here and not a plain text
 * node is treated as a contentful atom (image, mention, embed, etc.), so new
 * or custom node types are conservatively counted as content rather than
 * silently dropped.
 */
const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  "doc",
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);

/** Leaf nodes that render nothing meaningful on their own. */
const EMPTY_LEAF_TYPES = new Set<string>(["hardBreak"]);

function hasRenderableContent(node: unknown): boolean {
  if (node == null || typeof node !== "object") return false;

  const n = node as Record<string, unknown>;
  const type = typeof n.type === "string" ? n.type : "";

  if (type === "text") {
    return typeof n.text === "string" && n.text.trim().length > 0;
  }

  if (
    Array.isArray(n.content) &&
    (n.content as unknown[]).some(hasRenderableContent)
  ) {
    return true;
  }

  // A non-text node that isn't a known empty container/leaf is a content atom.
  return (
    type !== "" &&
    !STRUCTURAL_CONTAINER_TYPES.has(type) &&
    !EMPTY_LEAF_TYPES.has(type)
  );
}
