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

const LINE_BREAK_CONTAINERS = new Set([
  "doc",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "blockquote",
  "tableCell",
  "tableHeader",
]);

/**
 * Like `extractTextFromNode`, but keeps the document's line structure: block
 * nodes (paragraphs, headings, list items, code blocks) and hard breaks each
 * start a new line, list items get a "- " / "1. " marker, and tables become
 * `| cell | cell |` rows padded to a common column width. Used where the text
 * is laid out for reading (PDF export) rather than searched or previewed.
 */
export const extractTextWithLineBreaks = (doc: unknown): string => {
  const walkTable = (table: any): string => {
    const rows: string[][] = (table.content ?? []).map((row: any) =>
      (row?.content ?? []).map((cell: any) =>
        walk(cell)
          .replace(/\s*\n\s*/g, " ")
          .trim()
      )
    );
    const widths: number[] = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i] ?? 0, cell.length);
      });
    }
    return rows
      .map(
        (row) =>
          `| ${row.map((cell, i) => cell.padEnd(widths[i])).join(" | ")} |`
      )
      .join("\n");
  };

  const walk = (node: any): string => {
    if (!node || typeof node !== "object") return "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "table") return walkTable(node);
    if (typeof node.text === "string") return node.text;
    if (!Array.isArray(node.content)) return "";

    if (node.type === "bulletList" || node.type === "orderedList") {
      const start = Number(node.attrs?.start) || 1;
      return node.content
        .map((item: any, i: number) => {
          const marker = node.type === "orderedList" ? `${start + i}. ` : "- ";
          const indent = " ".repeat(marker.length);
          return marker + walk(item).replace(/\n/g, `\n${indent}`);
        })
        .join("\n");
    }

    const parts: string[] = node.content.map(walk);
    return LINE_BREAK_CONTAINERS.has(node.type)
      ? parts.join("\n")
      : parts.join("");
  };

  return walk(doc)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
