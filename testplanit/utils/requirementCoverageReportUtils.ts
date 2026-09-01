import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import type { RequirementCoverageStatus } from "~/lib/services/requirementCoverage";
import {
  loadRequirementTraceability,
  type RequirementTraceabilityData,
} from "~/lib/services/requirementTraceability";
import {
  toGapRows,
  toNotRunRequirementRows,
} from "~/lib/services/requirementTraceabilityExport";
import {
  loadRequirementTraceabilitySnapshot,
  toSnapshotTraceabilityData,
} from "~/lib/services/requirementTraceabilitySnapshot";
import {
  diffSnapshotEntries,
  groupTraceabilityRows,
  scopeSnapshotEntries,
  type RequirementCoverageChangeRow,
  type SnapshotEntryRecord,
} from "~/lib/services/requirementTraceabilitySnapshotShape";
import { authOptions } from "~/server/auth";
import { authorizeReportRequest } from "~/utils/reportApiUtils";

/**
 * Server handler for two report-builder pre-built report types: the
 * requirement coverage gap report (D-2) and the requirement traceability
 * matrix report (D-3/COV-04). Both are the SAME data, viewed twice, via
 * ONE handler and ONE traceability load per request.
 *
 * 1. No SQL lives in this file. The requirement-side raw recursive closure
 *    exists exactly once, in `lib/services/requirementCoverage.ts`'s
 *    `buildClosureFragment`, pinned to a single occurrence by
 *    `issueRoleScope.containment.test.ts`'s role-predicate count. A second
 *    copy here would be a third, independently-drifting definition of
 *    "latest result" — exactly what `lib/services/requirementTraceability.ts`'s
 *    own header comment warns the next caller away from. This module
 *    composes that loader; it does not touch a db client or a query
 *    builder directly.
 * 2. Both variants derive from the ONE `loadRequirementTraceability` call
 *    below. `toGapRows(data.rows)` is literally the null-case subset of
 *    the same matrix rows the traceability variant returns unfiltered —
 *    so the gap report and the matrix can never disagree about what is
 *    uncovered. Calling the loader once per variant (twice total) would
 *    reopen exactly the drift this design exists to remove.
 * 3. No cross-project variant exists here — a deliberate, recorded carve-out
 *    (26-VALIDATION.md carve-out 3), not an oversight. `getRequirementCoverage`
 *    anchors its recursive closure on a single `projectId`; a cross-project
 *    rollup would be a change to that service, not a change to this report
 *    layer, and the phase's binding constraint is to consume the service
 *    as shipped. The accepted cost of adding a cross-project variant later
 *    is touching all six report-registration sites again.
 */

export type RequirementCoverageReportVariant = "gaps" | "traceability";

export interface RequirementCoverageGapReportRow {
  id: number; // Required by DataTable - unique per row
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  requirementParentPath: string;
  requirementIssueTypeName?: string | null;
  requirementIssueTypeIconUrl?: string | null;
  requirementPriority?: string | null;
  requirementStatus?: string | null;
  /** ISO timestamp the requirement was created — how long the debt has
   * existed ("Uncovered since"). */
  requirementCreatedAt?: string | null;
  requirementRootId?: number;
  /** UNCOVERED (tier 1, zero linked cases) or NOT_RUN (opt-in tier 2,
   * cases exist but none ever executed). */
  coverageStatus: RequirementCoverageStatus;
  linkedCases: number; // 0 for a true gap; the linked count for tier 2
}

/** One row of the coverage-changes report: the pure diff row plus the
 * DataTable's required unique `id`. */
export interface RequirementCoverageChangeReportRow extends RequirementCoverageChangeRow {
  id: number;
}

export interface RequirementTraceabilityReportRow {
  id: number; // Required by DataTable - unique per row
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  requirementParentPath: string;
  requirementIssueTypeName?: string | null;
  requirementIssueTypeIconUrl?: string | null;
  requirementRootId?: number;
  testCaseId: number | null; // null => coverage gap row
  testCaseAutomated?: boolean;
  testCaseSource?: string | null;
  testCaseHasParameters?: boolean;
  testCaseName: string | null;
  caseProjectId: number | null;
  caseProjectName: string | null;
  lastStatusName: string | null; // null => not run
  lastStatusColor: string | null;
  lastExecutedAt: string | null;
  coverageStatus: RequirementCoverageStatus;
}

/** Mirrors `getRequirementCoverage`'s own `MAX_ROOT_IDS` — a scope list
 * larger than the rollup could ever be asked to anchor on is a malformed
 * request, not a bigger report. */
