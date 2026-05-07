import type { Prisma } from "@prisma/client";
import { zenstack, lookup } from "../../api.js";
import { TestPlanItHttpError } from "../../http.js";
import type { EnvConfig } from "../../env.js";

/**
 * Resolve tag IDs from a mixed array of existing IDs (numbers) and tag
 * names (strings). Names are resolved via lookup with createIfMissing:true,
 * so the first reference to a new tag name lazily creates it. Empty string
 * tags are rejected (Pitfall 5). Shared between cases/create.ts and
 * cases/update.ts to avoid divergent copies (WR-07).
 */
export async function resolveTagIds(
  tags: Array<number | string> | undefined,
  env: EnvConfig,
): Promise<number[]> {
  if (!tags || tags.length === 0) return [];
  const out: number[] = [];
  for (const t of tags) {
    if (typeof t === "number") {
      out.push(t);
      continue;
    }
    if (typeof t !== "string" || t.length === 0) {
      throw new TestPlanItHttpError("Empty tag name not allowed.", { statusCode: 422 });
    }
    const result = await lookup({ type: "tag", name: t, createIfMissing: true }, env);
    out.push(result.id);
  }
  return out;
}

/**
 * Block-level node types per Tiptap / ProseMirror schema. Children of
 * these nodes are joined inline (no extra newlines between text runs);
 * the newline goes BETWEEN sibling block nodes only. Inline-content
 * containers (e.g., `text` itself) never appear here.
 *
 * (WR-05: previously the walker inserted "\n" between every non-paragraph
 * child, corrupting code blocks and over-indenting nested lists.)
 */
const BLOCK_TYPES = new Set([
  "paragraph",
  "code_block",
  "codeBlock",
  "heading",
  "list_item",
  "listItem",
  "blockquote",
]);

/**
 * Walk a Tiptap ProseMirror document and extract concatenated plain text.
 * Marks (bold, italic, links) are ignored — only `text` nodes contribute.
 *
 * Newlines are inserted BETWEEN block-level nodes (paragraphs, headings,
 * code blocks, list items, blockquotes) — never within them. This matches
 * Tiptap `Node.textBetween` semantics and avoids the corruption mode
 * where a code block with two text runs gets a stray newline injected
 * between the runs (WR-05).
 *
 * Defensive: returns `""` on null/undefined, or the string itself if
 * input is already a primitive string.
 */
export function extractProseMirrorText(doc: unknown): string {
  if (doc == null) return "";
  if (typeof doc === "string") return doc;

  const collectFromNode = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && typeof n.text === "string") return n.text;
    if (Array.isArray(n.content)) {
      // For block-level nodes, children are inline — concatenate without
      // separators. For container nodes (doc, bullet_list, ordered_list,
      // etc.), children are themselves blocks — join with "\n".
      const isBlock = n.type ? BLOCK_TYPES.has(n.type) : false;
      const parts = n.content.map(collectFromNode);
      return isBlock ? parts.join("") : parts.join("\n");
    }
    return "";
  };

  const root = doc as { type?: string; content?: unknown[] };
  if (Array.isArray(root)) {
    return (root as unknown[]).map(collectFromNode).join("\n");
  }
  if (root.type === "doc" && Array.isArray(root.content)) {
    return root.content.map(collectFromNode).join("\n");
  }
  return collectFromNode(doc);
}

interface RawFieldOptionAssignment {
  fieldOption?: { id: number; name: string } | null;
}

interface RawCaseFieldValueRow {
  value: unknown;
  field?: {
    displayName?: string | null;
    type?: { type?: string | null } | null;
    fieldOptions?: RawFieldOptionAssignment[] | null;
  } | null;
}

/**
 * Convert raw `caseFieldValues` rows into the flat `{ <displayName>: value }`
 * dict per D-08. For Dropdown / Multi-Select fields, resolve the stored
 * FieldOption IDs to the option's `name` so agents see the human label
 * instead of a raw FK. Other field types pass the raw value through.
 *
 * Rows with missing field metadata or unresolved option IDs fall back to
 * the raw value rather than dropping the entry.
 */
export function denormalizeCustomFields(
  rows: RawCaseFieldValueRow[] | null | undefined,
): Record<string, unknown> {
  if (!rows || rows.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const name = row.field?.displayName;
    if (typeof name !== "string" || name.length === 0) continue;
    out[name] = resolveCustomFieldValue(row.value, row.field);
  }
  return out;
}

function resolveCustomFieldValue(
  value: unknown,
  field: RawCaseFieldValueRow["field"],
): unknown {
  const type = field?.type?.type;
  const options = (field?.fieldOptions ?? [])
    .map((a) => a.fieldOption)
    .filter((o): o is { id: number; name: string } => o != null);
  if (options.length === 0) return value;

  const byId = new Map<number, string>();
  for (const o of options) byId.set(o.id, o.name);

  if (type === "Dropdown") {
    const id = coerceOptionId(value);
    if (id != null && byId.has(id)) return byId.get(id);
    return value;
  }
  if (type === "Multi-Select") {
    if (!Array.isArray(value)) return value;
    return value.map((v) => {
      const id = coerceOptionId(v);
      return id != null && byId.has(id) ? byId.get(id) : v;
    });
  }
  return value;
}

