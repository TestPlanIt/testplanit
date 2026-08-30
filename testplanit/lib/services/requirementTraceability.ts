import { baseDb } from "~/lib/db";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import {
  getRequirementCoverage,
  getRequirementCoveringCases,
  type RequirementCoverageBreakdown,
  type RequirementCoverageScope,
  type RequirementCoveringCase,
} from "~/lib/services/requirementCoverage";
import {
  buildTraceabilityRows,
  filterRequirementsToRoots,
  type RequirementNode,
  type RequirementTraceabilityData,
} from "~/lib/services/requirementTraceabilityExport";

export type { RequirementTraceabilityData };

/**
 * Server-side loader for the requirement traceability matrix (COV-04).
 *
 * This module performs no shaping of its own — every transformation
 * lives in the pure `requirementTraceabilityExport.ts` module, so a
 * future report handler (26-11) that needs the identical rows can call
 * `loadRequirementTraceability` and never re-derive anything. It
 * composes ONLY the two shipped requirement coverage services
 * (`getRequirementCoverage`, `getRequirementCoveringCases`) plus one
 * scoped `Issue` read for requirement names and parents — never a third,
 * independently-written "latest result" query. Copying the milestone
 * export route's raw SQL here would be exactly that third definition.
 */

// Mirrors `getRequirementCoveringCases`'s own cap (`requirementCoverage.ts`)
// so a project above the limit produces a chunked matrix rather than a
// RangeError reaching the client as an unhandled 500.
const MAX_ROOT_IDS = 1000;

async function loadCoveringCasesChunked(
  projectId: number,
  requirementIds: number[],
  scope: RequirementCoverageScope,
  db: Pick<typeof baseDb, "$qb">
): Promise<Map<number, RequirementCoveringCase[]>> {
  if (requirementIds.length === 0) {
    return new Map();
  }

  const merged = new Map<number, RequirementCoveringCase[]>();
  for (let offset = 0; offset < requirementIds.length; offset += MAX_ROOT_IDS) {
    const chunk = requirementIds.slice(offset, offset + MAX_ROOT_IDS);
    const chunkResult = await getRequirementCoveringCases(
      projectId,
      chunk,
      scope,
      db
    );
    for (const [requirementId, cases] of chunkResult) {
      merged.set(requirementId, cases);
    }
  }
  return merged;
}

/** Same chunking rationale as `loadCoveringCasesChunked` above, for the
 * rollup's own identical `MAX_ROOT_IDS` cap: a scoped matrix whose
 * membership exceeds the cap produces a chunked rollup rather than a
 * RangeError reaching the client as an unhandled 500. Only the scoped
 * path pays this loop — the whole-project path keeps its single
 * uncapped statement. */
async function loadCoverageChunked(
  projectId: number,
  requirementIds: number[],
  scope: RequirementCoverageScope,
  db: Pick<typeof baseDb, "$qb">
): Promise<Map<number, RequirementCoverageBreakdown>> {
  const merged = new Map<number, RequirementCoverageBreakdown>();
  for (let offset = 0; offset < requirementIds.length; offset += MAX_ROOT_IDS) {
    const chunk = requirementIds.slice(offset, offset + MAX_ROOT_IDS);
    const chunkResult = await getRequirementCoverage(
      projectId,
      scope,
      { rootIds: chunk },
      db
    );
    for (const [requirementId, breakdown] of chunkResult) {
      merged.set(requirementId, breakdown);
    }
  }
  return merged;
}

export interface LoadRequirementTraceabilityOptions {
  /** Scope the matrix to these requirements' subtrees — each root plus
   * every descendant reachable through requirement rows, the same
   * membership the tree UI renders (`filterRequirementsToRoots`). Ids
   * that don't resolve to a live requirement in this project are
   * ignored; a list that resolves to nothing produces an empty matrix.
   * Omitted (or undefined) means the whole project, unchanged. */
  rootIds?: number[];
}

/**
 * Loads and shapes the traceability matrix — the whole project by
 * default, or the subtrees of `opts.rootIds` ("report on Enrolments
 * only"): every in-scope requirement, the rollup's coverage breakdown,
 * and the drill-down's covering-case rows, fed through the pure
 * builders. Used by the GET route below (PDF export, 26-10) and the
 * gaps/traceability report handlers (26-11) — one loader, one shape, so
 * neither can drift from the other.
 */
export async function loadRequirementTraceability(
  projectId: number,
  scope: RequirementCoverageScope,
  db: typeof baseDb = baseDb,
  opts?: LoadRequirementTraceabilityOptions
): Promise<RequirementTraceabilityData> {
  const scopedToRoots = opts?.rootIds !== undefined;

  const [project, allRequirements, projectWideCoverage] = await Promise.all([
    db.projects.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    // The requirement read this loader owns: names and parents for the
    // whole project, scoped with the shared REQUIREMENT_SCOPE_WHERE
    // predicate — never inlined `isRequirement: true` — so this read is
    // registered in issueRoleScope.containment.test.ts's SCOPED_FILES
    // bucket rather than an exemption bucket. Always the WHOLE project,
    // even under root scoping: the membership walk below needs every
    // requirement edge to resolve the subtrees.
    db.issue.findMany({
      where: { projectId, isDeleted: false, ...REQUIREMENT_SCOPE_WHERE },
      select: {
        id: true,
        name: true,
        title: true,
        externalUrl: true,
        parentId: true,
        issueTypeName: true,
        issueTypeIconUrl: true,
        priority: true,
        status: true,
        externalStatus: true,
        integrationId: true,
        requirementDetachedAt: true,
        createdAt: true,
        data: true,
      },
    }) as Promise<RequirementNode[]>,
    // The whole-project rollup keeps riding this Promise.all only when no
    // root scoping was requested — the scoped rollup's id list depends on
    // the requirement read's result, so it cannot start until that read
    // lands.
    scopedToRoots
      ? Promise.resolve(null)
      : getRequirementCoverage(projectId, scope, undefined, db),
  ]);

  const requirements = scopedToRoots
    ? filterRequirementsToRoots(allRequirements, opts!.rootIds!)
    : allRequirements;

  // The drill-down (and the scoped rollup) need the id list the
  // requirement read just produced, so neither can join the Promise.all
  // above — they depend on that read's result, not merely on the same
  // input parameters.
  const requirementIds = requirements.map((requirement) => requirement.id);
  const [coverage, coveringCases] = await Promise.all([
    projectWideCoverage ??
      loadCoverageChunked(projectId, requirementIds, scope, db),
    loadCoveringCasesChunked(projectId, requirementIds, scope, db),
  ]);

  const rows = buildTraceabilityRows({
    requirements,
    coverage,
    coveringCases,
  });

  return {
    projectId,
    projectName: project?.name ?? "",
    generatedAt: new Date().toISOString(),
    rows,
  };
}
