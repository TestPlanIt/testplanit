import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";

/**
 * Which of these cases the project keeps out of runs. The host drops Not
 * Started cases from a run write when `Projects.excludeNotStartedFromRuns`
 * is on (the web UI's run dialog does the same and tells the user); this
 * lets the tools say which ones were left out instead of adding silently.
 */
export async function splitNotStartedCases(
  projectId: number | undefined,
  caseIds: number[],
  env: EnvConfig,
): Promise<{ caseIds: number[]; skippedNotStartedCaseIds: number[] }> {
  if (projectId === undefined || caseIds.length === 0) {
    return { caseIds, skippedNotStartedCaseIds: [] };
  }
  const project = await zenstack<{ excludeNotStartedFromRuns?: boolean } | null>(
    "projects",
    "findUnique",
    { where: { id: projectId }, select: { excludeNotStartedFromRuns: true } },
    env,
  );
  if (!project?.excludeNotStartedFromRuns) {
    return { caseIds, skippedNotStartedCaseIds: [] };
  }
  const drafts = await zenstack<Array<{ id: number }>>(
    "repositoryCases",
    "findMany",
    {
      where: { id: { in: caseIds }, state: { workflowType: "NOT_STARTED" } },
      select: { id: true },
    },
    env,
  );
  const skipped = new Set((drafts ?? []).map((d) => d.id));
  return {
    caseIds: caseIds.filter((id) => !skipped.has(id)),
    skippedNotStartedCaseIds: caseIds.filter((id) => skipped.has(id)),
  };
}
