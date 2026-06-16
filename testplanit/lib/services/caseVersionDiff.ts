import { calculateDiff } from "./auditLog";

/**
 * The slice of a RepositoryCaseVersions snapshot whose changes are NOT captured
 * by the scalar RepositoryCases audit entry: the custom field values plus the
 * relation snapshots (steps, tags, issues, parameters). Every test-case save
 * writes a new version snapshot, so diffing consecutive snapshots yields the
 * content a single edit changed.
 */
export interface CaseVersionContent {
  steps?: unknown;
  tags?: unknown;
  issues?: unknown;
  parameters?: unknown;
  /** Custom field values, keyed in the snapshot by the field's display name. */
  caseFieldVersionValues?: { field: string; value: unknown }[];
}

/** Stable keys for the relation snapshots in the flattened content map. */
const RELATION_KEYS = {
  steps: "Steps",
  tags: "Tags",
  issues: "Issues",
  parameters: "Parameters",
} as const;

/**
 * Flatten a version snapshot's content into a single key->value map that
 * calculateDiff can compare. Custom fields are keyed by their display name (as
 * stored on CaseFieldVersionValues.field); the relation snapshots take the
 * reserved keys above. A custom field whose display name collides with a
 * reserved key is overwritten by the relation snapshot — acceptable for an
 * audit summary and vanishingly rare in practice.
 */
export function flattenVersionContent(
  v: CaseVersionContent
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const fv of v.caseFieldVersionValues ?? []) {
    out[fv.field] = fv.value ?? null;
  }
  out[RELATION_KEYS.steps] = v.steps ?? null;
  out[RELATION_KEYS.tags] = v.tags ?? null;
  out[RELATION_KEYS.issues] = v.issues ?? null;
  out[RELATION_KEYS.parameters] = v.parameters ?? null;
  return out;
}

/**
 * Compute the content diff between two consecutive version snapshots
 * (previous -> current). Returns only changed entries, or undefined when the
 * content is identical (e.g. a scalar-only edit such as a rename).
 */
export function diffCaseVersionContent(
  previous: CaseVersionContent,
  current: CaseVersionContent
): Record<string, { old: unknown; new: unknown }> | undefined {
  return calculateDiff(
    flattenVersionContent(previous),
    flattenVersionContent(current)
  );
}