const MAX_REQUIREMENT_SCOPE_IDS = 1000;

/**
 * Parses the optional `requirementIds` scope parameter: the requirement
 * roots whose subtrees the report is confined to. Absent, null, or an
 * empty array all mean "the whole project" — the builder omits the key
 * when nothing is selected, and an explicit empty selection means the
 * same thing there (the `dimensionFilters` convention: empty = all).
 * Anything that isn't a list of positive integers is a 400, never a
 * silently-ignored key.
 */
function parseRequirementScopeIds(
  raw: unknown
): { ok: true; rootIds: number[] | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, rootIds: undefined };
  }
  if (!Array.isArray(raw) || raw.length > MAX_REQUIREMENT_SCOPE_IDS) {
    return { ok: false };
  }
  const rootIds = raw.map(Number);
  if (rootIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { ok: false };
  }
  return { ok: true, rootIds: rootIds.length > 0 ? rootIds : undefined };
}

const COVERAGE_STATE_VALUES = new Set([
  "PASSED",
  "FAILED",
  "NOT_RUN",
  "UNCOVERED",
]);

/**
 * Parses the traceability variant's optional `coverageStates` filter —
 * the requirement-level classified states to keep. Absent/null/empty
 * means every state (the builder omits the key when nothing is
 * selected, the `dimensionFilters` convention). Applied SERVER-side so
 * the row count, the CSV, the visualization, and a share link's stored
 * config all describe the same filtered set.
 */
function parseCoverageStates(
  raw: unknown
): { ok: true; states: Set<string> | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, states: undefined };
  }
  if (
    !Array.isArray(raw) ||
    raw.some(
      (value) => typeof value !== "string" || !COVERAGE_STATE_VALUES.has(value)
    )
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    states: raw.length > 0 ? new Set(raw as string[]) : undefined,
  };
}

/**
 * Parses an optional snapshot-id body param: absent/null means "not a
 * snapshot" (`undefined`), a positive integer is the id, anything else
 * is a 400 — never a silently-ignored key.
 */
function parseOptionalSnapshotId(
  raw: unknown
): { ok: true; id: number | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, id: undefined };
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false };
  }
  return { ok: true, id };
}

/**
 * The visibility scope a requirement report loads coverage under. One
 * resolved value per request, fed into the one loader call — never a
 * second, independently-scoped read.
 */
async function resolveReportAccessibleProjectIds(
  req: NextRequest,
  authz: { bypass: boolean },
  projectId: number
): Promise<
  | { ok: true; accessibleProjectIds: number[] | null }
  | { ok: false; response: Response }
> {
  if (authz.bypass) {
    // The share-link bypass token IS the authorization for this request
    // — already validated inside authorizeReportRequest before it
    // returned ok, matching every shipped bypass consumer's convention
    // (see app/api/report-builder/iteration-matrix/route.ts). Unlike
    // iteration-matrix's data, requirement coverage deliberately spans
    // projects (crossProjectCaseCount exists precisely because a
    // covering case can live outside the shared project), so — unlike
    // that precedent — `null` here would let an anonymous visitor see
    // case names, project names, statuses and execution dates from
    // projects the share link's own creator was never granted. There is
    // also no authenticated viewer on this path to resolve a per-user
    // scope from. Confine the request to the single project the link was
    // created for instead: the same boundary the raw project-existence
    // gate applies on every other bypass consumer.
    //
    // Semantic consequence: a shared report can UNDER-report relative to
    // the signed-in creator's own view of the same report — a covering
    // case that lives in another project never appears in the shared
    // copy, and a requirement covered only by such a case renders as a
    // gap in the shared copy even though the creator sees it as covered.
    // (A shared SNAPSHOT is the record as captured — its capturer's
    // scope was applied at capture time and the record is never
    // rewritten.)
    return { ok: true, accessibleProjectIds: [projectId] };
  }

  // Resolve auth the same way authorizeReportRequest just did — session
  // first, Bearer API-token fallback second — instead of re-reading
  // only the session. A token-authenticated caller (supported, shipped
  // capability) has no NextAuth session, so `session!.user.id` alone
  // throws and turns an authorized request into a 500.
  const session = await getServerSession(authOptions);
  const auth = await authenticateRequest(req, session);
  if (!auth.authenticated) {
    // authorizeReportRequest already authenticated this request via the
    // same helper, so this should be unreachable in practice; fail
    // closed with the real status rather than crashing into a 500.
    return {
      ok: false,
      response: Response.json({ error: auth.error }, { status: auth.status }),
    };
  }
  return {
    ok: true,
    accessibleProjectIds: await resolveViewerProjectScope(auth.user.userId),
  };
}

