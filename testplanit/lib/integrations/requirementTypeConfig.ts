/**
 * The `config.requirements` namespace contract for `ProjectIntegration.config`
 * (schema.zmodel:4719, comment: "namespaces milestoneSync, requirements").
 *
 * PURE module: zero imports. It is imported by a "use client" settings card
 * (requirements-config-settings.tsx), a server route
 * (requirements-config/route.ts) and SyncService's per-issue write path, so
 * it must never reach for a db client, next-auth, or any server-only module
 * — doing so would pull server-only code into the client bundle.
 *
 * `effectiveRequirementTypeIds` is the SINGLE definition of "which issue
 * types classify as requirements" for the whole phase: the sync writer, the
 * recompute route and the settings card's impact preview all call it, so
 * the enable switch, the recompute predicate and the previewed count can
 * never disagree.
 */

export interface RequirementTypeConfig {
  enabled: boolean;
  issueTypeIds: string[];
  /** display-only, id -> tracker display name; lets the settings card
   *  render saved selections without a tracker round trip */
  issueTypeNames?: Record<string, string>;
}

export const MAX_REQUIREMENT_TYPE_IDS = 200;

export const DEFAULT_REQUIREMENT_TYPE_CONFIG: RequirementTypeConfig = {
  enabled: false,
  issueTypeIds: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Filters to non-empty strings, de-duplicated with first-occurrence order
 *  preserved, capped at MAX_REQUIREMENT_TYPE_IDS. Never throws. */
function coerceIssueTypeIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || entry.length === 0) {
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
    if (result.length >= MAX_REQUIREMENT_TYPE_IDS) {
      break;
    }
  }
  return result;
}

function coerceIssueTypeNames(
  input: unknown
): Record<string, string> | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }
  const result: Record<string, string> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      result[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? result : undefined;
}

/**
 * Reads the `requirements` key off an arbitrary `ProjectIntegration.config`
 * value and coerces defensively. Runs on the sync hot path for every synced
 * issue, so it must never throw on malformed stored JSON: a non-object
 * `rawConfig` or non-object `requirements` reads as absent (the default
 * shape); `enabled` is true only when the stored value is literally `true`;
 * `issueTypeIds` is filtered/de-duped/capped; `issueTypeNames` keeps only
 * string -> string entries.
 */
export function readRequirementTypeConfig(
  rawConfig: unknown
): RequirementTypeConfig {
  if (!isPlainObject(rawConfig)) {
    return { ...DEFAULT_REQUIREMENT_TYPE_CONFIG };
  }
  const requirements = rawConfig.requirements;
  if (!isPlainObject(requirements)) {
    return { ...DEFAULT_REQUIREMENT_TYPE_CONFIG };
  }
  const result: RequirementTypeConfig = {
    enabled: requirements.enabled === true,
    issueTypeIds: coerceIssueTypeIds(requirements.issueTypeIds),
  };
  const issueTypeNames = coerceIssueTypeNames(requirements.issueTypeNames);
  if (issueTypeNames) {
    result.issueTypeNames = issueTypeNames;
  }
  return result;
}

/**
 * The single definition of "which types classify" for the whole phase.
 * Returns `[]` when `cfg.enabled` is false, otherwise `cfg.issueTypeIds`.
 * The sync writer, the recompute route and the impact preview all call
 * this — never re-derive the enabled/ids gate separately.
 */
export function effectiveRequirementTypeIds(
  cfg: RequirementTypeConfig
): string[] {
  return cfg.enabled ? cfg.issueTypeIds : [];
}

/**
 * The designation inputs one external issue contributes to requirement
 * classification: its tracker type id (when the tracker models types)
 * and its label names (when it does not). Mirrors the two `IssueData`
 * fields the sync path reads (`issueType?.id`, `labels`).
 */
export interface RequirementDesignationInput {
  issueTypeId?: string | null;
  labels?: string[] | null;
}

/**
 * Whether one external issue matches the effective designation list.
 *
 * Trackers that model issue types (Jira, Azure DevOps, GitLab, Redmine,
 * MantisBT) match on the TYPE ID ALONE. A tracker that models no types
 * — GitHub, whose `getIssueTypes` serves repository LABELS as the
 * designation vocabulary — leaves `issueTypeId` empty on every mapped
 * issue, and only then do labels match: any configured entry present in
 * the issue's label list designates it. Labels never override a real
 * type: a typed tracker's issue whose label happens to collide with a
 * configured type id must not classify through the collision. That
 * asymmetry is the whole contract — keep it in exactly this one
 * function (the sync writer, the import filter and the recompute all
 * express it), or the three will drift.
 */
export function matchesRequirementDesignation(
  effectiveTypeIds: string[],
  issue: RequirementDesignationInput
): boolean {
  if (effectiveTypeIds.length === 0) {
    return false;
  }
  if (issue.issueTypeId != null && issue.issueTypeId !== "") {
    return effectiveTypeIds.includes(issue.issueTypeId);
  }
  const labels = issue.labels ?? [];
  return labels.some((label) => effectiveTypeIds.includes(label));
}

/**
 * Returns `{ ...(plain-object rawConfig or {}), requirements: next }`.
 * Never mutates the input. The spread over `rawConfig` is what protects
 * the sibling `milestoneSync` namespace living on the same shared `config`
 * Json column — a wholesale replace would silently delete it.
 */
export function mergeRequirementTypeConfig(
  rawConfig: unknown,
  next: RequirementTypeConfig
): Record<string, unknown> {
  const base = isPlainObject(rawConfig) ? rawConfig : {};
  return { ...base, requirements: next };
}

/** Order-stable set differences between two issue-type id lists. */
export function diffRequirementTypeIds(
  prev: string[],
  next: string[]
): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((id) => !prevSet.has(id));
  const removed = prev.filter((id) => !nextSet.has(id));
  return { added, removed };
}

/**
 * The route's 400-gate: returns `null` (meaning "reject the request") when
 * the input is not an array, contains a non-string or empty-string entry,
 * or exceeds MAX_REQUIREMENT_TYPE_IDS; otherwise returns the de-duplicated
 * array. The cap exists so a hostile or buggy client cannot hand the
 * recompute an unbounded `ANY(...)` array.
 */
export function sanitizeRequirementTypeIds(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }
  if (input.length > MAX_REQUIREMENT_TYPE_IDS) {
    return null;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || entry.length === 0) {
      return null;
    }
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
