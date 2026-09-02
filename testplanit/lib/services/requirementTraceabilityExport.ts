import {
  formatIssueDisplayText,
  resolveRequirementDisplayPriority,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";

import type {
  RequirementCoverageBreakdown,
  RequirementCoverageStatus,
  RequirementCoveringCase,
} from "~/lib/services/requirementCoverage";

/**
 * Pure shaping helpers for the requirement traceability matrix (COV-04).
 *
 * This module intentionally has no runtime dependency on Prisma or any
 * server-only module so the response types can be imported by the client
 * export hook (`import type`) without bundling server code. The endpoint at
 * `app/api/projects/[projectId]/requirements/traceability/route.ts`
 * performs the DB reads (via `lib/services/requirementTraceability.ts`)
 * and feeds the results through these functions. Only `import type` is
 * used against `lib/services/requirementCoverage.ts`, which itself does
 * touch a live db client — a type-only import is erased at compile time
 * and carries no runtime module with it, matching the same convention
 * `lib/services/milestoneExport.ts` uses for `MilestoneSegment`.
 */

/** A requirement row, carrying only what path-building and display text
 * need. Mirrors the loader's single scoped `Issue` read
 * (`{ id, name, title, externalUrl, parentId }`). */
export type RequirementNode = {
  id: number;
  name: string;
  title: string | null;
  externalUrl: string | null;
  parentId: number | null;
  /** Icon inputs for the shared IssueTypeIcon, exactly what the
   * requirements tree renders — optional so pure-path callers and older
   * fixtures need not carry them. */
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
  /** The requirement's own project. Only a cross-project load has more
   * than one, so both are optional for every single-project caller and
   * fixture that predates them. */
  projectId?: number | null;
  projectName?: string | null;
  /** Gap-report (coverage debt) enrichment — the fields
   * `resolveRequirementDisplayStatus` and the Uncovered-since column
   * read. Optional for the same fixture-compat reason as the icon pair. */
  priority?: string | null;
  externalPriority?: string | null;
  status?: string | null;
  externalStatus?: string | null;
  integrationId?: number | null;
  requirementDetachedAt?: Date | string | null;
  createdAt?: Date | string | null;
  /** The sync-maintained metadata blob (`buildSyncedIssueData`) — read
   * here only for `data.createdAt`, the tracker's own creation instant. */
  data?: unknown;
};

/**
 * One row of the requirement traceability matrix. A requirement with no
 * covering cases appears ONCE with a null `caseId`/`caseName` — that is
 * the coverage gap (COV-03), a real row rather than an absence someone
 * has to remember to check for. A covering case with no in-scope
 * execution has a null `statusName`/`executedAt` ("Not run"), which is a
 * DIFFERENT thing from the gap row above and must stay distinguishable
 * from it: `caseId` is non-null on a not-run row.
 */
export type RequirementTraceabilityRow = {
  requirementId: number;
  requirementKey: string; // Issue.name
  requirementTitle: string | null;
  requirementPath: string; // "Root > Child > Leaf" — includes the requirement itself; the matrix's ordering key
  /** The ancestors alone — "Root > Child" for a leaf, "" for a top-level
   * requirement. What the Path column and the exports DISPLAY: repeating
   * the requirement's own text inside its path made the column read as a
   * copy of the Requirement column in a mostly-flat project. */
  requirementParentPath: string;
  requirementIssueTypeName?: string | null;
  requirementIssueTypeIconUrl?: string | null;
  /** Requirement-level context for the coverage-debt report: priority,
   * the DISPLAY status (already resolved through
   * `resolveRequirementDisplayStatus` — never a raw status read), and
   * when the requirement was created (the age of an uncovered gap). */
  requirementPriority?: string | null;
  requirementStatus?: string | null;
  requirementCreatedAt?: string | null;
  /** The id of the requirement's top-level root (itself when top-level)
   * — what makes a hierarchy bar's label clickable even when the root
   * has no row of its own in the result set. */
  requirementRootId?: number;
  /** The requirement's parent id as the loader read it (null for a
   * top-level requirement) — what lets a persisted snapshot's rows be
   * re-scoped to a subtree later without re-reading the live tree. */
  requirementParentId?: number | null;
  /** The project the REQUIREMENT itself belongs to — distinct from
   * `caseProjectId`, which is the covering case's project. Redundant on a
   * single-project report (every row shares it) and the only thing that
   * identifies a row's origin on a cross-project one. */
  requirementProjectId?: number | null;
  requirementProjectName?: string | null;
  caseId: number | null; // null => coverage gap
  caseName: string | null;
  /** CaseDisplay's icon inputs; absent on gap rows. */
  caseAutomated?: boolean;
  caseSource?: string | null;
  caseHasParameters?: boolean;
  caseProjectId: number | null;
  caseProjectName: string | null;
  statusName: string | null; // null => not run
  statusColor: string | null;
  executedAt: string | null;
  linkedCaseCount: number; // the requirement's rollup total
  coverageStatus: RequirementCoverageStatus;
};

export type RequirementTraceabilityData = {
  /** The one project this matrix covers, or `null` when it spans several
   * (the cross-project reports) — no single id would be true there, and
   * each row names its own requirement's project instead. */
  projectId: number | null;
  /** The single project's name; empty when the matrix spans several. */
  projectName: string;
  /** Every project the matrix drew requirements from. One entry for a
   * single-project load. */
  projects?: { id: number; name: string }[];
  generatedAt: string;
  /** Present when the rows are a persisted snapshot rather than the live
   * matrix — `generatedAt` is then the capture instant. */
  snapshot?: { id: number; name: string; capturedAt: string };
  rows: RequirementTraceabilityRow[];
};

/** The gap-report view of the same rows: exactly the rows with a null
 * `caseId`. Deriving this from `RequirementTraceabilityRow` instead of a
 * standalone query is what keeps the matrix and the gap report incapable
 * of disagreeing about what is uncovered (see `toGapRows`). */
export type RequirementCoverageGapRow = Pick<
  RequirementTraceabilityRow,
  | "requirementId"
  | "requirementKey"
  | "requirementTitle"
  | "requirementPath"
  | "requirementParentPath"
  | "requirementIssueTypeName"
  | "requirementIssueTypeIconUrl"
  | "requirementPriority"
  | "requirementStatus"
  | "requirementCreatedAt"
  | "requirementRootId"
  | "requirementProjectId"
  | "requirementProjectName"
  | "linkedCaseCount"
> & {
  /** UNCOVERED for a true gap; NOT_RUN for the opt-in never-ran tier —
   * the column that keeps the two tiers distinguishable in one list. */
  coverageStatus: RequirementCoverageStatus;
};

/** Bound on the ancestor walk in `buildRequirementPaths` — matches
 * `app/api/milestones/[milestoneId]/export/route.ts`'s `buildParentPath`
 * bound. A Postgres trigger already prevents a real cycle in the `Issue`
 * hierarchy, but a walk that could loop on unexpected data is a walk that
 * eventually will; the visited set below guards it defensively even
 * though the bound alone would already terminate the loop. */
const MAX_PATH_HOPS = 25;

/**
 * Builds a root-first, " > "-joined display path for every requirement in
 * `requirements`, keyed by requirement id. Only requirement rows are
 * considered ancestors here — the loader's single scoped read only ever
 * returns requirement-typed `Issue` rows, so a requirement whose real
 * parent is a non-requirement node simply has no resolvable ancestor in
 * this map and its path starts at itself. Segments use
 * `formatIssueDisplayText` so a synced requirement's path reads "KEY:
 * Title" exactly like the tree does, rather than a second, drifting
 * "KEY: Title" convention invented here.
 */
/** Parses `data.createdAt` defensively — the column is untyped Json fed
 * by the sync writer; anything but a valid date string reads as absent. */
function trackerCreatedAt(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).createdAt;
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function buildRequirementPaths(
  requirements: RequirementNode[]
): Map<number, string> {
  const byId = new Map(
    requirements.map((requirement) => [requirement.id, requirement])
  );
  const paths = new Map<number, string>();

  for (const requirement of requirements) {
    const segments: string[] = [];
    const visited = new Set<number>();
    let current: RequirementNode | undefined = requirement;
    let hops = 0;

    while (current && hops < MAX_PATH_HOPS) {
      if (visited.has(current.id)) {
        // Cycle guard: a Postgres trigger already prevents a real cycle in
        // the Issue hierarchy, but a pure function walking caller-supplied
        // data should never trust that invariant blindly.
        break;
      }
      visited.add(current.id);
      segments.unshift(formatIssueDisplayText(current));
      current =
        current.parentId != null ? byId.get(current.parentId) : undefined;
      hops++;
    }

    paths.set(requirement.id, segments.join(" > "));
  }

  return paths;
}

/**
 * The topmost resolvable ancestor for every requirement — the id behind
 * the hierarchy bars' clickable root labels. Same walk, guards, and
 * requirement-rows-only semantics as `buildRequirementPaths` (a chain
 * broken by a non-requirement parent tops out at the break, matching the
 * path's own first segment). A top-level requirement is its own root.
 */
export function buildRequirementRootIds(
  requirements: RequirementNode[]
): Map<number, number> {
  const byId = new Map(
    requirements.map((requirement) => [requirement.id, requirement])
  );
  const rootIds = new Map<number, number>();

  for (const requirement of requirements) {
    const visited = new Set<number>();
    let current: RequirementNode = requirement;
    let hops = 0;
    while (hops < MAX_PATH_HOPS) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const parent =
        current.parentId != null ? byId.get(current.parentId) : undefined;
      if (!parent) break;
      current = parent;
      hops++;
    }
    rootIds.set(requirement.id, current.id);
  }

  return rootIds;
}

