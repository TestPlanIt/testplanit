import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db before importing the route handler.
vi.mock("@/lib/db", () => ({
  baseDb: {
    integration: { findMany: vi.fn() },
    status: { findFirst: vi.fn() },
    issue: { findMany: vi.fn() },
    templates: { findMany: vi.fn() },
    caseFieldValues: { findMany: vi.fn() },
    steps: { findMany: vi.fn() },
    testRunCases: { findMany: vi.fn() },
    testRuns: { findMany: vi.fn() },
    sessions: { findMany: vi.fn() },
    testRunResults: { findMany: vi.fn() },
    jUnitTestResult: { findMany: vi.fn() },
  },
}));

// Per-run case counts are a raw SQL aggregate; it cannot run against the
// mocked client, so lazy-mode tests supply the summaries directly.
vi.mock("~/lib/services/jiraForgePanel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/services/jiraForgePanel")>()),
  summarizeTestRuns: vi.fn(),
}));

// The latest-result ranking is a raw SQL query spanning TestRunResults and
// JUnitTestResult; it cannot run against the mocked client, and its own
// behaviour is covered by the service's tests.
vi.mock("~/lib/services/latestTestResults", () => ({
  getLatestTestResultsByCase: vi.fn(),
}));

import { baseDb } from "@/lib/db";
import { summarizeTestRuns } from "~/lib/services/jiraForgePanel";
import { getLatestTestResultsByCase } from "~/lib/services/latestTestResults";

import { GET } from "./route";

const FORGE_API_KEY = "test-forge-key";

const buildRequest = (query = ""): NextRequest =>
  new NextRequest(
    `http://localhost/api/integrations/jira/test-info?issueKey=PROJ-1${query}`,
    { headers: { "X-Forge-Api-Key": FORGE_API_KEY } }
  );

/**
 * A linked case with everything the panel reads about it in one place: its
 * Jira-panel-enabled template fields (the jiraPanelEnabled filter lives in the
 * query's where clause, so the fixture only contains opted-in fields), field
 * values, steps and run history. `mockLinkedCases` splits it across the
 * queries the route actually makes.
 */
const buildCase = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  name: "Case A",
  state: {
    name: "Draft",
    icon: { name: "Pencil" },
    color: { value: "#123456" },
  },
  project: { id: 5 },
  isDeleted: false,
  isArchived: false,
  source: "MANUAL",
  estimate: null,
  forecastManual: null,
  forecastAutomated: null,
  template: { caseFields: [] },
  caseFieldValues: [],
  testRuns: [],
  ...overrides,
});

const buildIssue = (
  testCases: Record<string, unknown>[] = [],
  links: Record<string, unknown> = {}
) => ({
  id: 1,
  caseIssues: testCases.map((testCase) => ({ case: testCase })),
  sessions: [],
  testRuns: [],
  testRunResults: [],
  testRunStepResults: [],
  sessionResults: [],
  ...links,
});

/**
 * Serve `testCases` (built with `buildCase`) through the route's queries: the
 * issue lookup returns the case rows, each distinct template is loaded once,
 * field values and steps come from their own tables, and a deleted case
 * counts as having results when any of its run rows carries one.
 */
const mockLinkedCases = (...testCases: any[]) => {
  const rows = testCases.map((testCase, index) => {
    const {
      template,
      caseFieldValues: _values,
      steps: _steps,
      testRuns: _runs,
      ...row
    } = testCase;
    return {
      ...row,
      templateId: template?.caseFields?.length ? 5000 + index : 4000 + index,
    };
  });
  vi.mocked(baseDb.issue.findMany).mockResolvedValue([buildIssue(rows)] as any);
  vi.mocked(baseDb.templates.findMany).mockResolvedValue(
    testCases.map((testCase, index) => ({
      id: rows[index].templateId,
      caseFields: testCase.template?.caseFields ?? [],
    })) as any
  );
  vi.mocked(baseDb.caseFieldValues.findMany).mockResolvedValue(
    testCases.flatMap((testCase) =>
      (testCase.caseFieldValues ?? []).map((value: any) => ({
        ...value,
        testCaseId: testCase.id,
      }))
    ) as any
  );
  vi.mocked(baseDb.steps.findMany).mockResolvedValue(
    testCases.flatMap((testCase) =>
      (testCase.steps ?? []).map((step: any) => ({
        ...step,
        testCaseId: testCase.id,
      }))
    ) as any
  );
  vi.mocked(baseDb.testRunCases.findMany).mockResolvedValue(
    testCases
      .filter((testCase) =>
        (testCase.testRuns ?? []).some(
          (runCase: any) => runCase.results.length > 0
        )
      )
      .map((testCase) => ({ repositoryCaseId: testCase.id })) as any
  );
};

