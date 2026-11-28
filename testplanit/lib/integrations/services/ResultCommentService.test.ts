import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAdapter = vi.fn();
const mockGetTestRunSummary = vi.fn();
const mockGetTenantConfig = vi.fn();

vi.mock("@/lib/rawDb", () => ({ rawDb: {} }));
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: (...args: any[]) => mockGetAdapter(...args),
  },
}));
vi.mock("~/lib/services/testRunSummary", () => ({
  getTestRunSummary: (...args: any[]) => mockGetTestRunSummary(...args),
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getTenantConfig: (...args: any[]) => mockGetTenantConfig(...args),
}));
vi.mock("~/lib/appUrl", () => ({
  getAppUrl: () => "https://tp.example.com",
}));

import {
  MAX_COMMENT_ROWS,
  MAX_COMMENTED_ISSUES,
  renderResultComment,
  ResultCommentService,
  totalsOfRows,
  type ResultCommentRow,
} from "./ResultCommentService";

const passed = {
  name: "Passed",
  isSuccess: true,
  isFailure: false,
  isCompleted: true,
};
const failed = {
  name: "Failed",
  isSuccess: false,
  isFailure: true,
  isCompleted: true,
};
const skipped = {
  name: "Skipped",
  isSuccess: false,
  isFailure: false,
  isCompleted: true,
};
const untested = {
  name: "Untested",
  isSuccess: false,
  isFailure: false,
  isCompleted: false,
};

const MARKER =
  "<!-- testplanit-results https://tp.example.com/projects/overview/374 -->";
const RUN_URL = "https://tp.example.com/projects/runs/374/81";

describe("renderResultComment", () => {
  const rows: ResultCommentRow[] = [
    { caseId: 11, caseName: "Sign in with a password", status: failed },
    { caseId: 12, caseName: "Sign in with a passkey", status: passed },
    { caseId: 13, caseName: "Reset a password", status: untested },
    { caseId: 14, caseName: "Sign out", status: passed },
  ];

  it("starts with the marker and lists the run, the totals and a row per test case", () => {
    const body = renderResultComment({
      marker: MARKER,
      runName: "Release 2.4 regression",
      runUrl: RUN_URL,
      completedAt: new Date("2026-11-27T22:15:00Z"),
      rows,
      totals: totalsOfRows(rows),
    });

    expect(body).toBe(
      [
        MARKER,
        "### Test results from TestPlanIt",
        "",
        `**[Release 2\\.4 regression](${RUN_URL})** · completed 2026-11-27 22:15 UTC`,
        "",
        "✅ 2 Passed · ❌ 1 Failed · ⚪ 1 Untested",
        "",
        "| Test case | Result |",
        "| --- | --- |",
        `| [Sign in with a password](${RUN_URL}?selectedCase=11) | ❌ Failed |`,
        `| [Sign in with a passkey](${RUN_URL}?selectedCase=12) | ✅ Passed |`,
        `| [Reset a password](${RUN_URL}?selectedCase=13) | ⚪ Untested |`,
        `| [Sign out](${RUN_URL}?selectedCase=14) | ✅ Passed |`,
        "",
        "<sub>TestPlanIt updates this comment when a test run that covers this issue is completed.</sub>",
      ].join("\n")
    );
  });

  it("shows totals alone for an issue linked to the run itself", () => {
    const body = renderResultComment({
      marker: MARKER,
      runName: "Smoke",
      runUrl: RUN_URL,
      completedAt: null,
      rows: [],
      totals: [
        { status: passed, count: 40 },
        { status: skipped, count: 2 },
      ],
    });

    expect(body).toContain(`**[Smoke](${RUN_URL})**\n`);
    expect(body).not.toContain("· completed");
    expect(body).toContain("✅ 40 Passed · ⏭️ 2 Skipped");
    expect(body).not.toContain("| Test case |");
  });

  it("keeps names from TestPlanIt as plain text that mentions nobody", () => {
    const body = renderResultComment({
      marker: MARKER,
      runName: "Run [1] @octocat",
      runUrl: RUN_URL,
      completedAt: null,
      rows: [
        {
          caseId: 5,
          caseName: "a | b\n| forged | row |\n<img src=x> **bold**",
          status: { ...failed, name: "Failed @team #1" },
        },
      ],
      totals: [],
    });

    const row = body
      .split("\n")
      .find((line) => line.includes("selectedCase=5"))!;
    // One row: the name's own pipes and line breaks stay inside its cell.
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(3);
    expect(row).toContain("a \\| b \\| forged \\| row \\|");
    expect(row).toContain("&lt;img src=x>");
    expect(row).toContain("\\*\\*bold\\*\\*");
    expect(row).toContain("Failed @​team \\#1");
    expect(body).toContain("Run \\[1\\] @​octocat");
    expect(body).not.toMatch(/@(?!​)/);
  });

  it("lists fifty test cases and counts the rest", () => {
    const many: ResultCommentRow[] = Array.from({ length: 53 }, (_, i) => ({
      caseId: i + 1,
      caseName: `Case ${i + 1}`,
      status: passed,
    }));
    const body = renderResultComment({
      marker: MARKER,
      runName: "Big",
      runUrl: RUN_URL,
      completedAt: null,
      rows: many,
      totals: totalsOfRows(many),
    });

    expect(body.match(/selectedCase=/g)).toHaveLength(MAX_COMMENT_ROWS);
    expect(body).toContain("✅ 53 Passed");
    expect(body).toContain("_…and 3 more in the run._");
  });
});

