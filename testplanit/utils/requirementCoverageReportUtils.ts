import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import {
  parseExecutionScopeBody,
  sameExecutionScope,
  toExecutionScope,
} from "~/lib/services/executionScopeParam";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
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
import {
  resolveRequirementDisplayPriority,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";
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
 * 3. Both variants ALSO ship a cross-project form (`isCrossProject`), which
 *    Phase 26 deliberately carved out (26-VALIDATION.md carve-out 3) and
 *    which was built later, as that carve-out anticipated. The change stayed
 *    where the carve-out said it belonged: `getRequirementCoverage` now
 *    anchors its closure on a LIST of project ids, and this layer only
 *    chooses the list. Two properties are load-bearing there — the closure's
 *    descendant arm binds each child to its own ancestor's project (a
 *    subtree still cannot wander between projects), and "cross-project" on
 *    a covering case is judged against the requirement's own project rather
 *    than one report-wide id. Snapshots have no cross-project form: a
 *    snapshot is captured from one project and pinned to it, so the
 *    cross-project path refuses a `snapshotId` outright.
 */

/**
 * The projects a cross-project requirement report can be filtered to: those
 * with requirements enabled, with their requirement counts. NOT the
 * repository-cases view-options list the automation-trends filter uses --
 * that one is grouped from test cases, so it omits a project that has
 * requirements but no cases and counts the wrong thing.
 */