/** A TestRunCases row as the route's include returns it (live results only). */
const buildRunCase = (
  results: Record<string, unknown>[],
  overrides: Record<string, unknown> = {}
) => ({
  id: 50,
  testRun: { id: 7, name: "Regression", isCompleted: true },
  results,
  ...overrides,
});

const buildResult = (overrides: Record<string, unknown> = {}) => ({
  id: 900,
  status: { name: "Passed", color: { value: "#16a34a" } },
  executedAt: "2026-09-01T10:00:00.000Z",
  executedBy: { id: "u1", name: "Ann" },
  editedAt: null,
  editedBy: null,
  elapsed: 42,
  testRunCaseVersion: 2,
  attempt: 1,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no recorded executions. Tests that care set their own.
  vi.mocked(getLatestTestResultsByCase).mockResolvedValue(new Map());
  vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
  vi.mocked(baseDb.jUnitTestResult.findMany).mockResolvedValue([] as never);
  vi.mocked(baseDb.integration.findMany).mockResolvedValue([
    { id: 1, settings: { forgeApiKey: FORGE_API_KEY } },
  ] as any);
  vi.mocked(baseDb.status.findFirst).mockResolvedValue({
    name: "Untested",
    color: { value: "#9ca3af" },
  } as any);
});

describe("jira test-info deleted cases", () => {
  it("omits deleted cases that have no surviving results", async () => {
    mockLinkedCases(
      buildCase({ id: 10, name: "Live" }),
      buildCase({ id: 11, name: "Never run", isDeleted: true }),
      // Only live results count, so a run row whose results were all
      // deleted counts as none.
      buildCase({
        id: 12,
        name: "Results gone",
        isDeleted: true,
        testRuns: [buildRunCase([])],
      })
    );

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.testCases.map((testCase: any) => testCase.id)).toEqual([10]);
  });

  it("keeps a deleted case that has results and returns its history", async () => {
    mockLinkedCases(
      buildCase({
        id: 11,
        name: "Gone",
        isDeleted: true,
        testRuns: [buildRunCase([buildResult()])],
      })
    );
    // The ranking service decides what the history holds; the route hydrates
    // the detail columns from the source table the ranking points at.
    vi.mocked(getLatestTestResultsByCase).mockResolvedValue(
      new Map([
        [
          11,
          [
            {
              executionSource: "manual" as const,
              resultId: 900,
              testRunId: 7,
              statusName: "Passed",
              statusColor: "#16a34a",
              isSuccess: true,
              isFailure: false,
              executedAt: "2026-09-01T10:00:00.000Z",
            },
          ],
        ],
      ])
    );
    vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([
      {
        id: 900,
        executedAt: "2026-09-01T10:00:00.000Z",
        editedAt: null,
        elapsed: 42,
        testRunCaseVersion: 2,
        attempt: 1,
        executedBy: { id: "u1", name: "Ann" },
        editedBy: null,
        testRunCase: {
          id: 55,
          testRun: { id: 7, name: "Regression", isCompleted: true },
        },
      },
    ] as never);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases).toHaveLength(1);
    expect(body.testCases[0]).toMatchObject({
      id: 11,
      name: "Gone",
      isDeleted: true,
      lastResult: "Passed",
      lastResultColor: "#16a34a",
    });
    expect(body.testCases[0].resultHistory).toEqual([
      expect.objectContaining({
        resultId: 900,
        testRunId: 7,
        testRunName: "Regression",
        testRunIsCompleted: true,
        status: "Passed",
        statusColor: "#16a34a",
        executedBy: { id: "u1", name: "Ann" },
        testRunCaseVersion: 2,
      }),
    ]);
  });

  it("reports the automated flag so the panel can draw the right icon", async () => {
    // `source` stays MANUAL on an imported case that later gained automation,
    // so the boolean is the only thing that can distinguish the two.
    mockLinkedCases(
      buildCase({ id: 12, name: "Automated", automated: true, testRuns: [] })
    );

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].automated).toBe(true);
  });

  it("defaults the automated flag to false when the column is null", async () => {
    mockLinkedCases(
      buildCase({ id: 13, name: "Legacy", automated: null, testRuns: [] })
    );

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].automated).toBe(false);
  });

  it("reports an automated execution as the latest result", async () => {
    // The regression this guards: the panel used to read only the loaded
    // `testRuns` relation, which holds manual TestRunResults, so an automated
    // case showed a stale manual result instead of its most recent CI run.
    mockLinkedCases(
      buildCase({
        id: 14,
        name: "CI case",
        automated: true,
        testRuns: [buildRunCase([buildResult({ id: 901 })])],
      })
    );
    vi.mocked(getLatestTestResultsByCase).mockResolvedValue(
      new Map([
        [
          14,
          [
            {
              executionSource: "automated" as const,
              resultId: 5000,
              testRunId: 70,
              statusName: "Failed",
              statusColor: "#ef4444",
              isSuccess: false,
              isFailure: true,
              executedAt: "2026-09-13T04:30:35.337Z",
            },
          ],
        ],
      ])
    );
    vi.mocked(baseDb.jUnitTestResult.findMany).mockResolvedValue([
      {
        id: 5000,
        executedAt: "2026-09-13T04:30:35.337Z",
        time: 12.5,
        testSuite: {
          testRun: { id: 70, name: "Web Regression", isCompleted: false },
        },
      },
    ] as never);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].lastResult).toBe("Failed");
    expect(body.testCases[0].lastResultColor).toBe("#ef4444");
    expect(body.testCases[0].resultHistory).toEqual([
      expect.objectContaining({
        resultId: 5000,
        testRunId: 70,
        testRunName: "Web Regression",
        status: "Failed",
        // CI wrote it: no user, no edit trail, no per-case version.
        executedBy: { id: null, name: "Automation" },
        editedBy: null,
        testRunCaseVersion: null,
        // JUnit stores seconds; the panel renders milliseconds.
        elapsed: 12500,
      }),
    ]);
  });

  it("still returns a live case that has never been run", async () => {
    mockLinkedCases(buildCase({ id: 10, name: "Live", testRuns: [] }));

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases.map((testCase: any) => testCase.id)).toEqual([10]);
    expect(body.testCases[0].lastResult).toBe("Untested");
  });
});

