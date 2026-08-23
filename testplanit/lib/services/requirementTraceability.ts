import { baseDb } from "~/lib/db";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import {
  getRequirementCoverage,
  getRequirementCoveringCases,
  type RequirementCoverageScope,
  type RequirementCoveringCase,
} from "~/lib/services/requirementCoverage";
import {
  buildTraceabilityRows,
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

/**
 * Loads and shapes the whole-project traceability matrix: every
 * requirement, the rollup's coverage breakdown, and the drill-down's
 * covering-case rows, fed through the pure builders. Used by the GET
 * route below (PDF export, 26-10) and, in a later plan, the
 * gaps/traceability report handlers (26-11) — one loader, one shape, so
 * neither can drift from the other.
 */
export async function loadRequirementTraceability(
  projectId: number,
  scope: RequirementCoverageScope,
  db: typeof baseDb = baseDb
): Promise<RequirementTraceabilityData> {
  const [project, requirements, coverage] = await Promise.all([
    db.projects.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    // The requirement read this loader owns: names and parents for the
    // whole project, scoped with the shared REQUIREMENT_SCOPE_WHERE
    // predicate — never inlined `isRequirement: true` — so this read is
    // registered in issueRoleScope.containment.test.ts's SCOPED_FILES
    // bucket rather than an exemption bucket.
    db.issue.findMany({
      where: { projectId, isDeleted: false, ...REQUIREMENT_SCOPE_WHERE },
      select: {
        id: true,
        name: true,
        title: true,
        externalUrl: true,
        parentId: true,
      },
    }) as Promise<RequirementNode[]>,
    getRequirementCoverage(projectId, scope, undefined, db),
  ]);

  // The drill-down needs the id list the requirement read just produced,
  // so it cannot join the Promise.all above — it depends on that read's
  // result, not merely on the same input parameters.
  const requirementIds = requirements.map((requirement) => requirement.id);
  const coveringCases = await loadCoveringCasesChunked(
    projectId,
    requirementIds,
    scope,
    db
  );

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
