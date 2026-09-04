import { estimatePromptTokens } from "~/lib/llm/content";

const VARIABLE_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;
const ELLIPSIS = "…";
const SHORT_SHA_LENGTH = 7;
const STEPS_FIELD_TYPE = "Steps";

/**
 * Single-pass `{{NAME}}` substitution. Values are inserted literally (no
 * `$&`/`$1` expansion) and are never re-scanned for further placeholders.
 * Unknown placeholders are left in place.
 */
export function substituteVariables(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(VARIABLE_PATTERN, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

export interface CompressedCase {
  id: number;
  name: string;
  folderPath?: string;
  tags?: string[];
  fields?: Record<string, string>;
}

export interface CompressionLimits {
  truncateCaseName: number;
  truncateTextLong: number;
  truncateOtherField: number;
}

export interface RawCaseFolder {
  name: string;
  parent?: RawCaseFolder | null;
}

export type RawFieldOptions = Array<{
  fieldOption: { id: number; name: string };
}>;

export interface RawCaseFieldValue {
  value: unknown;
  field?: {
    displayName?: string | null;
    systemName?: string | null;
    type?: { type: string } | null;
    fieldOptions?: RawFieldOptions | null;
  } | null;
}

export interface RawCaseForPrompt {
  id: number;
  name: string;
  folder?: RawCaseFolder | null;
  caseTags?: Array<{ tag: { name: string } }> | null;
  caseFieldValues?: RawCaseFieldValue[] | null;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + ELLIPSIS;
}

function extractTextFromTipTap(content: unknown): string {
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

function buildFolderPath(folder: RawCaseFolder | null | undefined): string {
  const parts: string[] = [];
  let current: RawCaseFolder | null | undefined = folder;
  while (current) {
    parts.unshift(current.name);
    current = current.parent;
  }
  return "/" + parts.join("/");
}

function processFieldValue(
  value: unknown,
  fieldType: string | undefined,
  fieldOptions: RawFieldOptions | null | undefined,
  limits: CompressionLimits
): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (fieldType === "Select" || fieldType === "Dropdown") {
    if (typeof value === "number" && fieldOptions) {
      return (
        fieldOptions.find((fo) => fo.fieldOption.id === value)?.fieldOption
          .name ?? null
      );
    }
    return null;
  }

  if (fieldType === "Multi-Select") {
    let ids: unknown[] = [];
    if (Array.isArray(value)) {
      ids = value;
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) ids = parsed;
      } catch {
        return null;
      }
    }
    if (ids.length > 0 && fieldOptions) {
      const names = ids
        .map(
          (id) =>
            fieldOptions.find((fo) => fo.fieldOption.id === id)?.fieldOption
              .name
        )
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? names.join(", ") : null;
    }
    return null;
  }

  if (fieldType === "Text Long") {
    const text = extractTextFromTipTap(value).trim();
    return text ? truncateText(text, limits.truncateTextLong) : null;
  }

  return truncateText(String(value), limits.truncateOtherField);
}

/** Mirrors Magic Select's case compression; Steps-type fields are skipped. */
export function compressCase(
  raw: RawCaseForPrompt,
  limits: CompressionLimits
): CompressedCase {
  const compressed: CompressedCase = {
    id: raw.id,
    name: truncateText(raw.name, limits.truncateCaseName),
  };

  const folderPath = buildFolderPath(raw.folder);
  if (folderPath !== "/") compressed.folderPath = folderPath;

  const tags = (raw.caseTags ?? [])
    .map((ct) => ct.tag?.name)
    .filter((name): name is string => Boolean(name));
  if (tags.length > 0) compressed.tags = tags;

  const fields: Record<string, string> = {};
  for (const cfv of raw.caseFieldValues ?? []) {
    const fieldName = cfv.field?.displayName || cfv.field?.systemName;
    if (!fieldName) continue;
    const fieldType = cfv.field?.type?.type;
    if (fieldType === STEPS_FIELD_TYPE) continue;
    const processed = processFieldValue(
      cfv.value,
      fieldType,
      cfv.field?.fieldOptions,
      limits
    );
    if (processed) fields[fieldName] = processed;
  }
  if (Object.keys(fields).length > 0) compressed.fields = fields;

  return compressed;
}

/** One JSON array per line: `[id, name, folder?, tags[]?, fields?]`, trailing nulls trimmed. */
export function serializeCasesPositional(cases: CompressedCase[]): string {
  return cases
    .map((c) => {
      const row: unknown[] = [
        c.id,
        c.name,
        c.folderPath && c.folderPath !== "/" ? c.folderPath : null,
        c.tags && c.tags.length > 0 ? c.tags : null,
        c.fields && Object.keys(c.fields).length > 0 ? c.fields : null,
      ];
      while (row.length > 2 && row[row.length - 1] === null) row.pop();
      return JSON.stringify(row);
    })
    .join("\n");
}

export interface ImpactPromptContext {
  baseSha: string;
  headSha: string;
  notes?: string;
  diffText: string;
  changedFileCount: number;
  excludedCount: number;
  pinnedCaseIds: number[];
  candidates: CompressedCase[];
  /** Zero-based; rendered as `batch {batchIndex + 1} of {batchCount}`. */
  batchIndex: number;
  batchCount: number;
}

function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

export function buildImpactVariables(
  ctx: ImpactPromptContext
): Record<string, string> {
  const notes = ctx.notes?.trim();
  return {
    BASE_SHA: shortSha(ctx.baseSha),
    HEAD_SHA: shortSha(ctx.headSha),
    USER_NOTES_SECTION: notes ? `\nTESTER NOTES:\n${notes}\n` : "",
    CHANGED_FILE_COUNT: String(ctx.changedFileCount),
    EXCLUDED_FILE_NOTE:
      ctx.excludedCount > 0
        ? `, ${ctx.excludedCount} excluded: lockfiles/generated/binary`
        : "",
    DIFF_SUMMARY: ctx.diffText,
    PINNED_CASES_NOTE:
      ctx.pinnedCaseIds.length > 0
        ? `Already selected by Code Pins (do not re-select): [${ctx.pinnedCaseIds.join(", ")}]`
        : "",
    CANDIDATE_COUNT: String(ctx.candidates.length),
    BATCH_NOTE:
      ctx.batchCount > 1
        ? `, batch ${ctx.batchIndex + 1} of ${ctx.batchCount}`
        : "",
    CANDIDATE_CASES: serializeCasesPositional(ctx.candidates),
  };
}

export function buildUserPrompt(
  template: string,
  ctx: ImpactPromptContext
): string {
  return substituteVariables(template, buildImpactVariables(ctx));
}

/** Token estimate for everything except the candidate rows, so the worker can size batches. */
export function estimateFixedPromptTokens(
  systemPrompt: string,
  template: string,
  diffText: string
): number {
  const rendered = buildUserPrompt(template, {
    baseSha: "0000000",
    headSha: "0000000",
    diffText,
    changedFileCount: 0,
    excludedCount: 0,
    pinnedCaseIds: [],
    candidates: [],
    batchIndex: 0,
    batchCount: 1,
  });
  return estimatePromptTokens([
    { role: "system", content: systemPrompt },
    { role: "user", content: rendered },
  ]);
}
