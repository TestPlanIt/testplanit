import { sql } from "kysely";
import type { TriageDb } from "./signatures";

/**
 * Automatic quarantine release (failure triage).
 *
 * A quarantined case lifts its own quarantine once it has passed the
 * project's configured number of times in a row, counting only automated
 * results recorded after it was quarantined. Skipped results neither count
 * nor break the streak. A quarantine marked "keep until released" is left
 * alone.
 */

export const MIN_AUTO_RELEASE_PASSES = 1;
export const MAX_AUTO_RELEASE_PASSES = 100;

/**
 * Decides from the newest-first verdicts (true = pass) recorded since the
 * quarantine started whether the streak is long enough.
 */
export function hasPassStreak(
  verdictsNewestFirst: boolean[],
  passes: number
): boolean {
  const needed = Math.max(MIN_AUTO_RELEASE_PASSES, passes);
  if (verdictsNewestFirst.length < needed) return false;
  return verdictsNewestFirst.slice(0, needed).every(Boolean);
}

export interface AutoReleaseResult {
  /** Quarantine rows deleted, with the cases they covered. */
  released: { quarantineId: number; caseId: number }[];
}

/**
 * Releases every quarantined case of the run that has recovered. Called by
 * the triage worker after a run's results were grouped.
 */
export async function releaseRecoveredQuarantines(
  db: TriageDb,
  params: { projectId: number; testRunId: number }
): Promise<AutoReleaseResult> {
  const { projectId, testRunId } = params;
  const project = await db.projects.findUnique({
    where: { id: projectId },
    select: { quarantineAutoRelease: true, quarantineAutoReleasePasses: true },
  });
  if (!project?.quarantineAutoRelease) return { released: [] };
  const passes = Math.min(
    MAX_AUTO_RELEASE_PASSES,
    Math.max(MIN_AUTO_RELEASE_PASSES, project.quarantineAutoReleasePasses)
  );

  // Quarantined cases that have a result in this run and are not opted out.
  const candidates = await sql<{ id: number; caseId: number; createdAt: Date }>`
    SELECT q.id, q."caseId", q."createdAt"
    FROM "CaseQuarantine" q
    WHERE q."projectId" = ${projectId}
      AND q."keepUntilReleased" = false
      AND EXISTS (
        SELECT 1
        FROM "JUnitTestResult" r
        JOIN "JUnitTestSuite" s ON s.id = r."testSuiteId"
        WHERE s."testRunId" = ${testRunId}
          AND r."repositoryCaseId" = q."caseId"
      )
  `.execute(db.$qb);

  const released: AutoReleaseResult["released"] = [];
  for (const candidate of candidates.rows) {
    const recent = await sql<{ type: string }>`
      SELECT r.type
      FROM "JUnitTestResult" r
      WHERE r."repositoryCaseId" = ${candidate.caseId}
        AND COALESCE(r."executedAt", r."createdAt") > ${candidate.createdAt}
        AND r.type IN ('PASSED', 'FAILURE', 'ERROR')
      ORDER BY COALESCE(r."executedAt", r."createdAt") DESC, r.id DESC
      LIMIT ${passes}
    `.execute(db.$qb);
    const verdicts = recent.rows.map((row) => row.type === "PASSED");
    if (!hasPassStreak(verdicts, passes)) continue;
    await db.caseQuarantine.delete({ where: { id: candidate.id } });
    released.push({ quarantineId: candidate.id, caseId: candidate.caseId });
  }
  return { released };
}
