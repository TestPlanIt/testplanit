import { baseDb as db } from "@/lib/db";
import { sql } from "kysely";
import { IntegrationProvider } from "~/zenstack/models";

// Shared by the Jira issue panel's routes: test-info (the panel's initial
// load) and test-run-cases (a run's per-case status bar, fetched on expand).

/**
 * Where clause for every Issue row that represents this Jira issue. There may
 * be duplicates (same key under several rows), so callers aggregate across all
 * of them.
 */
export function panelIssueWhere(
  issueKey: string | null,
  issueId: string | null
) {
  return {
    OR: [
      { name: issueKey || "" },
      { externalId: issueId || "" },
      { externalKey: issueKey || "" },
    ],
    integration: {
      provider: IntegrationProvider.JIRA,
    },
  };
}

/** The run and session ids an issue reaches, through every link path. */
export const panelIssueLinkSelect = {
  testRuns: { select: { id: true } },
  testRunResults: { select: { testRunId: true } },
  testRunStepResults: {
    select: { testRunResult: { select: { testRunId: true } } },
  },
  sessions: { select: { id: true } },
  sessionResults: { select: { sessionId: true } },
} as const;

type PanelIssueLinks = {
  testRuns: { id: number }[];
  testRunResults?: { testRunId: number }[];
  testRunStepResults?: { testRunResult: { testRunId: number } | null }[];
  sessions: { id: number }[];
  sessionResults?: { sessionId: number }[];
};

/**
 * Distinct run ids in panel display order: direct links first, then runs
 * reached through linked results, then through linked step results.
 */
export function collectPanelTestRunIds(issues: PanelIssueLinks[]): number[] {
  const ids = new Set<number>();
  issues.forEach((i) => i.testRuns.forEach((r) => ids.add(r.id)));
  issues.forEach((i) =>
    (i.testRunResults || []).forEach((r) => ids.add(r.testRunId))
  );
  issues.forEach((i) =>
    (i.testRunStepResults || []).forEach((s) => {
      if (s.testRunResult) ids.add(s.testRunResult.testRunId);
    })
  );
  return [...ids];
}

/** Distinct session ids in panel display order: direct links, then results. */
export function collectPanelSessionIds(issues: PanelIssueLinks[]): number[] {
  const ids = new Set<number>();
  issues.forEach((i) => i.sessions.forEach((s) => ids.add(s.id)));
  issues.forEach((i) =>
    (i.sessionResults || []).forEach((r) => ids.add(r.sessionId))
  );
  return [...ids];
}

// Label for a run case with no live result, shared by the summary and the
// per-case bar so the two can never disagree.
const PENDING_STATUS = {
  name: "Pending",
  color: { value: "#9ca3af" },
};

export type TestRunSummary = {
  total: number;
  passedCount: number;
  summaryText: string;
};

/**
 * Per-run case totals, computed in SQL instead of loading every case of every
 * run. Each case counts under its latest live result's status, or Pending.
 * `summaryText` lists statuses in the order they first appear walking the run
 * in case order, and `passedCount` matches the panel's "Passed" pass rate.
 */
export async function summarizeTestRuns(
  testRunIds: number[]
): Promise<Map<number, TestRunSummary>> {
  const summaries = new Map<number, TestRunSummary>();
  if (testRunIds.length === 0) return summaries;

  const rows = (
    await sql<{
      test_run_id: number;
      status_name: string;
      case_count: number;
    }>`
      SELECT
        trc."testRunId" AS test_run_id,
        COALESCE(s.name, ${PENDING_STATUS.name}) AS status_name,
        COUNT(*)::int AS case_count,
        MIN(trc."order") AS first_order,
        MIN(trc.id) AS first_id
      FROM "TestRunCases" trc
      LEFT JOIN LATERAL (
        SELECT r."statusId"
        FROM "TestRunResults" r
        WHERE r."testRunCaseId" = trc.id AND r."isDeleted" = false
        ORDER BY r."executedAt" DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN "Status" s ON s.id = latest."statusId"
      WHERE trc."testRunId" = ANY(${testRunIds}) AND trc."isDeleted" = false
      GROUP BY 1, 2
      ORDER BY trc."testRunId", first_order, first_id
    `.execute(db.$qb)
  ).rows;

  const parts = new Map<number, string[]>();
  for (const row of rows) {
    const summary = summaries.get(row.test_run_id) ?? {
      total: 0,
      passedCount: 0,
      summaryText: "",
    };
    summary.total += row.case_count;
    if (row.status_name === "Passed") summary.passedCount += row.case_count;
    summaries.set(row.test_run_id, summary);

    const runParts = parts.get(row.test_run_id) ?? [];
    runParts.push(`${row.case_count} ${row.status_name}`);
    parts.set(row.test_run_id, runParts);
  }
  for (const [runId, runParts] of parts) {
    summaries.get(runId)!.summaryText = runParts.join(", ");
  }
  return summaries;
}

/**
 * One status-bar segment per case in a run, in case order: the case's latest
 * live result status, or Pending when it has none.
 */
export async function getTestRunDisplayItems(testRunIds: number[]) {
  const runCases = await db.testRunCases.findMany({
    where: { testRunId: { in: testRunIds }, isDeleted: false },
    orderBy: { order: "asc" },
    select: {
      id: true,
      testRunId: true,
      repositoryCase: {
        select: {
          id: true,
          name: true,
        },
      },
      results: {
        where: { isDeleted: false },
        orderBy: { executedAt: "desc" },
        take: 1,
        select: {
          status: {
            include: {
              color: true,
            },
          },
        },
      },
    },
  });

  const itemsByRun = new Map<number, any[]>();
  testRunIds.forEach((id) => itemsByRun.set(id, []));
  for (const runCase of runCases) {
    const latestResult = runCase.results[0];
    itemsByRun.get(runCase.testRunId)?.push({
      id: runCase.id,
      testCaseId: runCase.repositoryCase?.id,
      testCaseName: runCase.repositoryCase?.name,
      status: latestResult ? latestResult.status : PENDING_STATUS,
      isPending: !latestResult,
    });
  }
  return itemsByRun;
}
