import { formatIssueDisplayText } from "~/utils/issueDisplayText";

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
  requirementPath: string; // "Root > Child > Leaf"
  caseId: number | null; // null => coverage gap
  caseName: string | null;
  caseProjectId: number | null;
  caseProjectName: string | null;
  statusName: string | null; // null => not run
  statusColor: string | null;
  executedAt: string | null;
  linkedCaseCount: number; // the requirement's rollup total
  coverageStatus: RequirementCoverageStatus;
};

export type RequirementTraceabilityData = {
  projectId: number;
  projectName: string;
  generatedAt: string;
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
  | "linkedCaseCount"
>;

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

  const rows: RequirementTraceabilityRow[] = [];

  for (const requirement of requirements) {
    const path =
      paths.get(requirement.id) ?? formatIssueDisplayText(requirement);
    const breakdown = coverage.get(requirement.id);
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
        caseId: coveringCase.caseId,
        caseName: coveringCase.caseName,
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
 * The gap-report view of the matrix: exactly the rows with a null
 * `caseId`. The gap report and the matrix are the same data viewed
 * twice, which is what makes them incapable of disagreeing — a report
 * handler filters this from the SAME rows the matrix rendered, rather
 * than issuing an independent query that could drift from it.
 */
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
      linkedCaseCount: row.linkedCaseCount,
    }));
}