/**
 * Builds the full set of traceability rows from the requirement list, the
 * rollup's coverage breakdown, and the drill-down's covering-case lists —
 * the same two shipped services every consumer of this matrix composes,
 * never a third independently-written query. For each requirement, in
 * path order: if the drill-down has no covering cases (or an empty
 * list), emit exactly one row with every case field null, `linkedCaseCount`
 * from the rollup, and `coverageStatus` from the rollup — this is the
 * coverage gap, and COV-03 exists because a gap that is an absence is a
 * gap somebody forgets to render. Otherwise emit one row per covering
 * case, sorted by case name. Rows are finally sorted by path, then case
 * name, so the matrix reads top-down.
 */
export function buildTraceabilityRows(params: {
  requirements: RequirementNode[];
  coverage: Map<number, RequirementCoverageBreakdown>;
  coveringCases: Map<number, RequirementCoveringCase[]>;
}): RequirementTraceabilityRow[] {
  const { requirements, coverage, coveringCases } = params;
  const paths = buildRequirementPaths(requirements);
  const rootIds = buildRequirementRootIds(requirements);

  const rows: RequirementTraceabilityRow[] = [];

  for (const requirement of requirements) {
    const path =
      paths.get(requirement.id) ?? formatIssueDisplayText(requirement);
    // The path always ends with the requirement's own display text (it is
    // the walk's last segment by construction), so the ancestors-only
    // display path is an exact suffix strip — " > " plus the self segment,
    // or the empty string for a top-level requirement.
    const selfText = formatIssueDisplayText(requirement);
    const parentPath =
      path.length > selfText.length && path.endsWith(selfText)
        ? path.slice(0, path.length - selfText.length - " > ".length)
        : "";
    const breakdown = coverage.get(requirement.id);
    // Same lock-aware read as status below -- never raw `priority`.
    const requirementPriority = resolveRequirementDisplayPriority({
      priority: requirement.priority,
      externalPriority: requirement.externalPriority,
      isRequirement: true,
      integrationId: requirement.integrationId ?? null,
      requirementDetachedAt: requirement.requirementDetachedAt ?? null,
    });
    // WR-03's single status convention: a locked (synced) requirement
    // shows the tracker's status, a detached/native one its local status.
    const requirementStatus = resolveRequirementDisplayStatus({
      status: requirement.status,
      externalStatus: requirement.externalStatus,
      isRequirement: true,
      integrationId: requirement.integrationId ?? null,
      requirementDetachedAt: requirement.requirementDetachedAt ?? null,
    });
    // Uncovered-since prefers the TRACKER's creation date (persisted at
    // `data.createdAt` by buildSyncedIssueData): the local `createdAt` is
    // when the row reached TestPlanIt, which for an imported requirement
    // is the import date. Rows synced before that key existed (and native
    // requirements, whose local date IS the true one) fall back.
    const requirementCreatedAt =
      trackerCreatedAt(requirement.data) ??
      (requirement.createdAt != null
        ? new Date(requirement.createdAt).toISOString()
        : null);
    const linkedCaseCount = breakdown?.linkedCaseCount ?? 0;
    const coverageStatus: RequirementCoverageStatus =
      breakdown?.status ?? "UNCOVERED";
    const cases = coveringCases.get(requirement.id) ?? [];

    if (cases.length === 0) {
      // The coverage gap: a row, not an absence. Every case-side field is
      // explicitly null so a renderer can never mistake this for a
      // covering case that merely lacks a status.
      rows.push({
        requirementId: requirement.id,
        requirementKey: requirement.name,
        requirementTitle: requirement.title,
        requirementPath: path,
        requirementParentPath: parentPath,
        requirementIssueTypeName: requirement.issueTypeName ?? null,
        requirementIssueTypeIconUrl: requirement.issueTypeIconUrl ?? null,
        requirementPriority,
        requirementStatus,
        requirementCreatedAt,
        requirementRootId: rootIds.get(requirement.id) ?? requirement.id,
        requirementParentId: requirement.parentId,
        requirementProjectId: requirement.projectId ?? null,
        requirementProjectName: requirement.projectName ?? null,
        caseId: null,
        caseName: null,
        caseProjectId: null,
        caseProjectName: null,
        statusName: null,
        statusColor: null,
        executedAt: null,
        linkedCaseCount,
        coverageStatus,
      });
      continue;
    }

    const sortedCases = [...cases].sort((a, b) =>
      a.caseName.localeCompare(b.caseName)
    );
    for (const coveringCase of sortedCases) {
      rows.push({
        requirementId: requirement.id,
        requirementKey: requirement.name,
        requirementTitle: requirement.title,
        requirementPath: path,
        requirementParentPath: parentPath,
        requirementIssueTypeName: requirement.issueTypeName ?? null,
        requirementIssueTypeIconUrl: requirement.issueTypeIconUrl ?? null,
        requirementPriority,
        requirementStatus,
        requirementCreatedAt,
        requirementRootId: rootIds.get(requirement.id) ?? requirement.id,
        requirementParentId: requirement.parentId,
        requirementProjectId: requirement.projectId ?? null,
        requirementProjectName: requirement.projectName ?? null,
        caseId: coveringCase.caseId,
        caseName: coveringCase.caseName,
        caseAutomated: coveringCase.automated,
        caseSource: coveringCase.source,
        caseHasParameters: coveringCase.hasParameters,
        caseProjectId: coveringCase.projectId,
        caseProjectName: coveringCase.projectName,
        statusName: coveringCase.lastStatusName,
        statusColor: coveringCase.lastStatusColor,
        executedAt: coveringCase.lastExecutedAt,
        linkedCaseCount,
        coverageStatus,
      });
    }
  }

  rows.sort((a, b) => {
    const pathCompare = a.requirementPath.localeCompare(b.requirementPath);
    if (pathCompare !== 0) return pathCompare;
    return (a.caseName ?? "").localeCompare(b.caseName ?? "");
  });

  return rows;
}

