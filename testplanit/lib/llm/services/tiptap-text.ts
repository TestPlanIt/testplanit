/**
 * Flattens a rich-text value to the plain text a prompt can carry.
 *
 * Rich text reaches the server in two shapes (a TipTap/ProseMirror document
 * object, or that document as a JSON string), and sometimes as plain text
 * already. All three answer the same question here: what does it say?
 */
export function extractTextFromTipTap(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") {
    try {
      return extractTextFromTipTap(JSON.parse(content));
    } catch {
      return content;
    }
  }
  if (typeof content !== "object") return "";
  const node = content as Record<string, unknown>;
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromTipTap).join(" ");
  }
  return "";
}