describe("jira test-info fields resolution", () => {
  it("resolves each field type like the repository case table", async () => {
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 101,
              displayName: "Priority",
              type: { type: "Dropdown" },
              fieldOptions: [
                {
                  fieldOption: {
                    id: 7,
                    name: "High",
                    icon: { name: "Flame" },
                    iconColor: { value: "#ff0000" },
                  },
                },
              ],
            },
          },
          {
            caseField: {
              id: 102,
              displayName: "Automated",
              type: { type: "Checkbox" },
              fieldOptions: [],
            },
          },
          {
            caseField: {
              id: 103,
              displayName: "Notes",
              type: { type: "Text Long" },
              fieldOptions: [],
            },
          },
          {
            caseField: {
              id: 104,
              displayName: "Build",
              type: { type: "Text String" },
              fieldOptions: [],
            },
          },
        ],
      },
      caseFieldValues: [
        // Dropdown values arrive as the selected option id (string or number).
        { fieldId: 101, value: "7" },
        { fieldId: 102, value: true },
        {
          fieldId: 103,
          value: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "hello world" }],
              },
            ],
          },
        },
        // No value for 104 — the field still appears, with a null value.
      ],
    });
    mockLinkedCases(testCase);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.testCases).toHaveLength(1);
    expect(body.testCases[0].fields).toEqual([
      {
        id: 101,
        label: "Priority",
        type: "Dropdown",
        value: null,
        options: [{ name: "High", icon: "Flame", iconColor: "#ff0000" }],
      },
      { id: 102, label: "Automated", type: "Checkbox", value: true },
      { id: 103, label: "Notes", type: "Text Long", value: "hello world" },
      { id: 104, label: "Build", type: "Text String", value: null },
    ]);
  });

  it("resolves Multi-Select values in selection order and drops unknown option ids", async () => {
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 201,
              displayName: "Browsers",
              type: { type: "Multi-Select" },
              fieldOptions: [
                {
                  fieldOption: {
                    id: 1,
                    name: "Chrome",
                    icon: null,
                    iconColor: null,
                  },
                },
                {
                  fieldOption: {
                    id: 2,
                    name: "Firefox",
                    icon: { name: "Flame" },
                    iconColor: { value: "#f60" },
                  },
                },
              ],
            },
          },
        ],
      },
      caseFieldValues: [{ fieldId: 201, value: ["2", "1", "999"] }],
    });
    mockLinkedCases(testCase);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([
      {
        id: 201,
        label: "Browsers",
        type: "Multi-Select",
        value: null,
        options: [
          { name: "Firefox", icon: "Flame", iconColor: "#f60" },
          { name: "Chrome", icon: null, iconColor: null },
        ],
      },
    ]);
  });

  it("resolves Steps from the steps relation, expanding shared groups and dropping deleted ones", async () => {
    const doc = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const testCase = buildCase({
      template: {
        caseFields: [
          {
            caseField: {
              id: 301,
              displayName: "Steps",
              type: { type: "Steps" },
              fieldOptions: [],
            },
          },
        ],
      },
      steps: [
        {
          id: 1,
          order: 1,
          step: doc("Open the page"),
          expectedResult: doc("Page loads"),
          sharedStepGroupId: null,
          sharedStepGroup: null,
        },
        {
          id: 2,
          order: 2,
          step: null,
          expectedResult: null,
          sharedStepGroupId: 9,
          sharedStepGroup: {
            name: "Login preamble",
            isDeleted: false,
            items: [
              {
                step: doc("Open sign-in"),
                expectedResult: doc("Form visible"),
              },
              { step: doc("Sign in"), expectedResult: doc("Dashboard loads") },
            ],
          },
        },
        {
          id: 3,
          order: 3,
          step: null,
          expectedResult: null,
          sharedStepGroupId: 10,
          sharedStepGroup: { name: "Gone", isDeleted: true, items: [] },
        },
      ],
    });
    mockLinkedCases(testCase);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([
      {
        id: 301,
        label: "Steps",
        type: "Steps",
        value: null,
        steps: [
          { step: "Open the page", expected: "Page loads" },
          {
            group: "Login preamble",
            items: [
              { step: "Open sign-in", expected: "Form visible" },
              { step: "Sign in", expected: "Dashboard loads" },
            ],
          },
        ],
      },
    ]);
  });

  it("returns an empty fields array when the template has no panel-enabled fields", async () => {
    mockLinkedCases(buildCase());

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(body.testCases[0].fields).toEqual([]);
  });

  it("rejects requests without a valid Forge API key", async () => {
    const request = new NextRequest(
      "http://localhost/api/integrations/jira/test-info?issueKey=PROJ-1",
      { headers: { "X-Forge-Api-Key": "wrong-key" } }
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(baseDb.issue.findMany).not.toHaveBeenCalled();
  });
});