export async function handleRequirementCoverageReportPOST(
  req: NextRequest,
  variant: RequirementCoverageReportVariant
): Promise<Response> {
  try {
    const body = await req.json();
    const projectId = body?.projectId ? Number(body.projectId) : undefined;

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: false,
      projectId,
    });
    if (!authz.ok) return authz.response;

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const scopeIds = parseRequirementScopeIds(body?.requirementIds);
    if (!scopeIds.ok) {
      return Response.json(
        { error: "Invalid requirementIds" },
        { status: 400 }
      );
    }

    const coverageStates = parseCoverageStates(body?.coverageStates);
    if (!coverageStates.ok) {
      return Response.json(
        { error: "Invalid coverageStates" },
        { status: 400 }
      );
    }
    // Loosely-typed on purpose (the schema's `.nullish()` convention): a
    // restored share config may carry an explicit null.
    const includeNotRun = body?.includeNotRun === true;

    const snapshotId = parseOptionalSnapshotId(body?.snapshotId);
    if (!snapshotId.ok) {
      return Response.json({ error: "Invalid snapshotId" }, { status: 400 });
    }

    const resolvedScope = await resolveReportAccessibleProjectIds(
      req,
      authz,
      projectId
    );
    if (!resolvedScope.ok) return resolvedScope.response;
    const { accessibleProjectIds } = resolvedScope;

    let data: RequirementTraceabilityData;
    if (snapshotId.id !== undefined) {
      // A persisted snapshot stands in for the live matrix: the SAME
      // row shape, unfolded from the stored entries, so everything
      // below (gap tiers, state filter, row mapping) is snapshot-blind.
      // Scope is applied over the parent ids frozen at capture.
      const loaded = await loadRequirementTraceabilitySnapshot(
        snapshotId.id,
        projectId
      );
      if (!loaded) {
        return Response.json({ error: "Snapshot not found" }, { status: 404 });
      }
      data = toSnapshotTraceabilityData(
        loaded,
        scopeIds.rootIds !== undefined
          ? scopeSnapshotEntries(loaded.entries, scopeIds.rootIds)
          : loaded.entries
      );
    } else {
      // The scoped call passes the loader's default db client explicitly —
      // the options bag is the fourth parameter, and `undefined` there keeps
      // the default-parameter semantics identical to the two-argument call
      // the unscoped path (and its existing tests) rely on.
      data =
        scopeIds.rootIds !== undefined
          ? await loadRequirementTraceability(
              projectId,
              { accessibleProjectIds },
              undefined,
              { rootIds: scopeIds.rootIds }
            )
          : await loadRequirementTraceability(projectId, {
              accessibleProjectIds,
            });
    }

    if (variant === "gaps") {
      // Tier 1 (zero linked cases) always; tier 2 (linked but never run)
      // only when the caller opted in — both derived from the SAME matrix
      // rows, so the debt report can never disagree with traceability.
      const debtRows = [
        ...toGapRows(data.rows),
        ...(includeNotRun ? toNotRunRequirementRows(data.rows) : []),
      ];
      const rows: RequirementCoverageGapReportRow[] = debtRows.map(
        (row, index) => ({
          id: index,
          requirementId: row.requirementId,
          requirementKey: row.requirementKey,
          requirementTitle: row.requirementTitle,
          requirementPath: row.requirementPath,
          requirementParentPath: row.requirementParentPath,
          requirementIssueTypeName: row.requirementIssueTypeName,
          requirementIssueTypeIconUrl: row.requirementIssueTypeIconUrl,
          requirementPriority: row.requirementPriority,
          requirementStatus: row.requirementStatus,
          requirementCreatedAt: row.requirementCreatedAt,
          requirementRootId: row.requirementRootId,
          coverageStatus: row.coverageStatus,
          linkedCases: row.linkedCaseCount,
        })
      );
      return Response.json({ data: rows, total: rows.length });
    }

    const matrixRows = coverageStates.states
      ? data.rows.filter((row) =>
          coverageStates.states!.has(row.coverageStatus)
        )
      : data.rows;
    const rows: RequirementTraceabilityReportRow[] = matrixRows.map(
      (row, index) => ({
        id: index,
        requirementId: row.requirementId,
        requirementKey: row.requirementKey,
        requirementTitle: row.requirementTitle,
        requirementPath: row.requirementPath,
        requirementParentPath: row.requirementParentPath,
        requirementIssueTypeName: row.requirementIssueTypeName,
        requirementIssueTypeIconUrl: row.requirementIssueTypeIconUrl,
        requirementRootId: row.requirementRootId,
        testCaseId: row.caseId,
        testCaseAutomated: row.caseAutomated,
        testCaseSource: row.caseSource,
        testCaseHasParameters: row.caseHasParameters,
        testCaseName: row.caseName,
        caseProjectId: row.caseProjectId,
        caseProjectName: row.caseProjectName,
        lastStatusName: row.statusName,
        lastStatusColor: row.statusColor,
        lastExecutedAt: row.executedAt,
        coverageStatus: row.coverageStatus,
      })
    );
    return Response.json({ data: rows, total: rows.length });
  } catch (e: unknown) {
    // Deliberately stricter than the shipped issue-test-coverage analog,
    // which echoes `e.message` into the response body: this handler logs
    // the internal error server-side only and returns a generic message,
    // so an unexpected DB/service error never leaks implementation detail
    // to the client.
    console.error("Requirement coverage report error:", e);
    return Response.json(
      { error: "Failed to build requirement coverage report" },
      { status: 500 }
    );
  }
}

