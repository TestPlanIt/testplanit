import { JSONContent } from "@tiptap/core";

/**
 * Recursively extracts user IDs from mention nodes in TipTap JSON content
 * @param content TipTap JSON content
 * @returns Array of unique user IDs mentioned in the content
 */
export function extractMentionedUserIds(content: JSONContent): string[] {
  const userIds = new Set<string>();

  function traverse(node: JSONContent) {
    // Check if this is a mention node
    if (node.type === "mention" && node.attrs?.id) {
      userIds.add(node.attrs.id);
    }

    // Recursively traverse child nodes
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child) => traverse(child));
    }
  }

  traverse(content);
  return Array.from(userIds);
}

/**
 * Validates that TipTap content is properly formatted
 * @param content Content to validate
 * @returns true if valid, false otherwise
 */
export function isValidTipTapContent(content: unknown): content is JSONContent {
  if (!content || typeof content !== "object") {
    return false;
  }

  const json = content as JSONContent;

  // TipTap content should have a type
  if (!json.type || typeof json.type !== "string") {
    return false;
  }

  // If there's content, it should be an array
  if (json.content !== undefined && !Array.isArray(json.content)) {
    return false;
  }

  return true;
}

/**
 * Creates an empty TipTap document
 * @returns Empty TipTap JSON structure
 */
export function createEmptyTipTapDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
      },
    ],
  };
}
