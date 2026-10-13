import type { ParamInputDescription } from "./params";

/**
 * Run-level metadata, server side.
 *
 * A test run has no key/value metadata table; the reporters write metadata
 * into the run's `docs` rich-text document as one paragraph per entry, a
 * bold `key: ` prefix followed by the plain value, and merge by key so
 * hand-written documentation around the entries survives. This module is
 * the same shape and merge rule (see `runMetadata.ts` in `@testplanit/api`,
 * which the reporters use) so an entry written here and one written by a
 * reporter round-trip through each other.
 */

const KEY_SUFFIX = ": ";

type TipTapNode = Record<string, unknown>;

export type RunMetadata = Record<string, string>;

function metadataParagraph(key: string, value: string): TipTapNode {
  const content: TipTapNode[] = [
    { type: "text", marks: [{ type: "bold" }], text: `${key}${KEY_SUFFIX}` },
  ];
  // An empty text node is invalid in ProseMirror; omit the value node.
  if (value) content.push({ type: "text", text: value });
  return { type: "paragraph", content };
}

/** The key of a metadata paragraph (first text node bold, ending in `: `), else null. */
export function metadataKeyOf(node: unknown): string | null {
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

function isEmptyParagraph(node: unknown): boolean {
  const paragraph = node as TipTapNode | null;
  if (!paragraph || paragraph.type !== "paragraph") return false;
  const content = paragraph.content;
  return !Array.isArray(content) || content.length === 0;
}

/**
 * A stored `docs` value as a mutable doc. The column is Json and holds
 * either a doc object or a JSON string of one (both shapes are in the
 * wild). Text that is not JSON is kept as a plain paragraph; a doc holding
 * only TipTap's empty filler paragraph counts as empty.
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
      return {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: existing }] },
        ],
      };
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
 * Merge metadata into a run's docs: an existing paragraph with the same key
 * is rewritten in place, new keys are appended, everything else is left
 * alone. Returns a new doc object; the input is not mutated.
 */
export function mergeRunMetadataIntoDoc(
  existingDocs: unknown,
  metadata: RunMetadata
): TipTapNode {
  const doc = normalizeDoc(existingDocs);
  const content = doc.content as TipTapNode[];
  const remaining = new Map<string, string>();
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
  return { ...doc, content };
}

/**
 * The run metadata an execution's parameter choices become: one entry per
 * declared parameter, keyed by the parameter's label. Undeclared inputs
 * (static target inputs, an API caller's extras) are not metadata: nobody
 * chose them for this run.
 */
export function runMetadataFromParams(
  inputs: ParamInputDescription[]
): RunMetadata {
  const out: RunMetadata = {};
  for (const input of inputs) {
    if (!input.declared) continue;
    const key = input.label.trim();
    if (!key) continue;
    out[key] = input.values.join(", ");
  }
  return out;
}
