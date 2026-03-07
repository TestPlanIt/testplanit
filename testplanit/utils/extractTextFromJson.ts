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
