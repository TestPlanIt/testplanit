/**
 * Run-level metadata helpers.
 *
 * TestPlanIt test runs have no dedicated key/value metadata table, so run
 * metadata is stored as human-readable content in the run's `docs` field
 * (a TipTap/ProseMirror rich-text document rendered on the run detail page).
 *
 * Each metadata entry is one paragraph of the exact shape:
 *
 * ```json
 * {
 *   "type": "paragraph",
 *   "content": [
 *     { "type": "text", "marks": [{ "type": "bold" }], "text": "version: " },
 *     { "type": "text", "text": "1.2.3" }
 *   ]
 * }
 * ```
 *
 * i.e. a bold `key: ` prefix followed by the plain-text value. That shape is
 * both what a person would author by hand AND precise enough to round-trip:
 * merging only rewrites paragraphs whose first text node is bold and ends in
 * `: `, so surrounding hand-written documentation is preserved.
 *
 * Pure functions, no I/O — shared by {@link TestPlanItClient.setTestRunMetadata}
 * and exported for consumers that read/write run docs directly. For wrapping
 * PLAIN text in a TipTap doc use the existing {@link tipTapDoc} helper; this
 * module exists for the bold key/value shape and for merging without
 * clobbering surrounding content.
 */

import { tipTapDoc } from "./tipTapDoc.js";

/** A single metadata value. Numbers and booleans are stringified on write. */
export type RunMetadataValue = string | number | boolean;

/** Key/value metadata attached to a test run. */
export type RunMetadata = Record<string, RunMetadataValue>;

/** Bold key prefix terminator — `key: value`. */
const KEY_SUFFIX = ": ";

type TipTapNode = Record<string, unknown>;

/** Build the canonical metadata paragraph for one key/value pair. */
function metadataParagraph(key: string, value: RunMetadataValue): TipTapNode {
  const valueText = String(value);
  const content: TipTapNode[] = [
    { type: "text", marks: [{ type: "bold" }], text: `${key}${KEY_SUFFIX}` },
  ];
  // An empty text node is invalid in ProseMirror — omit the value node instead.
  if (valueText) {
    content.push({ type: "text", text: valueText });
  }
  return { type: "paragraph", content };
}

/**
 * If `node` is a metadata paragraph (first text node bold, ending in `: `),
 * return its key; otherwise null.
 */
function metadataKeyOf(node: unknown): string | null {
  const paragraph = node as TipTapNode | null;
  if (!paragraph || paragraph.type !== "paragraph") return null;
  const content = paragraph.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as TipTapNode | null;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return null;
  }
  const marks = first.marks;
  const isBold =
    Array.isArray(marks) &&
    marks.some((mark) => (mark as TipTapNode | null)?.type === "bold");
  if (!isBold || !first.text.endsWith(KEY_SUFFIX)) return null;
  const key = first.text.slice(0, -KEY_SUFFIX.length);
  return key.length > 0 ? key : null;
}

/** Concatenate the plain-text value of a metadata paragraph (nodes after the key). */
function metadataValueOf(node: TipTapNode): string {
  const content = node.content as TipTapNode[];
  return content
    .slice(1)
    .map((child) => (typeof child.text === "string" ? child.text : ""))
    .join("");
}

/** True for a paragraph with no visible content (TipTap's "empty doc" filler). */
function isEmptyParagraph(node: unknown): boolean {
  const paragraph = node as TipTapNode | null;
  if (!paragraph || paragraph.type !== "paragraph") return false;
  const content = paragraph.content;
  return !Array.isArray(content) || content.length === 0;
}

/**
 * Normalize a run's stored `docs` value into a mutable TipTap doc object.
 * The field is Json in the schema and reaches API consumers either as an
 * object or as a JSON string (both shapes exist in the wild — the run page
 * parses both). Unparseable strings are preserved as a plain paragraph
 * rather than discarded. A doc containing only an empty paragraph is
 * treated as empty so merged metadata doesn't start with a blank line.
 */
function normalizeDoc(existing: unknown): TipTapNode {
  if (existing === null || existing === undefined) {
    return { type: "doc", content: [] };
  }
  if (typeof existing === "string") {
    if (!existing.trim()) return { type: "doc", content: [] };
    try {
      return normalizeDoc(JSON.parse(existing));
    } catch {
      // Not JSON — preserve the raw text as a plain paragraph (shared
      // tipTapDoc helper produces the canonical single-paragraph doc).
      return JSON.parse(tipTapDoc(existing)) as TipTapNode;
    }
  }
  if (typeof existing === "object") {
    const doc = existing as TipTapNode;
    const content = Array.isArray(doc.content) ? [...doc.content] : [];
    if (content.length === 1 && isEmptyParagraph(content[0])) {
      return { ...doc, type: "doc", content: [] };
    }
    return { ...doc, type: "doc", content };
  }
  return { type: "doc", content: [] };
}

/**
 * Merge key/value metadata into a run's `docs` document.
 *
 * Existing metadata paragraphs with a matching key are updated in place;
 * new keys are appended at the end. All other document content is left
 * untouched. Keys that are empty after trimming are skipped. Returns a new
 * TipTap doc object (the input is not mutated) suitable for
 * `updateTestRun(id, { docs })`.
 */
export function mergeRunMetadataIntoDoc(
  existingDocs: unknown,
  metadata: RunMetadata
): Record<string, unknown> {
  const doc = normalizeDoc(existingDocs);
  const content = doc.content as TipTapNode[];

  const remaining = new Map<string, RunMetadataValue>();
  for (const [key, value] of Object.entries(metadata)) {
    if (key.trim()) remaining.set(key, value);
  }

  for (let i = 0; i < content.length; i++) {
    const key = metadataKeyOf(content[i]);
    if (key !== null && remaining.has(key)) {
      content[i] = metadataParagraph(key, remaining.get(key)!);
      remaining.delete(key);
    }
  }

  for (const [key, value] of remaining) {
    content.push(metadataParagraph(key, value));
  }

  return doc;
}

/**
 * Extract the key/value metadata pairs from a run's `docs` document.
 * Values always come back as strings (numbers/booleans are stringified on
 * write). Non-metadata content is ignored.
 */
export function parseRunMetadataFromDoc(docs: unknown): Record<string, string> {
  const doc = normalizeDoc(docs);
  const result: Record<string, string> = {};
  for (const node of doc.content as TipTapNode[]) {
    const key = metadataKeyOf(node);
    if (key !== null) {
      result[key] = metadataValueOf(node);
    }
  }
  return result;
}
