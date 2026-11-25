/**
 * The project's workflow state for test cases the AI drafted and nobody has
 * reviewed: the first enabled flagged case state the project uses, or null
 * when the project has none.
 */
export async function aiDraftState(
  db: any,
  projectId: number
): Promise<{ id: number; name: string } | null> {
  return db.workflows.findFirst({
    where: {
      scope: "CASES",
      isAiDraft: true,
      isEnabled: true,
      isDeleted: false,
      projects: { some: { projectId } },
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Record that the AI wrote the current version of these cases from the issue
 * as it now reads. While a case's version stays the one recorded here the AI
 * may rewrite it; any later save moves the version on and ends that.
 */
export async function markAiWritten(
  db: any,
  caseIds: number[],
  issueId: number,
  at: Date = new Date()
): Promise<void> {
  if (caseIds.length === 0) return;
  const cases: { id: number; currentVersion: number }[] =
    await db.repositoryCases.findMany({
      where: { id: { in: caseIds } },
      select: { id: true, currentVersion: true },
    });
  for (const row of cases) {
    await db.repositoryCases.update({
      where: { id: row.id },
      data: { aiWrittenVersion: row.currentVersion },
    });
  }
  await db.repositoryCaseIssue.updateMany({
    where: { issueId, caseId: { in: caseIds } },
    data: { alignedAt: at },
  });
}