function coerceOptionId(v: unknown): number | null {
  // WR-06: option IDs are positive integers — reject non-integer numerics
  // (147.5 would have silently misrouted to FieldOption 147 via the
  // byId lookup) and reject 0 / negatives.
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Walk parent folders to build a breadcrumb from root to leaf. Bounded at
 * depth 10 to prevent pathological recursion. Each parent fetch goes through
 * `zenstack` so the host's access policies are enforced on every row.
 */
const MAX_BREADCRUMB_DEPTH = 10;

export interface FolderBreadcrumbInput {
  id: number;
  name: string;
  parentId: number | null;
}

export async function buildFolderBreadcrumb(
  leaf: FolderBreadcrumbInput,
  env: EnvConfig,
): Promise<Array<{ id: number; name: string }>> {
  const acc: Array<{ id: number; name: string }> = [{ id: leaf.id, name: leaf.name }];
  let parentId = leaf.parentId;
  let depth = 0;
  while (parentId != null) {
    if (depth >= MAX_BREADCRUMB_DEPTH) {
      throw new TestPlanItHttpError(
        `Folder breadcrumb exceeded max depth ${MAX_BREADCRUMB_DEPTH}; possible recursive parent chain.`,
        { statusCode: 422 },
      );
    }
    const parent = await zenstack<FolderBreadcrumbInput | null>(
      "repositoryFolders",
      "findUnique",
      {
        where: { id: parentId },
        select: { id: true, name: true, parentId: true } satisfies Prisma.RepositoryFoldersSelect,
      },
      env,
    );
    if (!parent) break;
    acc.unshift({ id: parent.id, name: parent.name });
    parentId = parent.parentId;
    depth += 1;
  }
  return acc;
}

/**
 * Compute the human-readable `fullPath` from a breadcrumb array.
 * Example: [{name:"Regression"},{name:"Auth"}] → "Regression / Auth".
 */
export function fullPathFromBreadcrumb(
  breadcrumb: Array<{ name: string }>,
): string {
  return breadcrumb.map((b) => b.name).join(" / ");
}

// ── Row & detail mappers ──────────────────────────────────────────────────

interface RawCaseRow {
  id: number;
  name: string;
  source: string;
  automated: boolean;
  createdAt: string | Date;
  project: { id: number; name: string };
  // WR-04: folderId is non-nullable in schema.zmodel — folder is always
  // present on a hydrated row. Call sites in get.ts / fetchDetail.ts
  // dereference raw.folder.id without a null check, so widening the
  // type here would create a runtime / compile-time mismatch.
  folder: { id: number; name: string; parentId: number | null };
  state: { id: number; name: string };
  creator: { id: string; name: string | null; email: string };
  tags: Array<{ id: number; name: string }>;
}

export function mapCaseRow(raw: RawCaseRow) {
  return {
    id: raw.id,
    name: raw.name,
    source: raw.source,
    automated: raw.automated,
    createdAt: raw.createdAt,
    project: raw.project ? { id: raw.project.id, name: raw.project.name } : null,
    folder: { id: raw.folder.id, name: raw.folder.name },
    state: raw.state ? { id: raw.state.id, name: raw.state.name } : null,
    creator: raw.creator
      ? { id: raw.creator.id, name: raw.creator.name, email: raw.creator.email }
      : null,
    tags: (raw.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

interface RawCaseDetail extends RawCaseRow {
  issues: Array<{
    id: number;
    externalKey: string | null;
    integration: { provider: string } | null;
    title: string | null;
    externalStatus: string | null;
  }>;
  steps: Array<{
    id: number;
    order: number;
    step: unknown;
    expectedResult: unknown;
  }>;
  caseFieldValues: RawCaseFieldValueRow[];
  linksFrom: Array<{ caseB: { id: number; name: string; source: string } }>;
  linksTo: Array<{ caseA: { id: number; name: string; source: string } }>;
}

export function mapCaseDetail(
  raw: RawCaseDetail,
  breadcrumb: Array<{ id: number; name: string }>,
) {
  const linkedAutomatedTests = [
    ...raw.linksFrom.map((l) => l.caseB),
    ...raw.linksTo.map((l) => l.caseA),
  ]
    .filter((c) => c && c.source !== "MANUAL")
    .map((c) => ({ id: c.id, name: c.name, source: c.source }));

  return {
    ...mapCaseRow(raw),
    folderBreadcrumb: breadcrumb,
    folderFullPath: fullPathFromBreadcrumb(breadcrumb),
    steps: (raw.steps ?? []).map((s) => ({
      id: s.id,
      order: s.order,
      step: extractProseMirrorText(s.step),
      expectedResult: extractProseMirrorText(s.expectedResult),
    })),
    customFields: denormalizeCustomFields(raw.caseFieldValues),
    issues: (raw.issues ?? []).map((i) => ({
      id: i.id,
      externalKey: i.externalKey,
      externalSystem: i.integration?.provider ?? null,
      title: i.title,
      externalStatus: i.externalStatus,
    })),
    linkedAutomatedTests,
  };
}
