import { baseDb } from "~/lib/db";

export interface ProjectCardStats {
  /** Issues the project owns, imported, or has linked to anything in it. */
  issues: number;
  /** When a test or session result was last recorded, as an ISO timestamp. */
  lastActivityAt: string | null;
  /** Unfinished run cases in active runs that are assigned to the viewer. */
  myPending: number;
}

function emptyStats(): ProjectCardStats {
  return { issues: 0, lastActivityAt: null, myPending: 0 };
}

/**
 * Live figures for the project cards on the home and projects pages, for
 * every project in `projectIds`.
 *
 * Reads past access policies, so the caller passes only projects the viewer
 * is allowed to read.
 */
export async function getProjectCardStats(
  projectIds: number[],
  viewerId: string
): Promise<Record<number, ProjectCardStats>> {
  const stats: Record<number, ProjectCardStats> = {};
  for (const id of projectIds) stats[id] = emptyStats();
  if (projectIds.length === 0) return stats;

  const [issueRows, activityRows, pendingRows] = await Promise.all([
    baseDb.$queryRaw<{ projectId: number; issueCount: bigint }[]>`
      SELECT
        project_id as "projectId",
        COUNT(DISTINCT issue_id) as "issueCount"
      FROM (
        -- Issues the project owns
        SELECT DISTINCT i."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        WHERE i."isDeleted" = false
          AND i."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues the project imported
        SELECT DISTINCT m."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "IssueProjectMembership" m ON i.id = m."issueId"
        WHERE i."isDeleted" = false
          AND m."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through Milestones
        SELECT DISTINCT ms."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "MilestoneIssue" mi ON i.id = mi."issueId"
        INNER JOIN "Milestones" ms ON mi."milestoneId" = ms.id
        WHERE i."isDeleted" = false
          AND ms."isDeleted" = false
          AND ms."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through RepositoryCases
        SELECT DISTINCT rc."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "RepositoryCaseIssue" irc ON i.id = irc."issueId"
        INNER JOIN "RepositoryCases" rc ON irc."caseId" = rc.id
        WHERE i."isDeleted" = false
          AND rc."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through Sessions
        SELECT DISTINCT s."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToSessions" is2 ON i.id = is2."A"
        INNER JOIN "Sessions" s ON is2."B" = s.id
        WHERE i."isDeleted" = false
          AND s."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRuns
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRuns" itr ON i.id = itr."A"
        INNER JOIN "TestRuns" tr ON itr."B" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through SessionResults
        SELECT DISTINCT s."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToSessionResults" isr ON i.id = isr."A"
        INNER JOIN "SessionResults" sr ON isr."B" = sr.id
        INNER JOIN "Sessions" s ON sr."sessionId" = s.id
        WHERE i."isDeleted" = false
          AND s."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRunResults
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRunResults" itrr ON i.id = itrr."A"
        INNER JOIN "TestRunResults" trr ON itrr."B" = trr.id
        INNER JOIN "TestRuns" tr ON trr."testRunId" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRunStepResults
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRunStepResults" itrsr ON i.id = itrsr."A"
        INNER JOIN "TestRunStepResults" trsr ON itrsr."B" = trsr.id
        INNER JOIN "TestRunResults" trr ON trsr."testRunResultId" = trr.id
        INNER JOIN "TestRuns" tr ON trr."testRunId" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])
      ) AS all_issues
      GROUP BY project_id
    `,
    baseDb.$queryRaw<{ projectId: number; lastActivityAt: Date | null }[]>`
        SELECT activity."projectId", MAX(activity.at) AS "lastActivityAt"
        FROM (
          SELECT tr."projectId", MAX(r."executedAt") AS at
          FROM "TestRunResults" r
          INNER JOIN "TestRuns" tr ON tr.id = r."testRunId"
          WHERE r."isDeleted" = false
            AND tr."isDeleted" = false
            AND tr."projectId" = ANY(${projectIds}::int[])
          GROUP BY tr."projectId"

          UNION ALL

          SELECT s."projectId", MAX(sr."createdAt") AS at
          FROM "SessionResults" sr
          INNER JOIN "Sessions" s ON s.id = sr."sessionId"
          WHERE sr."isDeleted" = false
            AND s."isDeleted" = false
            AND s."projectId" = ANY(${projectIds}::int[])
          GROUP BY s."projectId"
        ) AS activity
        GROUP BY activity."projectId"
      `,
    baseDb.$queryRaw<{ projectId: number; pending: bigint }[]>`
        SELECT tr."projectId", COUNT(*) AS pending
        FROM "TestRunCases" trc
        INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId"
        INNER JOIN "EffectiveCaseStatus" ecs ON ecs."testRunCaseId" = trc.id
        LEFT JOIN "Status" s ON s.id = ecs."statusId"
        WHERE trc."isDeleted" = false
          AND trc."assignedToId" = ${viewerId}
          AND COALESCE(s."isCompleted", false) = false
          AND tr."isDeleted" = false
          AND tr."isCompleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])
        GROUP BY tr."projectId"
      `,
  ]);

  for (const row of issueRows) {
    if (stats[row.projectId])
      stats[row.projectId].issues = Number(row.issueCount);
  }

  for (const row of activityRows) {
    if (stats[row.projectId] && row.lastActivityAt) {
      stats[row.projectId].lastActivityAt = new Date(
        row.lastActivityAt
      ).toISOString();
    }
  }

  for (const row of pendingRows) {
    if (stats[row.projectId])
      stats[row.projectId].myPending = Number(row.pending);
  }

  return stats;
}
