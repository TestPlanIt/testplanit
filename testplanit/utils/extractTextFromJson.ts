/**
 * Recursively extracts text content from a JSON node structure
 * (commonly used in Tiptap/ProseMirror).
 */
export const extractTextFromNode = (node: any): string => {
  if (!node) return "";

  // If the node itself is just a string, return it
  if (typeof node === "string") return node;

  // If the node has a direct text property, return it
  if (node.text && typeof node.text === "string") return node.text;

  // If the node has a content array, recursively process each item
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(""); // Join without spaces for raw text
  }

  // Return empty string if no text found or structure is unexpected
  return "";
};
