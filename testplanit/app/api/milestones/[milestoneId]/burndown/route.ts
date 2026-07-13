import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import {
  buildBurndownSeries,
  type MilestoneBurndownData,
} from "~/lib/services/milestoneBurndown";
import { getVisibleMilestone } from "~/lib/services/milestoneAccess";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { authOptions } from "~/server/auth";
import { AUTOMATED_TEST_RUN_TYPES } from "~/utils/testResultTypes";

export type { MilestoneBurndownData };

/**
 * Per-day burndown series for a milestone (fast-follow READY, D4). Returns the
 * remaining-work snapshot across the milestone's window so the detail page can
 * plot an execution burndown.
 *
 * Scope mirrors the summary/rollup routes: descendant-inclusive (D-06) via
 * `getAllDescendantMilestoneIds`, counting every manual + automated test-run
 * case plus sessions. Manual cases burn down on their first
 * `TestRunResults.executedAt`; automated (JUnit) cases have no per-case
 * execution timestamp, so the whole run burns down as one step on the run's
 * `createdAt` (import time) — imprecise to the day but keeps `total` honest and
 * lets the line reach zero.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Policy-scoped visibility gate — unauthorized users get the same 404 as a
    // missing milestone (no existence oracle).
    const visible = await getVisibleMilestone(session, milestoneId);
    if (!visible) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    // Window bounds. `startedAt`/`completedAt` carry the Jira sprint/version
    // planned dates for synced milestones; `createdAt` is the local fallback
    // start. A local, in-progress milestone has no `completedAt` (no target) —
    // the builder handles that by walking to "today".
    const milestone = await baseDb.milestones.findFirst({
      where: { id: milestoneId },
      select: { startedAt: true, completedAt: true, createdAt: true },
    });

    const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
    const allMilestoneIds = [milestoneId, ...descendantIds];
    const automatedTypes = [...AUTOMATED_TEST_RUN_TYPES];

    // Total executable items: every test-run case (manual + automated) + sessions
    // in scope. Matches `calculateMilestoneCompletion`'s denominator, which also
    // counts automated cases.
    const [caseTotalRows, sessionTotalRows] = await Promise.all([
      baseDb.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "TestRunCases" trc
        JOIN "TestRuns" tr ON trc."testRunId" = tr.id
        WHERE tr."milestoneId" = ANY(${allMilestoneIds}::int[])
          AND tr."isDeleted" = false
      `,
      baseDb.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "Sessions" s
        WHERE s."milestoneId" = ANY(${allMilestoneIds}::int[])
          AND s."isDeleted" = false
      `,
    ]);
    const total =
      Number(caseTotalRows[0]?.count ?? 0) +
      Number(sessionTotalRows[0]?.count ?? 0);

    // Execution day per case/session, bucketed by UTC day so it lines up with
    // the builder's UTC day keys.
    //   - Manual cases: first `TestRunResults.executedAt` (MIN, so a re-run of
    //     an already-executed case doesn't burn a second item).
    //   - Automated cases: no per-case timestamp, so the whole run burns down on
    //     its `createdAt` (import time) — every case in the run counted on that
    //     day.
    //   - Sessions: first `SessionResults.createdAt`.
    const [caseDayRows, automatedCaseDayRows, sessionDayRows] =
      await Promise.all([
        baseDb.$queryRaw<Array<{ day: string; count: bigint }>>`
          SELECT to_char(fe.executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 COUNT(*) AS count
          FROM (
            SELECT trc.id AS case_id, MIN(trr."executedAt") AS executed_at
            FROM "TestRunCases" trc
            JOIN "TestRuns" tr ON trc."testRunId" = tr.id
            JOIN "TestRunResults" trr
              ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            WHERE tr."milestoneId" = ANY(${allMilestoneIds}::int[])
              AND tr."isDeleted" = false
              AND NOT (tr."testRunType"::text = ANY(${automatedTypes}::text[]))
            GROUP BY trc.id
          ) fe
          GROUP BY 1
        `,
        baseDb.$queryRaw<Array<{ day: string; count: bigint }>>`
          SELECT to_char(tr."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 COUNT(trc.id) AS count
          FROM "TestRunCases" trc
          JOIN "TestRuns" tr ON trc."testRunId" = tr.id
          WHERE tr."milestoneId" = ANY(${allMilestoneIds}::int[])
            AND tr."isDeleted" = false
            AND tr."testRunType"::text = ANY(${automatedTypes}::text[])
          GROUP BY 1
        `,
        baseDb.$queryRaw<Array<{ day: string; count: bigint }>>`
          SELECT to_char(fs.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 COUNT(*) AS count
          FROM (
            SELECT s.id AS session_id, MIN(sr."createdAt") AS created_at
            FROM "Sessions" s
            JOIN "SessionResults" sr
              ON sr."sessionId" = s.id AND sr."isDeleted" = false
            WHERE s."milestoneId" = ANY(${allMilestoneIds}::int[])
              AND s."isDeleted" = false
            GROUP BY s.id
          ) fs
          GROUP BY 1
        `,
      ]);

    const executionsByDay = new Map<string, number>();
    for (const row of [
      ...caseDayRows,
      ...automatedCaseDayRows,
      ...sessionDayRows,
    ]) {
      executionsByDay.set(
        row.day,
        (executionsByDay.get(row.day) ?? 0) + Number(row.count)
      );
    }

    // Window start: the milestone's own start when set, else — for synced
    // milestones that carry only a target/end date — the first recorded
    // execution, which is a far more meaningful anchor than the local row's
    // createdAt (often long after the work happened). createdAt is the last
    // resort when there is no execution history at all.
    const earliestExecKey = [...executionsByDay.keys()].sort()[0];
    const earliestExec = earliestExecKey
      ? new Date(`${earliestExecKey}T00:00:00.000Z`)
      : null;
    const start =
      milestone?.startedAt ?? earliestExec ?? milestone?.createdAt ?? null;
    const end = milestone?.completedAt ?? null;

    const data = buildBurndownSeries({
      milestoneId,
      total,
      start,
      end,
      executionsByDay,
      now: new Date(),
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("Milestone burndown error:", error);
    return NextResponse.json(
      { error: "Failed to fetch milestone burndown" },
      { status: 500 }
    );
  }
}