export async function handleRequirementReportOptionsGET(
  req: NextRequest,
  isCrossProject: boolean
): Promise<Response> {
  const authz = await authorizeReportRequest(req, {
    requiresAdmin: isCrossProject,
    projectId: isCrossProject
      ? undefined
      : Number(new URL(req.url).searchParams.get("projectId")) || undefined,
  });
  if (!authz.ok) return authz.response;

  const projectIdParam = Number(new URL(req.url).searchParams.get("projectId"));
  const enabledProjects = await baseDb.projects.findMany({
    where: {
      isDeleted: false,
      ...(isCrossProject
        ? { requirementsEnabled: true }
        : { id: Number.isInteger(projectIdParam) ? projectIdParam : -1 }),
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          issues: { where: { isDeleted: false, ...REQUIREMENT_SCOPE_WHERE } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Resolved DISPLAY values, so an option always matches what the rows
  // render (a locked requirement shows its tracker's priority/status).
  // Computed over the unfiltered set, so picking one option never removes
  // the others from the menu.
  const requirements = await baseDb.issue.findMany({
    where: {
      isDeleted: false,
      ...REQUIREMENT_SCOPE_WHERE,
      projectId: { in: enabledProjects.map((project) => project.id) },
    },
    select: {
      priority: true,
      externalPriority: true,
      status: true,
      externalStatus: true,
      isRequirement: true,
      integrationId: true,
      requirementDetachedAt: true,
    },
  });

  // Grouped case-insensitively: trackers spell the same value differently
  // across projects ("Low" and "low"), and two options that read identically
  // are indistinguishable in a menu. The most common spelling wins the
  // label; the option's id is the lowercased key the filter matches on.
  const tally = (
    counts: Map<string, { count: number; labels: Map<string, number> }>,
    value: string | null
  ) => {
    if (!value) return;
    const key = value.toLowerCase();
    const entry = counts.get(key) ?? { count: 0, labels: new Map() };
    entry.count += 1;
    entry.labels.set(value, (entry.labels.get(value) ?? 0) + 1);
    counts.set(key, entry);
  };

  const priorities = new Map<
    string,
    { count: number; labels: Map<string, number> }
  >();
  const statuses = new Map<
    string,
    { count: number; labels: Map<string, number> }
  >();
  for (const requirement of requirements) {
    tally(priorities, resolveRequirementDisplayPriority(requirement));
    tally(statuses, resolveRequirementDisplayStatus(requirement));
  }
  const toOptions = (
    counts: Map<string, { count: number; labels: Map<string, number> }>
  ) =>
    [...counts.entries()]
      .map(([key, { count, labels }]) => ({
        id: key,
        name: [...labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

  // Execution-scope picker options — project-scoped reports only (a
  // milestone belongs to one project, so a cross-project scope picker
  // would be a grab-bag of same-named rows from different projects).
  // Completed milestones stay listed on purpose: "coverage on the shipped
  // release" is the milestone axis's whole point. Configurations follow
  // the run-creation picker's enabled+assigned convention.
  const [scopeMilestones, scopeConfigurations] = isCrossProject
    ? [[], []]
    : await Promise.all([
        baseDb.milestones.findMany({
          where: { projectId: projectIdParam, isDeleted: false },
          // Everything the shared MilestoneOptionContent renders — the type
          // icon, the tree position, and the tracker-source badge fields —
          // so the report's filter menu can show milestones the way every
          // other picker does.
          select: {
            id: true,
            name: true,
            parentId: true,
            integrationId: true,
            externalKind: true,
            externalState: true,
            externalUrl: true,
            detachedAt: true,
            mergedToExternalId: true,
            milestoneType: { select: { icon: { select: { name: true } } } },
          },
          orderBy: { name: "asc" },
        }),
        baseDb.configurations.findMany({
          where: {
            isDeleted: false,
            isEnabled: true,
            projects: { some: { projectId: projectIdParam } },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);

  return Response.json({
    dimensions: [],
    metrics: [],
    // Only the cross-project reports pick projects; the project-scoped ones
    // already are one project.
    projects: isCrossProject
      ? enabledProjects.map((project) => ({
          id: project.id,
          name: project.name,
          count: project._count.issues,
        }))
      : [],
    priorities: toOptions(priorities),
    statuses: toOptions(statuses),
    milestones: scopeMilestones,
    configurations: scopeConfigurations,
  });
}

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
  /** The requirement's OWN project — the only thing that says where a row
   * came from on the cross-project variant; redundant (and uniform) on the
   * project-scoped one. */
  requirementProjectId?: number | null;
  requirementProjectName?: string | null;
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
  /** Same requirement-level context the gaps report shows, so the two
   * reports describe a requirement the same way -- and so the Priority and
   * Status filters have matching columns. */
  requirementPriority?: string | null;
  requirementStatus?: string | null;
  /** The text revision the coverage was computed against — live rows carry
   * the current version, snapshot rows the version frozen at capture. */
  requirementVersion?: number | null;
  requirementRootId?: number;
  /** The requirement's OWN project, distinct from `caseProjectId` (the
   * covering case's). Carries the cross-project variant's origin column. */
  requirementProjectId?: number | null;
  requirementProjectName?: string | null;
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
 * Parses an optional list-of-strings filter (`priorities`, `statuses`) —
 * the resolved DISPLAY values the rows carry. Absent/null/empty means "no
 * filter", the same empty-means-all convention every other control here
 * uses.
 */
function parseDisplayValueFilter(
  raw: unknown
): { ok: true; values: Set<string> | undefined } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, values: undefined };
  }
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return { ok: false };
  }
  // Lowercased on both sides: the menu groups "Low" and "low" into one
  // option, so the filter has to match both.
  return {
    ok: true,
    values:
      raw.length > 0
        ? new Set((raw as string[]).map((value) => value.toLowerCase()))
        : undefined,
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
  variant: RequirementCoverageReportVariant,
  isCrossProject = false
): Promise<Response> {
  try {
    const body = await req.json();
    const projectId = body?.projectId ? Number(body.projectId) : undefined;

    const authz = await authorizeReportRequest(req, {
      // Cross-project is ADMIN-only, exactly as the shipped cross-project
      // report family is: there is no per-project gate to apply when the
      // report deliberately spans every project.
      requiresAdmin: isCrossProject,
      projectId: isCrossProject ? undefined : projectId,
    });
    if (!authz.ok) return authz.response;

    if (!isCrossProject && !projectId) {
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

    const priorities = parseDisplayValueFilter(body?.priorities);
    if (!priorities.ok) {
      return Response.json({ error: "Invalid priorities" }, { status: 400 });
    }
    const statuses = parseDisplayValueFilter(body?.statuses);
    if (!statuses.ok) {
      return Response.json({ error: "Invalid statuses" }, { status: 400 });
    }

    const executionScope = parseExecutionScopeBody(
      body?.milestoneIds,
      body?.configIds
    );
    if (!executionScope.ok) {
      return Response.json(
        { error: "Invalid milestoneIds/configIds" },
        { status: 400 }
      );
    }

    // A snapshot is captured from one project and pinned to it, so there is
    // no such thing as a cross-project snapshot to load. Refuse rather than
    // silently ignoring the parameter and returning live data under a
    // snapshot's name.
    if (isCrossProject && snapshotId.id !== undefined) {
      return Response.json(
        { error: "Snapshots are not available on cross-project reports" },
        { status: 400 }
      );
    }

    // A snapshot's execution scope was applied AT CAPTURE and its entries
    // hold only the final rollup — a different scope cannot be applied to
    // them after the fact (unlike `requirementIds`, which scopes over the
    // frozen parent ids). Refuse the combination rather than silently
    // returning the capture-time frame under a different label.
    if (snapshotId.id !== undefined && executionScope.scope !== undefined) {
      return Response.json(
        { error: "Execution scope cannot be applied to a snapshot" },
        { status: 400 }
      );
    }

    // Case visibility.
    //
    // Cross-project is unrestricted (`null`), for two different reasons
    // depending on how the request arrived. A signed-in caller had to pass
    // the ADMIN gate above, and ADMIN is exactly what
    // `resolveViewerProjectScope` answers `null` for — resolving it would
    // be a round trip to re-derive a constant. A share-link replay
    // short-circuits that gate (`authorizeReportRequest` honours the bypass
    // header before `requiresAdmin`), so it gets the same unrestricted
    // view: the link could only have been created by an admin looking at
    // every project, and a cross-project report IS the portfolio view, so
    // reproducing what its creator saw is the whole point. This is
    // deliberately UNLIKE the project-scoped path below, whose bypass
    // branch narrows to the single shared project precisely so a shared
    // copy cannot name projects the creator never meant to expose.
    let accessibleProjectIds: number[] | null = null;
    if (!isCrossProject) {
      const resolvedScope = await resolveReportAccessibleProjectIds(
        req,
        authz,
        projectId!
      );
      if (!resolvedScope.ok) return resolvedScope.response;
      accessibleProjectIds = resolvedScope.accessibleProjectIds;
    }

    // Which projects the matrix anchors on. Cross-project means every
    // project that actually has requirements turned on — anchoring on all
    // of them would make the closure walk projects that can hold no
    // requirement row by construction.
    let anchorProjectIds: number | number[] = projectId!;
    if (isCrossProject) {
      // The picker's optional narrowing, intersected with the enabled set --
      // never trusted on its own, so a crafted id cannot pull in a project
      // that has requirements switched off.
      const requested = Array.isArray(body?.projectIds)
        ? body.projectIds
            .map(Number)
            .filter((id: number) => Number.isInteger(id))
        : null;
      const enabled = await baseDb.projects.findMany({
        where: {
          isDeleted: false,
          requirementsEnabled: true,
          ...(requested && requested.length > 0
            ? { id: { in: requested } }
            : {}),
        },
        select: { id: true },
      });
      anchorProjectIds = enabled.map((project) => project.id);
    }

    let data: RequirementTraceabilityData;
    if (snapshotId.id !== undefined) {
      // A persisted snapshot stands in for the live matrix: the SAME
      // row shape, unfolded from the stored entries, so everything
      // below (gap tiers, state filter, row mapping) is snapshot-blind.
      // Scope is applied over the parent ids frozen at capture.
      const loaded = await loadRequirementTraceabilitySnapshot(
        snapshotId.id,
        projectId!
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
        scopeIds.rootIds !== undefined || executionScope.scope !== undefined
          ? await loadRequirementTraceability(
              anchorProjectIds,
              { accessibleProjectIds },
              undefined,
              {
                rootIds: scopeIds.rootIds,
                executionScope: executionScope.scope,
              }
            )
          : await loadRequirementTraceability(anchorProjectIds, {
              accessibleProjectIds,
            });
    }

    // Requirement-level filters, applied to the shared matrix rows before
    // either variant shapes them -- same reason the coverage-state filter is
    // server-side: the row count, the visualization, the CSV and any share
    // link must all describe the same filtered set.
    const matchesRequirementFilters = (row: {
      requirementPriority?: string | null;
      requirementStatus?: string | null;
    }) =>
      (!priorities.values ||
        priorities.values.has((row.requirementPriority ?? "").toLowerCase())) &&
      (!statuses.values ||
        statuses.values.has((row.requirementStatus ?? "").toLowerCase()));

    if (priorities.values || statuses.values) {
      data = { ...data, rows: data.rows.filter(matchesRequirementFilters) };
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
          requirementProjectId: row.requirementProjectId ?? null,
          requirementProjectName: row.requirementProjectName ?? null,
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
        requirementPriority: row.requirementPriority,
        requirementStatus: row.requirementStatus,
        requirementVersion: row.requirementVersion ?? null,
        requirementRootId: row.requirementRootId,
        requirementProjectId: row.requirementProjectId ?? null,
        requirementProjectName: row.requirementProjectName ?? null,
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

    // The changes report's execution frame is the BASELINE's frozen scope
    // — request-level milestone/config keys would create a second,
    // possibly-disagreeing source for the same frame, so they are refused
    // outright rather than reconciled.
    if (body?.milestoneIds != null || body?.configIds != null) {
      return Response.json(
        {
          error:
            "Execution scope on a changes report comes from the baseline snapshot",
        },
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

    const baselineExecutionScope = toExecutionScope({
      milestoneIds: baselineLoaded.snapshot.scopeMilestoneIds,
      configIds: baselineLoaded.snapshot.scopeConfigIds,
    });

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
      // Two snapshots diff meaningfully only inside the same execution
      // frame: a scoped baseline against an unscoped (or differently
      // scoped) comparison would report scope differences as coverage
      // changes. Refused, never reconciled.
      if (
        !sameExecutionScope(baselineLoaded.snapshot, comparisonLoaded.snapshot)
      ) {
        return Response.json(
          {
            error: "Snapshots were captured under different execution scopes",
          },
          { status: 400 }
        );
      }
      comparisonEntries = comparisonLoaded.entries;
    } else {
      // The live side inherits the baseline's frozen frame, so "what
      // changed since the baseline" always compares like with like —
      // an unscoped baseline diffs against the unscoped live matrix,
      // exactly as before.
      const live = await loadRequirementTraceability(
        projectId,
        { accessibleProjectIds },
        undefined,
        baselineExecutionScope !== undefined
          ? { executionScope: baselineExecutionScope }
          : undefined
      );
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