describe("jira test-info field queries", () => {
  it("skips values and steps when no linked template shows panel fields", async () => {
    mockLinkedCases(buildCase({ id: 10 }), buildCase({ id: 11 }));

    await GET(buildRequest());

    expect(baseDb.templates.findMany).toHaveBeenCalledTimes(1);
    expect(baseDb.caseFieldValues.findMany).not.toHaveBeenCalled();
    expect(baseDb.steps.findMany).not.toHaveBeenCalled();
  });

  it("loads values for panel fields only, and steps only for a panel Steps field", async () => {
    mockLinkedCases(
      buildCase({
        id: 10,
        template: {
          caseFields: [
            {
              caseField: {
                id: 101,
                displayName: "Build",
                type: { type: "Text String" },
                fieldOptions: [],
              },
            },
          ],
        },
      })
    );

    await GET(buildRequest());

    expect(baseDb.caseFieldValues.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { testCaseId: { in: [10] }, fieldId: { in: [101] } },
      })
    );
    expect(baseDb.steps.findMany).not.toHaveBeenCalled();
  });
});

describe("jira test-info runs and sessions", () => {
  const runRow = (id: number) => ({
    id,
    name: `Run ${id}`,
    isDeleted: false,
    state: { name: "Active", icon: { name: "Play" }, color: { value: "#00f" } },
    project: { id: 5 },
  });

  // Run 7 is linked directly, through a result and through a step result;
  // run 8 only through a result.
  const linkRuns = () =>
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue([], {
        testRuns: [{ id: 7 }],
        testRunResults: [{ testRunId: 8 }, { testRunId: 7 }],
        testRunStepResults: [{ testRunResult: { testRunId: 7 } }],
      }),
    ] as any);

  beforeEach(() => {
    vi.mocked(baseDb.templates.findMany).mockResolvedValue([] as any);
    vi.mocked(baseDb.testRuns.findMany).mockResolvedValue([
      runRow(8),
      runRow(7),
    ] as any);
  });

  it("loads each linked run once, in link order, with its per-case bar inline", async () => {
    linkRuns();
    vi.mocked(baseDb.testRunCases.findMany).mockResolvedValue([
      {
        id: 70,
        testRunId: 7,
        repositoryCase: { id: 1, name: "A" },
        results: [{ status: { name: "Passed", color: { value: "#0f0" } } }],
      },
      {
        id: 71,
        testRunId: 7,
        repositoryCase: { id: 2, name: "B" },
        results: [],
      },
    ] as any);

    const body = await (await GET(buildRequest())).json();

    expect(baseDb.testRuns.findMany).toHaveBeenCalledTimes(1);
    expect(baseDb.testRuns.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [7, 8] } } })
    );
    expect(body.testRuns.map((run: any) => run.id)).toEqual([7, 8]);
    expect(body.testRuns[0]).toMatchObject({
      total: 2,
      passedCount: 1,
      summaryText: "1 Passed, 1 Pending",
    });
    expect(body.testRuns[0].displayItems).toEqual([
      {
        id: 70,
        testCaseId: 1,
        testCaseName: "A",
        status: { name: "Passed", color: { value: "#0f0" } },
        isPending: false,
      },
      {
        id: 71,
        testCaseId: 2,
        testCaseName: "B",
        status: { name: "Pending", color: { value: "#9ca3af" } },
        isPending: true,
      },
    ]);
    expect(body.testRuns[1]).toMatchObject({
      total: 0,
      summaryText: "",
      displayItems: [],
    });
    expect(summarizeTestRuns).not.toHaveBeenCalled();
  });

  it("sends only run totals when the panel loads run cases lazily", async () => {
    linkRuns();
    vi.mocked(summarizeTestRuns).mockResolvedValue(
      new Map([
        [7, { total: 2, passedCount: 1, summaryText: "1 Passed, 1 Pending" }],
      ])
    );

    const body = await (await GET(buildRequest("&runCases=lazy"))).json();

    expect(summarizeTestRuns).toHaveBeenCalledWith([7, 8]);
    expect(baseDb.testRunCases.findMany).not.toHaveBeenCalled();
    expect(body.testRuns[0]).toMatchObject({
      id: 7,
      total: 2,
      passedCount: 1,
      summaryText: "1 Passed, 1 Pending",
    });
    expect(body.testRuns[0]).not.toHaveProperty("displayItems");
    // A run with no cases has no aggregate row.
    expect(body.testRuns[1]).toMatchObject({
      id: 8,
      total: 0,
      passedCount: 0,
      summaryText: "",
    });
  });

  it("loads each linked session once, direct links first", async () => {
    vi.mocked(baseDb.issue.findMany).mockResolvedValue([
      buildIssue([], {
        sessions: [{ id: 3 }],
        sessionResults: [{ sessionId: 4 }, { sessionId: 3 }],
      }),
    ] as any);
    vi.mocked(baseDb.sessions.findMany).mockResolvedValue(
      [4, 3].map((id) => ({
        id,
        name: `Session ${id}`,
        estimate: null,
        isDeleted: false,
        state: { name: "Open", icon: null, color: null },
        project: { id: 5 },
        sessionResults: [
          {
            id: id * 10,
            elapsed: 60,
            createdAt: "2026-09-01T10:00:00.000Z",
            status: { name: "Passed" },
          },
        ],
      })) as any
    );

    const body = await (await GET(buildRequest())).json();

    expect(baseDb.sessions.findMany).toHaveBeenCalledTimes(1);
    expect(body.sessions.map((session: any) => session.id)).toEqual([3, 4]);
    expect(body.sessions[0]).toMatchObject({
      total: 1,
      totalElapsed: 60,
      hasElapsed: true,
      summaryText: "1 Passed",
    });
  });
});
