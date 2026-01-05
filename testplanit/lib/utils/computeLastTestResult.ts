/**
 * Represents the computed last test result for a repository case.
 * This is the most recent result from either manual test runs or JUnit automation.
 */
export interface LastTestResult {
  status: { id: number; name: string; color?: { value: string } };
  executedAt: Date;
  testRun?: { id: number; name: string };
}

/**
 * Computes the last test result for a repository case by comparing
 * the most recent manual test run result with the most recent JUnit result.
 *
 * @param caseItem - The repository case with testRuns and junitResults included
 * @returns The most recent test result, or null if no results exist
 */
export function computeLastTestResult(caseItem: any): LastTestResult | null {
  const allResults: { executedAt: Date; status: any; testRun: any }[] = [];

  // Collect from manual test runs
  for (const trc of caseItem.testRuns || []) {
    if (trc.testRun?.isDeleted) continue;
    for (const result of trc.results || []) {
      if (result.executedAt && result.status) {
        allResults.push({
          executedAt: new Date(result.executedAt),
          status: result.status,
          testRun: { id: trc.testRun.id, name: trc.testRun.name },
        });
      }
    }
  }

  // Collect from JUnit results
  for (const jr of caseItem.junitResults || []) {
    if (jr.testSuite?.testRun?.isDeleted) continue;
    if (jr.executedAt && jr.status) {
      allResults.push({
        executedAt: new Date(jr.executedAt),
        status: jr.status,
        testRun: jr.testSuite?.testRun
          ? { id: jr.testSuite.testRun.id, name: jr.testSuite.testRun.name }
          : undefined,
      });
    }
  }

  if (allResults.length === 0) return null;

  // Sort by executedAt descending and return the most recent
  allResults.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
  return allResults[0];
}