/**
 * Resolves the requirement rows belonging to the subtrees of `rootIds`:
 * each root plus every descendant reachable through REQUIREMENT rows
 * only. The walk runs over the requirement-scoped node list, which has
 * no edge across a non-requirement node — a requirement grandchild whose
 * intermediate parent is an unclassified Story is deliberately NOT a
 * member, exactly matching `getRequirementSubtreeIds`'s recursive-arm
 * predicate and the tree UI's own `childrenMap` membership. The coverage
 * ROLLUP for each member still walks through non-requirement descendants
 * (`requirementCoverage.ts`'s anchor-only asymmetry); only row
 * membership stops at them.
 *
 * Ids that don't resolve to a node in `requirements` (deleted, foreign
 * project, or not a requirement) are ignored rather than errored — the
 * report must keep rendering after a scoped-to requirement is deleted,
 * and a caller-supplied foreign id must select nothing. Order of the
 * returned rows follows `requirements`, not `rootIds`.
 */
export function filterRequirementsToRoots(
  requirements: RequirementNode[],
  rootIds: number[]
): RequirementNode[] {
  const byId = new Map(
    requirements.map((requirement) => [requirement.id, requirement])
  );
  const childrenByParent = new Map<number, RequirementNode[]>();
  for (const requirement of requirements) {
    if (requirement.parentId === null) continue;
    const siblings = childrenByParent.get(requirement.parentId);
    if (siblings) {
      siblings.push(requirement);
    } else {
      childrenByParent.set(requirement.parentId, [requirement]);
    }
  }

  // The membership set doubles as the visited set: a cycle in
  // caller-supplied data terminates instead of looping, same defensive
  // stance as `buildRequirementPaths` above.
  const membership = new Set<number>();
  const queue: number[] = [];
  for (const rootId of rootIds) {
    if (byId.has(rootId) && !membership.has(rootId)) {
      membership.add(rootId);
      queue.push(rootId);
    }
  }
  while (queue.length > 0) {
    const nodeId = queue.pop()!;
    for (const child of childrenByParent.get(nodeId) ?? []) {
      if (!membership.has(child.id)) {
        membership.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return requirements.filter((requirement) => membership.has(requirement.id));
}

/**
 * The gap-report view of the matrix: exactly the rows with a null
 * `caseId`. The gap report and the matrix are the same data viewed
 * twice, which is what makes them incapable of disagreeing — a report
 * handler filters this from the SAME rows the matrix rendered, rather
 * than issuing an independent query that could drift from it.
 */
/**
 * The opt-in second tier of the coverage-debt report: one row per
 * requirement whose classified state is NOT_RUN — covering cases exist
 * but none has ever executed, so there is still zero evidence. Derived
 * from the SAME matrix rows as `toGapRows` (deduped by requirement, the
 * pair rows collapse to requirement-level), for the same
 * incapable-of-disagreeing reason.
 */
export function toNotRunRequirementRows(
  rows: RequirementTraceabilityRow[]
): RequirementCoverageGapRow[] {
  const seen = new Set<number>();
  const result: RequirementCoverageGapRow[] = [];
  for (const row of rows) {
    if (row.coverageStatus !== "NOT_RUN" || seen.has(row.requirementId)) {
      continue;
    }
    seen.add(row.requirementId);
    result.push({
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
      linkedCaseCount: row.linkedCaseCount,
    });
  }
  return result;
}

export function toGapRows(
  rows: RequirementTraceabilityRow[]
): RequirementCoverageGapRow[] {
  return rows
    .filter((row) => row.caseId === null)
    .map((row) => ({
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
      linkedCaseCount: row.linkedCaseCount,
    }));
}
