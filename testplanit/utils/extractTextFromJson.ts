import { filenameForEditorMediaSrc } from "~/lib/tiptap/editorMediaSrcs";

/**
 * Recursively extracts text content from a JSON node structure
 * (commonly used in Tiptap/ProseMirror).
 */
export const extractTextFromNode = (node: any): string => {
  if (!node) return "";

  // If the node is a string, try to parse it as JSON in case
  // it's a stringified Tiptap document (common with Prisma Json fields)
  if (typeof node === "string") {
    try {
      const parsed = JSON.parse(node);
      if (typeof parsed === "object" && parsed !== null) {
        return extractTextFromNode(parsed);
      }
    } catch {
      // Not JSON, return as plain text
    }
    return node;
  }

  // If the node has a direct text property, return it
  if (node.text && typeof node.text === "string") return node.text;

  // If the node has a content array, recursively process each item
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(""); // Join without spaces for raw text
  }

  // Return empty string if no text found or structure is unexpected
  return "";
};

/**
 * Like `extractTextFromNode`, but image nodes become `[image N: <name>]`
 * markers (numbered in document order) and block-level nodes are separated
 * by newlines, so the flattened text acknowledges embedded screenshots
 * instead of silently dropping them. Used to turn rich-text documents into
 * LLM prompt text alongside the images themselves.
 *
 * `extractTextFromNode` is left untouched: its callers (step previews,
 * search snippets) want display text where a marker would be noise.
 */
export const extractTextWithImageMarkers = (doc: unknown): string => {
  let imageIndex = 0;
  const walk = (node: any): string => {
    if (!node || typeof node !== "object") return "";
    if (node.type === "image") {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const label = src
        ? filenameForEditorMediaSrc(src, imageIndex)
        : `embedded-media-${imageIndex + 1}`;
      imageIndex++;
      return `[image ${imageIndex}: ${label}]`;
    }
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) {
      const isBlockContainer =
        node.type === "doc" ||
        node.type === "bulletList" ||
        node.type === "orderedList";
      const parts: string[] = node.content.map(walk);
      return isBlockContainer ? parts.join("\n") : parts.join("");
    }
    return "";
  };
  return walk(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
