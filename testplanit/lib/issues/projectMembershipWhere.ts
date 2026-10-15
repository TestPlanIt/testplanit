/**
 * The one definition of "this issue is visible in this project".
 *
 * An Issue row is shared: one row per tracker ticket per integration, reached
 * by every project that imported it or linked it to something. `projectId` is
 * only the home project (it owns the requirement semantics). Every reader that
 * scopes issues to a project spells the predicate through this helper so the
 * arms cannot drift between the list pages, the pickers, the indexer and the
 * import paths.
 *
 * Isomorphic on purpose: client components hand this straight to the ZenStack
 * hooks, so no server-only imports here.
 */
export function issueInProjectWhere(projectId: number) {
  return {
    OR: [
      { projectId },
      { projectMemberships: { some: { projectId } } },
      // A link to a soft-deleted case alone must not surface the issue.
      { caseIssues: { some: { case: { projectId, isDeleted: false } } } },
      {
        milestoneIssues: {
          some: { milestone: { projectId, isDeleted: false } },
        },
      },
      { sessions: { some: { projectId } } },
      { testRuns: { some: { projectId } } },
      { sessionResults: { some: { session: { projectId } } } },
      { testRunResults: { some: { testRun: { projectId } } } },
      {
        testRunStepResults: {
          some: { testRunResult: { testRun: { projectId } } },
        },
      },
    ],
  };
}

/**
 * The relation `select` that answers "which projects is this issue visible
 * in" for a batch of rows; pair with `collectIssueProjectIds`.
 */
export const ISSUE_PROJECT_IDS_SELECT = {
  projectId: true,
  projectMemberships: { select: { projectId: true } },
  caseIssues: {
    where: { case: { isDeleted: false } },
    select: { case: { select: { projectId: true } } },
  },
  milestoneIssues: {
    where: { milestone: { isDeleted: false } },
    select: { milestone: { select: { projectId: true } } },
  },
  sessions: { where: { isDeleted: false }, select: { projectId: true } },
  sessionResults: {
    where: { session: { isDeleted: false } },
    select: { session: { select: { projectId: true } } },
  },
  testRuns: { where: { isDeleted: false }, select: { projectId: true } },
  testRunResults: {
    where: { testRun: { isDeleted: false } },
    select: { testRun: { select: { projectId: true } } },
  },
  testRunStepResults: {
    where: { testRunResult: { testRun: { isDeleted: false } } },
    select: {
      testRunResult: { select: { testRun: { select: { projectId: true } } } },
    },
  },
} as const;

type ProjectRef = { projectId: number | null } | null | undefined;

export interface IssueProjectIdsRow {
  projectId?: number | null;
  projectMemberships?: Array<{ projectId: number }>;
  caseIssues?: Array<{ case: ProjectRef }>;
  milestoneIssues?: Array<{ milestone: ProjectRef }>;
  sessions?: Array<{ projectId: number | null }>;
  sessionResults?: Array<{ session: ProjectRef }>;
  testRuns?: Array<{ projectId: number | null }>;
  testRunResults?: Array<{ testRun: ProjectRef }>;
  testRunStepResults?: Array<{ testRunResult: { testRun: ProjectRef } | null }>;
}

/** Distinct project ids an issue row selected with ISSUE_PROJECT_IDS_SELECT reaches. */
export function collectIssueProjectIds(row: IssueProjectIdsRow): Set<number> {
  const ids = new Set<number>();
  const add = (id: number | null | undefined) => {
    if (typeof id === "number") ids.add(id);
  };
  add(row.projectId);
  for (const m of row.projectMemberships ?? []) add(m.projectId);
  for (const ci of row.caseIssues ?? []) add(ci.case?.projectId);
  for (const mi of row.milestoneIssues ?? []) add(mi.milestone?.projectId);
  for (const s of row.sessions ?? []) add(s.projectId);
  for (const sr of row.sessionResults ?? []) add(sr.session?.projectId);
  for (const tr of row.testRuns ?? []) add(tr.projectId);
  for (const trr of row.testRunResults ?? []) add(trr.testRun?.projectId);
  for (const tsr of row.testRunStepResults ?? []) {
    add(tsr.testRunResult?.testRun?.projectId);
  }
  return ids;
}
