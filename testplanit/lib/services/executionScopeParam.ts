import { z } from "zod/v4";

import {
  isExecutionScopeActive,
  type LatestResultExecutionScope,
} from "~/lib/services/latestCaseResults";

/**
 * The one wire format for the requirement coverage family's execution
 * scope (milestone/configuration — see `latestCaseResults.ts`): every
 * route that accepts the scope parses it through this module, so
 * "absent, null, and [] all mean the axis is inactive" cannot drift
 * between the tree route, the coverage routes, the report handlers, and
 * snapshot capture.
 */

/** Per-axis id-list cap. A scope names the milestones/configurations a
 * release frame cares about — a list past this size is a malformed
 * request, not a bigger frame. */
export const MAX_EXECUTION_SCOPE_IDS = 200;

const axisSchema = z
  .array(z.number().int().positive())
  .max(MAX_EXECUTION_SCOPE_IDS)
  .nullish();

/** Body fragment for zod-validated routes: spread into the route's own
 * `z.object` so the two keys validate exactly like the imperative parser
 * below. `.nullish()` — a restored share config may carry explicit null. */
export const executionScopeBodyShape = {
  milestoneIds: axisSchema,
  configIds: axisSchema,
};

/** Folds the two validated body values into a scope, or `undefined` when
 * neither axis is active — callers never see an empty-shell scope. */
export function toExecutionScope(input: {
  milestoneIds?: number[] | null;
  configIds?: number[] | null;
}): LatestResultExecutionScope | undefined {
  const scope: LatestResultExecutionScope = {
    milestoneIds: input.milestoneIds ?? undefined,
    configIds: input.configIds ?? undefined,
  };
  return isExecutionScopeActive(scope) ? scope : undefined;
}

/**
 * Imperative equivalent for handlers that hand-parse their JSON body
 * (`utils/requirementCoverageReportUtils.ts`'s convention): each raw value
 * is absent/null (inactive), or a bounded list of positive integers —
 * anything else is a 400, never a silently-ignored key.
 */
export function parseExecutionScopeBody(
  rawMilestoneIds: unknown,
  rawConfigIds: unknown
): { ok: true; scope: LatestResultExecutionScope | undefined } | { ok: false } {
  const milestone = parseAxis(rawMilestoneIds);
  if (!milestone.ok) return { ok: false };
  const config = parseAxis(rawConfigIds);
  if (!config.ok) return { ok: false };
  return {
    ok: true,
    scope: toExecutionScope({
      milestoneIds: milestone.ids,
      configIds: config.ids,
    }),
  };
}

/**
 * Query-string form (`?milestoneIds=1,2&configIds=3`) for the GET routes.
 * A missing key is an inactive axis; an empty or malformed value is a 400.
 */
export function parseExecutionScopeQuery(
  searchParams: URLSearchParams
): { ok: true; scope: LatestResultExecutionScope | undefined } | { ok: false } {
  const milestone = parseCsvAxis(searchParams.get("milestoneIds"));
  if (!milestone.ok) return { ok: false };
  const config = parseCsvAxis(searchParams.get("configIds"));
  if (!config.ok) return { ok: false };
  return {
    ok: true,
    scope: toExecutionScope({
      milestoneIds: milestone.ids,
      configIds: config.ids,
    }),
  };
}

function parseAxis(
  raw: unknown
): { ok: true; ids: number[] | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, ids: undefined };
  }
  if (!Array.isArray(raw) || raw.length > MAX_EXECUTION_SCOPE_IDS) {
    return { ok: false };
  }
  const ids = raw.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { ok: false };
  }
  return { ok: true, ids: ids.length > 0 ? ids : undefined };
}

function parseCsvAxis(
  raw: string | null
): { ok: true; ids: number[] | undefined } | { ok: false } {
  if (raw === null) {
    return { ok: true, ids: undefined };
  }
  const parts = raw.split(",").filter((part) => part !== "");
  return parseAxis(parts);
}

/** Order-insensitive equality of two frozen scope axis lists — the changes
 * report's "same frame" check between a baseline and a comparison
 * snapshot. A missing axis (a header from before the columns existed)
 * reads as inactive, the same shape an empty array carries. */
export function sameExecutionScope(
  a: { scopeMilestoneIds?: number[]; scopeConfigIds?: number[] },
  b: { scopeMilestoneIds?: number[]; scopeConfigIds?: number[] }
): boolean {
  const sameSet = (x: number[] = [], y: number[] = []) =>
    x.length === y.length &&
    [...x].sort((m, n) => m - n).join(",") ===
      [...y].sort((m, n) => m - n).join(",");
  return (
    sameSet(a.scopeMilestoneIds, b.scopeMilestoneIds) &&
    sameSet(a.scopeConfigIds, b.scopeConfigIds)
  );
}