describe("totalsOfRows", () => {
  it("counts per status and orders passes, failures, then the rest as first seen", () => {
    expect(
      totalsOfRows([
        { caseId: 1, caseName: "a", status: untested },
        { caseId: 2, caseName: "b", status: failed },
        { caseId: 3, caseName: "c", status: skipped },
        { caseId: 4, caseName: "d", status: passed },
        { caseId: 5, caseName: "e", status: failed },
      ]).map((total) => [total.status.name, total.count])
    ).toEqual([
      ["Passed", 1],
      ["Failed", 2],
      ["Untested", 1],
      ["Skipped", 1],
    ]);
  });
});

describe("ResultCommentService.postRunResultComments", () => {
  const service = new ResultCommentService();
  const upsertIssueComment = vi.fn();

  const issueRow = (id: number, number: number, extra = {}) => ({
    id,
    externalId: String(number),
    externalKey: `#${number}`,
    externalUrl: `https://github.com/acme/app/issues/${number}`,
    externalData: { _github_owner: "acme", _github_repo: "app" },
    ...extra,
  });

  const completedRun = {
    id: 81,
    name: "Release 2.4 regression",
    projectId: 374,
    isCompleted: true,
    isDeleted: false,
    completedAt: new Date("2026-11-27T22:15:00Z"),
    testRunType: "REGULAR",
    // The run's own issue links, read in a second look at the run.
    issues: [] as Array<{ id: number }>,
  };

  const makeDb = (overrides: Record<string, any> = {}) => {
    const db = {
      testRuns: { findUnique: vi.fn().mockResolvedValue(completedRun) },
      projectIntegration: {
        findFirst: vi.fn().mockResolvedValue({
          config: { resultComments: { enabled: true } },
          integration: { id: 14, provider: "GITHUB", authType: "GITHUB_APP" },
        }),
      },
      testRunCases: { findMany: vi.fn().mockResolvedValue([]) },
      jUnitTestResult: { findMany: vi.fn().mockResolvedValue([]) },
      issue: {
        findMany: vi.fn(async (args: any) =>
          (args.where.id.in as number[]).map((id) => issueRow(id, id))
        ),
      },
      ...overrides,
    };
    return db as any;
  };

  const runCase = (
    caseId: number,
    name: string,
    status: unknown,
    links: { cases?: number[]; results?: number[]; steps?: number[] }
  ) => ({
    repositoryCaseId: caseId,
    status,
    repositoryCase: {
      name,
      caseIssues: (links.cases ?? []).map((issueId) => ({ issueId })),
    },
    results: [
      {
        issues: (links.results ?? []).map((id) => ({ id })),
        stepResults: [{ issues: (links.steps ?? []).map((id) => ({ id })) }],
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    upsertIssueComment.mockResolvedValue({
      id: "1",
      created: true,
      changed: true,
    });
    mockGetAdapter.mockResolvedValue({ upsertIssueComment });
    mockGetTenantConfig.mockReturnValue(undefined);
  });

  it("skips a run that is open, deleted or gone, without reading further", async () => {
    for (const run of [
      null,
      { id: 81, projectId: 374, isCompleted: false, isDeleted: false },
      { id: 81, projectId: 374, isCompleted: true, isDeleted: true },
    ]) {
      const db = makeDb({
        testRuns: { findUnique: vi.fn().mockResolvedValue(run) },
      });
      const result = await service.postRunResultComments(81, { dbClient: db });
      expect(result.skipped).toBe("the run is not a completed run");
      expect(db.projectIntegration.findFirst).not.toHaveBeenCalled();
    }
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it("skips a project that has not switched comments on, and a connection that cannot post them", async () => {
    for (const projectIntegration of [
      null,
      {
        config: {},
        integration: { id: 14, provider: "GITHUB", authType: "GITHUB_APP" },
      },
      {
        config: { resultComments: { enabled: true } },
        integration: { id: 14, provider: "GITHUB", authType: "OAUTH2" },
      },
      {
        config: { resultComments: { enabled: true } },
        integration: { id: 14, provider: "JIRA", authType: "API_KEY" },
      },
    ]) {
      const db = makeDb({
        projectIntegration: {
          findFirst: vi.fn().mockResolvedValue(projectIntegration),
        },
      });
      const result = await service.postRunResultComments(81, { dbClient: db });
      expect(result.skipped).toBe(
        "result comments are not switched on for the project"
      );
      expect(db.testRunCases.findMany).not.toHaveBeenCalled();
    }
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it("posts on the issues linked to the run's cases, results and steps, each with its own rows", async () => {
    const db = makeDb();
    db.testRunCases.findMany.mockResolvedValue([
      runCase(11, "Sign in", failed, { cases: [5], results: [7] }),
      runCase(12, "Sign out", passed, { cases: [5, 5], steps: [9] }),
      runCase(13, "Reset", null, { cases: [7] }),
    ]);
    upsertIssueComment
      .mockResolvedValueOnce({ id: "1", created: true, changed: true })
      .mockResolvedValueOnce({ id: "2", created: false, changed: true })
      .mockResolvedValueOnce({ id: "3", created: false, changed: false });

    const result = await service.postRunResultComments(81, { dbClient: db });

    expect(db.testRunCases.findMany.mock.calls[0][0].where).toMatchObject({
      testRunId: 81,
      isDeleted: false,
    });
    expect(mockGetAdapter).toHaveBeenCalledWith("14", db);
    expect(upsertIssueComment.mock.calls.map((call) => call[0])).toEqual([
      "acme/app#5",
      "acme/app#7",
      "acme/app#9",
    ]);
    expect(upsertIssueComment.mock.calls.every((c) => c[1] === MARKER)).toBe(
      true
    );

    const [five, seven, nine] = upsertIssueComment.mock.calls.map(
      (call) => call[2] as string
    );
    expect(five.startsWith(`${MARKER}\n`)).toBe(true);
    expect(five).toContain(
      `**[Release 2\\.4 regression](${RUN_URL})** · completed 2026-11-27 22:15 UTC`
    );
    expect(five).toContain("✅ 1 Passed · ❌ 1 Failed");
    expect(five).toContain(`[Sign in](${RUN_URL}?selectedCase=11) | ❌ Failed`);
    // Linked twice to the same case, listed once.
    expect(five.match(/selectedCase=12/g)).toHaveLength(1);
    expect(seven).toContain("❌ 1 Failed · ⚪ 1 Untested");
    expect(seven).toContain(
      `[Reset](${RUN_URL}?selectedCase=13) | ⚪ Untested`
    );
    expect(nine).toContain("✅ 1 Passed");
    expect(nine).not.toContain("selectedCase=11");

    expect(result).toEqual({
      success: true,
      created: 1,
      updated: 1,
      unchanged: 1,
      errors: [],
    });
  });

  it("shows the whole run's totals on an issue linked to the run alone", async () => {
    const db = makeDb();
    db.testRuns.findUnique.mockResolvedValue({
      ...completedRun,
      issues: [{ id: 21 }],
    });
    mockGetTestRunSummary.mockResolvedValue({
      statusCounts: [
        { statusName: "Failed", count: 3, isFailure: true, isCompleted: true },
        { statusName: "Passed", count: 37, isSuccess: true, isCompleted: true },
        { statusName: "Blocked", count: 0, isCompleted: true },
      ],
    });

    const result = await service.postRunResultComments(81, { dbClient: db });

    expect(db.testRuns.findUnique.mock.calls[1][0].select).toEqual({
      issues: {
        where: { integrationId: 14, isDeleted: false },
        select: { id: true },
      },
    });
    expect(mockGetTestRunSummary).toHaveBeenCalledWith(81, { client: db });
    const body = upsertIssueComment.mock.calls[0][2] as string;
    expect(upsertIssueComment.mock.calls[0][0]).toBe("acme/app#21");
    expect(body).toContain("✅ 37 Passed · ❌ 3 Failed");
    expect(body).not.toContain("Blocked");
    expect(body).not.toContain("| Test case |");
    expect(result.created).toBe(1);
  });

  it("reads an automated run from its results, the latest per test case", async () => {
    const db = makeDb();
    db.testRuns.findUnique.mockResolvedValue({
      id: 81,
      name: "Nightly",
      projectId: 374,
      isCompleted: true,
      isDeleted: false,
      completedAt: null,
      testRunType: "JUNIT",
    });
    const automated = (caseId: number, type: string, status: unknown) => ({
      type,
      repositoryCaseId: caseId,
      status,
      repositoryCase: { name: `Case ${caseId}`, caseIssues: [{ issueId: 5 }] },
    });
    db.jUnitTestResult.findMany.mockResolvedValue([
      automated(11, "FAILURE", null),
      automated(12, "SKIPPED", null),
      automated(11, "PASSED", passed),
      automated(13, "ERROR", null),
    ]);

    await service.postRunResultComments(81, { dbClient: db });

    expect(db.testRunCases.findMany).not.toHaveBeenCalled();
    expect(db.jUnitTestResult.findMany.mock.calls[0][0].where).toMatchObject({
      testSuite: { testRunId: 81 },
    });
    const body = upsertIssueComment.mock.calls[0][2] as string;
    expect(body).toContain("✅ 1 Passed · ❌ 1 ERROR · ⏭️ 1 SKIPPED");
    expect(body).toContain(`[Case 11](${RUN_URL}?selectedCase=11) | ✅ Passed`);
    expect(body).toContain(`[Case 13](${RUN_URL}?selectedCase=13) | ❌ ERROR`);
  });

  it("finds the repository in the issue's address, and reports an issue whose repository is unknown", async () => {
    const db = makeDb();
    db.testRunCases.findMany.mockResolvedValue([
      runCase(11, "Sign in", passed, { cases: [5, 6, 7] }),
    ]);
    db.issue.findMany.mockResolvedValue([
      issueRow(5, 5, {
        externalId: "#5",
        externalData: null,
        externalUrl: "https://ghes.example.com/acme/app/issues/5",
      }),
      issueRow(6, 6, { externalData: null, externalUrl: null }),
      issueRow(7, 7, { externalId: "other/repo#7" }),
    ]);
    upsertIssueComment.mockImplementation(async (ref: string) => {
      if (ref === "other/repo#7") throw new Error("HTTP 404: Not Found");
      return { id: "1", created: true, changed: true };
    });

    const result = await service.postRunResultComments(81, { dbClient: db });

    expect(upsertIssueComment.mock.calls.map((call) => call[0])).toEqual([
      "acme/app#5",
      "other/repo#7",
    ]);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      "#6: the issue's repository is not known",
      "#7: HTTP 404: Not Found",
    ]);
  });

  it("skips when the run covers no issue of the project's tracker", async () => {
    const db = makeDb();

    const result = await service.postRunResultComments(81, { dbClient: db });

    expect(result.skipped).toBe(
      "the run covers no issue of the project's tracker"
    );
    expect(mockGetAdapter).not.toHaveBeenCalled();
  });

  it("reports a connection that cannot be used, and skips one that cannot edit comments", async () => {
    const db = makeDb();
    db.testRunCases.findMany.mockResolvedValue([
      runCase(11, "Sign in", passed, { cases: [5] }),
    ]);

    mockGetAdapter.mockRejectedValueOnce(new Error("Integration not active"));
    expect(
      await service.postRunResultComments(81, { dbClient: db })
    ).toMatchObject({ success: false, errors: ["Integration not active"] });

    mockGetAdapter.mockResolvedValueOnce({});
    expect(
      (await service.postRunResultComments(81, { dbClient: db })).skipped
    ).toBe("the tracker connection cannot edit comments");
  });

  it("links to the tenant's own address", async () => {
    const db = makeDb();
    db.testRunCases.findMany.mockResolvedValue([
      runCase(11, "Sign in", passed, { cases: [5] }),
    ]);
    mockGetTenantConfig.mockReturnValue({
      baseUrl: "https://acme.testplanit.test",
    });

    await service.postRunResultComments(81, {
      dbClient: db,
      tenantId: "tenant-a",
    });

    expect(mockGetTenantConfig).toHaveBeenCalledWith("tenant-a");
    const [, marker, body] = upsertIssueComment.mock.calls[0];
    expect(marker).toBe(
      "<!-- testplanit-results https://acme.testplanit.test/projects/overview/374 -->"
    );
    expect(body).toContain("https://acme.testplanit.test/projects/runs/374/81");
  });

  it("writes to at most a hundred issues and says so", async () => {
    const db = makeDb();
    const issueIds = Array.from({ length: 103 }, (_, i) => i + 1);
    db.testRunCases.findMany.mockResolvedValue([
      runCase(11, "Sign in", passed, { cases: issueIds }),
    ]);

    const result = await service.postRunResultComments(81, { dbClient: db });

    expect(upsertIssueComment).toHaveBeenCalledTimes(MAX_COMMENTED_ISSUES);
    expect(result.errors).toEqual([
      "The run covers 103 issues; results were posted on the first 100",
    ]);
  });
});