/**
 * Server handler for the requirement coverage CHANGES report: a baseline
 * snapshot diffed against either a later snapshot or the live matrix,
 * one row per requirement whose coverage differs (all requirements with
 * `includeUnchanged`). The live side rides the same loader the other two
 * requirement reports use, folded through the same pure grouping the
 * capture applies, so "live" here and "the snapshot you would capture
 * now" are the same thing by construction.
 *
 * Both sides are scoped AFTER loading, over each side's own frozen (or
 * just-read) parent ids, so a scoped diff compares the same subtree
 * membership rule on both sides.
 */
export async function handleRequirementCoverageChangesPOST(
  req: NextRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const projectId = body?.projectId ? Number(body.projectId) : undefined;

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: false,
      projectId,
    });
    if (!authz.ok) return authz.response;

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const scopeIds = parseRequirementScopeIds(body?.requirementIds);
    if (!scopeIds.ok) {
      return Response.json(
        { error: "Invalid requirementIds" },
        { status: 400 }
      );
    }

    const baseline = parseOptionalSnapshotId(body?.baselineSnapshotId);
    if (!baseline.ok || baseline.id === undefined) {
      return Response.json(
        { error: "baselineSnapshotId is required" },
        { status: 400 }
      );
    }
    const comparison = parseOptionalSnapshotId(body?.compareSnapshotId);
    if (!comparison.ok) {
      return Response.json(
        { error: "Invalid compareSnapshotId" },
        { status: 400 }
      );
    }
    const includeUnchanged = body?.includeUnchanged === true;

    const resolvedScope = await resolveReportAccessibleProjectIds(
      req,
      authz,
      projectId
    );
    if (!resolvedScope.ok) return resolvedScope.response;
    const { accessibleProjectIds } = resolvedScope;

    const baselineLoaded = await loadRequirementTraceabilitySnapshot(
      baseline.id,
      projectId
    );
    if (!baselineLoaded) {
      return Response.json(
        { error: "Baseline snapshot not found" },
        { status: 404 }
      );
    }

    let comparisonEntries: SnapshotEntryRecord[];
    if (comparison.id !== undefined) {
      const comparisonLoaded = await loadRequirementTraceabilitySnapshot(
        comparison.id,
        projectId
      );
      if (!comparisonLoaded) {
        return Response.json(
          { error: "Comparison snapshot not found" },
          { status: 404 }
        );
      }
      comparisonEntries = comparisonLoaded.entries;
    } else {
      const live = await loadRequirementTraceability(projectId, {
        accessibleProjectIds,
      });
      comparisonEntries = groupTraceabilityRows(live.rows);
    }

    const baselineEntries =
      scopeIds.rootIds !== undefined
        ? scopeSnapshotEntries(baselineLoaded.entries, scopeIds.rootIds)
        : baselineLoaded.entries;
    if (scopeIds.rootIds !== undefined) {
      comparisonEntries = scopeSnapshotEntries(
        comparisonEntries,
        scopeIds.rootIds
      );
    }

    const changeRows = diffSnapshotEntries(baselineEntries, comparisonEntries);
    const rows: RequirementCoverageChangeReportRow[] = (
      includeUnchanged
        ? changeRows
        : changeRows.filter((row) => row.changeKind !== "UNCHANGED")
    ).map((row, index) => ({ id: index, ...row }));

    return Response.json({ data: rows, total: rows.length });
  } catch (e: unknown) {
    console.error("Requirement coverage changes report error:", e);
    return Response.json(
      { error: "Failed to build requirement coverage changes report" },
      { status: 500 }
    );
  }
}
