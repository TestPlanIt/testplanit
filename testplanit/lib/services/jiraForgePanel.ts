import {
  getTestRunSummary,
  TestRunNotFoundError,
  type TestRunSummaryData,
} from "~/lib/services/testRunSummary";
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

export type TestRunSummary = {
  total: number;
  passedCount: number;
  summaryText: string;
};

export type TestRunDisplayItem = {
  id: number | string;
  testCaseId?: number;
  testCaseName?: string;
  status: { name: string; color: { value: string } };
  isPending: boolean;
};

// Most segments one run's status bar carries, matching the case-detail cap
// of getTestRunSummary.
const MAX_DISPLAY_ITEMS = 1000;

function toPanelSummary(summary: TestRunSummaryData): TestRunSummary {
  return {
    total: summary.totalCases,
    passedCount: summary.statusCounts
      .filter((status) => status.isSuccess)
      .reduce((sum, status) => sum + status.count, 0),
    summaryText: summary.statusCounts
      .map((status) => `${status.count} ${status.statusName}`)
      .join(", "),
  };
}

// One status-bar segment per case. A pure automated run has no run cases,
// only results, so its bar is drawn from the per-status counts instead,
// scaled down when the run is larger than the bar can carry.
function toDisplayItems(summary: TestRunSummaryData): TestRunDisplayItem[] {
  if (summary.caseDetails) {
    return summary.caseDetails.map((item) => ({
      id: item.id,
      testCaseId: item.repositoryCaseId,
      testCaseName: item.caseName,
      status: { name: item.statusName, color: { value: item.colorValue } },
      isPending: item.statusId === null,
    }));
  }

  const scale = Math.min(1, MAX_DISPLAY_ITEMS / (summary.totalCases || 1));
  return summary.statusCounts.flatMap((status) =>
    Array.from(
      { length: Math.max(1, Math.round(status.count * scale)) },
      (_, index) => ({
        id: `${status.statusId ?? status.statusName}-${index}`,
        testCaseName: `${status.count} results`,
        status: {
          name: status.statusName,
          color: { value: status.colorValue },
        },
        isPending: false,
      })
    )
  );
}

/**
 * Each linked run's totals, read from getTestRunSummary -- the service behind
 * the run page's summary -- so the panel and the app count a run the same
 * way: manual and hybrid runs by run-case status (where automated results
 * land), pure automated runs by their JUnit results. With `includeItems` the
 * run also carries its per-case status bar.
 */
export async function loadPanelRunSummaries(
  testRunIds: number[],
  includeItems = false
): Promise<
  Map<number, TestRunSummary & { displayItems?: TestRunDisplayItem[] }>
> {
  const entries = await Promise.all(
    testRunIds.map(async (testRunId) => {
      try {
        const summary = await getTestRunSummary(testRunId, {
          includeCaseDetails: includeItems,
        });
        return [
          testRunId,
          {
            ...toPanelSummary(summary),
            ...(includeItems ? { displayItems: toDisplayItems(summary) } : {}),
          },
        ] as const;
      } catch (error) {
        if (error instanceof TestRunNotFoundError) return null;
        throw error;
      }
    })
  );
  return new Map(entries.filter((entry) => entry !== null));
}

/** One run's per-case status bar, as loadPanelRunSummaries draws it. */
export async function getTestRunDisplayItems(
  testRunId: number
): Promise<TestRunDisplayItem[]> {
  return (
    (await loadPanelRunSummaries([testRunId], true)).get(testRunId)
      ?.displayItems ?? []
  );
}
