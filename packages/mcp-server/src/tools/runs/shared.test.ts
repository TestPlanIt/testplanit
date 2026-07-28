import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import { zenstack } from "../../api.js";
import {
  mapRunRow,
  mapRunDetailTestCase,
  mapRunResultRow,
  mapRunResultDetail,
  mapJunitResultRow,
  mapJunitResultDetail,
  mapStepResult,
  mergeResultsPage,
  parseResultsCursor,
  formatResultsCursor,
  computeStatusRollup,
  extractJunitStatusGroupsByRun,
  extractJunitStatusNames,
  extractStatusNames,
  isAutomatedRunType,
} from "./shared.js";

const mockZenstack = vi.mocked(zenstack);

const ENV = {
  apiUrl: "https://app.testplanit.test",
  apiToken: "tpi_test_xxxxxxxx",
};

beforeEach(() => {
  mockZenstack.mockReset();
});

// ── computeStatusRollup ────────────────────────────────────────────────────

describe("computeStatusRollup", () => {
  it("R3: counts sum to total — total computed from groups, not a separate count call", () => {
    const groups = [
      { statusId: 1, _count: { id: 10 } },
      { statusId: 2, _count: { id: 3 } },
      { statusId: null, _count: { id: 5 } },
    ];
    const nameById = new Map([
      [1, "Passed"],
      [2, "Failed"],
    ]);
    const result = computeStatusRollup(groups, nameById);
    expect(result).toEqual({
      statusCounts: [
        { id: 1, name: "Passed", count: 10 },
        { id: 2, name: "Failed", count: 3 },
      ],
      untested: 5,
      total: 18,
    });
    // Critical: total === sum of group counts (R3)
    expect(result.total).toBe(groups.reduce((s, g) => s + g._count.id, 0));
  });

  it("empty groups → zeros across the board", () => {
    const result = computeStatusRollup([], new Map());
    expect(result).toEqual({ statusCounts: [], untested: 0, total: 0 });
  });

  it("only null statusId (every case untested)", () => {
    const result = computeStatusRollup(
      [{ statusId: null, _count: { id: 7 } }],
      new Map(),
    );
    expect(result).toEqual({
      statusCounts: [],
      untested: 7,
      total: 7,
    });
  });

  it("unknown statusId falls back to 'Unknown' name", () => {
    const result = computeStatusRollup(
      [{ statusId: 99, _count: { id: 2 } }],
      new Map(),
    );
    expect(result.statusCounts).toEqual([
      { id: 99, name: "Unknown", count: 2 },
    ]);
    expect(result.untested).toBe(0);
    expect(result.total).toBe(2);
  });
});

// ── extractStatusNames ────────────────────────────────────────────────────

describe("extractStatusNames", () => {
  it("issues groupBy + status findMany when non-null statusIds present", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        { statusId: 1, _count: { id: 5 } },
        { statusId: null, _count: { id: 2 } },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "Passed" }]);

    const result = await extractStatusNames(42, ENV);

    expect(mockZenstack.mock.calls.length).toBe(2);

    const firstCall = mockZenstack.mock.calls[0];
    expect(firstCall[0]).toBe("testRunCases");
    expect(firstCall[1]).toBe("groupBy");
    const firstBody = firstCall[2] as Record<string, unknown>;
    expect(firstBody.by).toEqual(["statusId"]);
    expect(firstBody.where).toEqual({ testRunId: 42 });
    expect(firstBody._count).toEqual({ id: true });

    const secondCall = mockZenstack.mock.calls[1];
    expect(secondCall[0]).toBe("status");
    expect(secondCall[1]).toBe("findMany");
    const secondBody = secondCall[2] as Record<string, unknown>;
    const where = secondBody.where as { id: { in: number[] } };
    expect(where.id.in).toEqual([1]);

    expect(result.groups).toHaveLength(2);
    expect(result.nameById.get(1)).toBe("Passed");
  });

  it("R6: skips status findMany when all statusIds are null", async () => {
    mockZenstack.mockResolvedValueOnce([
      { statusId: null, _count: { id: 3 } },
    ]);

    const result = await extractStatusNames(99, ENV);

    expect(mockZenstack.mock.calls.length).toBe(1);
    expect(result.groups).toEqual([{ statusId: null, _count: { id: 3 } }]);
    expect(result.nameById.size).toBe(0);
  });
});

// ── isAutomatedRunType ─────────────────────────────────────────────────────

describe("isAutomatedRunType", () => {
  it("REGULAR is not automated; every JUnit-family type is", () => {
    expect(isAutomatedRunType("REGULAR")).toBe(false);
    for (const t of [
      "JUNIT",
      "TESTNG",
      "XUNIT",
      "NUNIT",
      "MSTEST",
      "MOCHA",
      "CUCUMBER",
    ]) {
      expect(isAutomatedRunType(t)).toBe(true);
    }
  });
});

// ── extractJunitStatusNames ────────────────────────────────────────────────

describe("extractJunitStatusNames", () => {
  it("groupBy on jUnitTestResult scoped via testSuite.testRunId, then status findMany", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        { statusId: 1, _count: { id: 87 } },
        { statusId: 2, _count: { id: 44 } },
        { statusId: 3, _count: { id: 6 } },
      ])
      .mockResolvedValueOnce([
        { id: 1, name: "Passed" },
        { id: 2, name: "Failed" },
        { id: 3, name: "Skipped" },
      ]);

    const result = await extractJunitStatusNames(92016, ENV);

    expect(mockZenstack.mock.calls.length).toBe(2);

    const firstCall = mockZenstack.mock.calls[0];
    expect(firstCall[0]).toBe("jUnitTestResult");
    expect(firstCall[1]).toBe("groupBy");
    const firstBody = firstCall[2] as Record<string, unknown>;
    expect(firstBody.by).toEqual(["statusId"]);
    expect(firstBody.where).toEqual({ testSuite: { testRunId: 92016 } });
    expect(firstBody._count).toEqual({ id: true });
    // JUnitTestResult has NO isDeleted — the where must never grow one.
    expect(firstBody.where).not.toHaveProperty("isDeleted");

    expect(mockZenstack.mock.calls[1][0]).toBe("status");

    // Attempt semantics: rollup totals the ROWS (87+44+6), not unique cases.
    const rollup = computeStatusRollup(result.groups, result.nameById);
    expect(rollup.total).toBe(137);
    expect(rollup.untested).toBe(0);
    expect(rollup.statusCounts).toEqual(
      expect.arrayContaining([
        { id: 1, name: "Passed", count: 87 },
        { id: 2, name: "Failed", count: 44 },
        { id: 3, name: "Skipped", count: 6 },
      ]),
    );
  });

  it("R6: skips status findMany when the run has no JUnit results", async () => {
    mockZenstack.mockResolvedValueOnce([]);

    const result = await extractJunitStatusNames(7, ENV);

    expect(mockZenstack.mock.calls.length).toBe(1);
    expect(result.groups).toEqual([]);
    expect(result.nameById.size).toBe(0);
  });
});

// ── extractJunitStatusGroupsByRun ──────────────────────────────────────────

describe("extractJunitStatusGroupsByRun", () => {
  it("empty runIds: no zenstack calls at all", async () => {
    const byRun = await extractJunitStatusGroupsByRun([], ENV);
    expect(byRun.size).toBe(0);
    expect(mockZenstack).not.toHaveBeenCalled();
  });

  it("no suites for the runs: skips the groupBy call", async () => {
    mockZenstack.mockResolvedValueOnce([]);
    const byRun = await extractJunitStatusGroupsByRun([10, 20], ENV);
    expect(byRun.size).toBe(0);
    expect(mockZenstack.mock.calls.length).toBe(1);
    const call = mockZenstack.mock.calls[0];
    expect(call[0]).toBe("jUnitTestSuite");
    expect(call[1]).toBe("findMany");
    const body = call[2] as Record<string, unknown>;
    expect(body.where).toEqual({ testRunId: { in: [10, 20] } });
    expect(body.select).toEqual({ id: true, testRunId: true });
  });

  it("folds (suite,status) groups down to (run,status) — counts sum across a run's suites", async () => {
    mockZenstack
      .mockResolvedValueOnce([
        { id: 100, testRunId: 10 },
        { id: 101, testRunId: 10 },
        { id: 200, testRunId: 20 },
      ])
      .mockResolvedValueOnce([
        { testSuiteId: 100, statusId: 1, _count: { id: 5 } },
        { testSuiteId: 101, statusId: 1, _count: { id: 3 } },
        { testSuiteId: 101, statusId: 2, _count: { id: 2 } },
        { testSuiteId: 200, statusId: null, _count: { id: 4 } },
      ]);

    const byRun = await extractJunitStatusGroupsByRun([10, 20], ENV);

    const groupByCall = mockZenstack.mock.calls[1];
    expect(groupByCall[0]).toBe("jUnitTestResult");
    expect(groupByCall[1]).toBe("groupBy");
    const body = groupByCall[2] as Record<string, unknown>;
    expect(body.by).toEqual(["testSuiteId", "statusId"]);
    expect(body.where).toEqual({ testSuiteId: { in: [100, 101, 200] } });

    expect(byRun.get(10)).toEqual(
      expect.arrayContaining([
        { statusId: 1, _count: { id: 8 } },
        { statusId: 2, _count: { id: 2 } },
      ]),
    );
    expect(byRun.get(10)!.length).toBe(2);
    // Null statusId survives the fold (flows into `untested` downstream).
    expect(byRun.get(20)).toEqual([{ statusId: null, _count: { id: 4 } }]);
  });

  it("tolerates a group for an unknown suite id (dropped, not crashed)", async () => {
    mockZenstack
      .mockResolvedValueOnce([{ id: 100, testRunId: 10 }])
      .mockResolvedValueOnce([
        { testSuiteId: 100, statusId: 1, _count: { id: 5 } },
        { testSuiteId: 999, statusId: 1, _count: { id: 3 } },
      ]);

    const byRun = await extractJunitStatusGroupsByRun([10], ENV);
    expect(byRun.get(10)).toEqual([{ statusId: 1, _count: { id: 5 } }]);
    expect(byRun.size).toBe(1);
  });
});

// ── mapRunRow ──────────────────────────────────────────────────────────────

describe("mapRunRow", () => {
  const baseRaw = {
    id: 1,
    name: "Run A",
    isCompleted: false,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    testRunType: "REGULAR",
    project: { id: 7, name: "TestProject" },
    state: { id: 3, name: "Active" },
    // Schema relation is `createdBy` (TestRuns.createdBy), NOT `creator`.
    // RepositoryCases uses `creator`, but TestRuns / Sessions use `createdBy`.
    createdBy: {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    },
    configuration: { id: 11, name: "ChromeProd" },
    milestone: { id: 22, name: "v1.0" },
    tags: [{ id: 5, name: "smoke" }],
    issues: [
      {
        id: 1,
        externalKey: "JIRA-1",
        title: "Bug",
        externalStatus: "Open",
        integration: { provider: "JIRA" },
      },
    ],
  };

  it("D7-06: enumerates exactly the documented keys (no extra fields, T-07-03 mitigation)", () => {
    const result = mapRunRow(baseRaw);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      [
        "id",
        "name",
        "isCompleted",
        "completedAt",
        "createdAt",
        "project",
        "state",
        "createdBy",
        "configuration",
        "milestone",
        "tags",
        "testRunType",
        "issues",
      ].sort(),
    );
  });

  it("null configuration / milestone / completedAt → returns null (never undefined)", () => {
    const result = mapRunRow({
      ...baseRaw,
      completedAt: null,
      configuration: null,
      milestone: null,
    });
    expect(result.completedAt).toBeNull();
    expect(result.configuration).toBeNull();
    expect(result.milestone).toBeNull();
  });

  it("issues mapped with externalSystem from integration.provider", () => {
    const result = mapRunRow(baseRaw);
    expect(result.issues).toEqual([
      {
        id: 1,
        externalKey: "JIRA-1",
        title: "Bug",
        externalStatus: "Open",
        externalSystem: "JIRA",
      },
    ]);
  });
});

// ── mapRunDetailTestCase ───────────────────────────────────────────────────

describe("mapRunDetailTestCase", () => {
  const baseRaw = {
    id: 100,
    order: 0,
    isCompleted: false,
    repositoryCase: { id: 50, name: "Login flow", source: "MANUAL" },
    assignedTo: null,
    status: null,
    results: [],
  };

  it("latestResult is null when results array empty", () => {
    const result = mapRunDetailTestCase(baseRaw);
    expect(result.latestResult).toBeNull();
  });

  it("latestResult mapped from results[0] with executedBy + status + executedAt — list-level shape (no attempt/notes/evidence)", () => {
    const result = mapRunDetailTestCase({
      ...baseRaw,
      results: [
        {
          id: 99,
          statusId: 1,
          status: { id: 1, name: "Passed" },
          executedBy: {
            id: "u1",
            name: "Alice",
            email: "a@b",
          },
          executedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(result.latestResult).toEqual({
      id: 99,
      source: "TestRun",
      status: { id: 1, name: "Passed" },
      executedBy: {
        id: "u1",
        name: "Alice",
        email: "a@b",
      },
      executedAt: "2026-01-01T00:00:00Z",
    });
    const lr = result.latestResult as Record<string, unknown>;
    expect(lr).not.toHaveProperty("attempt");
    expect(lr).not.toHaveProperty("notes");
    expect(lr).not.toHaveProperty("evidence");
  });
});

// ── mapStepResult ──────────────────────────────────────────────────────────

describe("mapStepResult", () => {
  const proseDoc = (text: string) => ({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  });

  it("R2 / Pitfall 2: reads from raw.stepStatus, NOT raw.status", () => {
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: { id: 5, name: "Failed" },
      notes: null,
      evidence: null,
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: null,
      attachments: [],
      issues: [],
    };
    const result = mapStepResult(raw);
    // Output uses `status` for agent friendliness; input source is raw.stepStatus
    expect(result.status).toEqual({ id: 5, name: "Failed" });
  });

  it("R2: a raw row with raw.status set but raw.stepStatus undefined → output status is null", () => {
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: null,
      // intentionally inject a `status` key the mapper must ignore
      status: { id: 5, name: "Failed" },
      notes: null,
      evidence: null,
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: null,
      attachments: [],
      issues: [],
    } as never;
    const result = mapStepResult(raw);
    expect(result.status).toBeNull();
  });

  it("extracts stepText / expectedResultText / notes via extractProseMirrorText", () => {
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: { id: 5, name: "Failed" },
      notes: proseDoc("My notes"),
      evidence: { url: "x" },
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: {
        id: 99,
        order: 0,
        step: proseDoc("Open page"),
        expectedResult: proseDoc("Page renders"),
      },
      attachments: [],
      issues: [],
    };
    const result = mapStepResult(raw);
    expect(result.stepText).toBe("Open page");
    expect(result.expectedResultText).toBe("Page renders");
    expect(result.notes).toBe("My notes");
  });

  it("D7-08: evidence Json passes through as-is (no truncation)", () => {
    const evidence = { url: "x", note: "y", screenshots: ["a", "b"] };
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: { id: 5, name: "Failed" },
      notes: null,
      evidence,
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: null,
      attachments: [],
      issues: [],
    };
    const result = mapStepResult(raw);
    expect(result.evidence).toEqual(evidence);
  });

  it("attachments mapped with name → fileName rename", () => {
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: { id: 5, name: "Failed" },
      notes: null,
      evidence: null,
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: null,
      attachments: [{ id: 1, name: "screen.png", url: "https://example/x" }],
      issues: [],
    };
    const result = mapStepResult(raw);
    expect(result.attachments).toEqual([
      { id: 1, fileName: "screen.png", url: "https://example/x" },
    ]);
  });

  it("issues mapped with externalSystem from integration.provider", () => {
    const raw = {
      id: 1,
      statusId: 5,
      stepStatus: { id: 5, name: "Failed" },
      notes: null,
      evidence: null,
      executedAt: "2026-01-01T00:00:00Z",
      elapsed: null,
      step: null,
      attachments: [],
      issues: [
        {
          id: 7,
          externalKey: "GH-7",
          title: "Issue",
          externalStatus: "open",
          integration: { provider: "GITHUB" },
        },
      ],
    };
    const result = mapStepResult(raw);
    expect(result.issues).toEqual([
      {
        id: 7,
        externalKey: "GH-7",
        title: "Issue",
        externalStatus: "open",
        externalSystem: "GITHUB",
      },
    ]);
  });
});

// ── mapRunResultRow ────────────────────────────────────────────────────────

describe("mapRunResultRow", () => {
  it("list-shape: includes status + executedBy + testRunCase summary, NOT stepResults", () => {
    const raw = {
      id: 1,
      statusId: 1,
      status: { id: 1, name: "Passed" },
      executedBy: {
        id: "u1",
        name: "Alice",
        email: "a@b",
      },
      executedAt: "2026-01-01T00:00:00Z",
      attempt: 1,
      testRunCase: {
        id: 50,
        repositoryCaseId: 100,
        repositoryCase: { id: 100, name: "Case", source: "MANUAL" },
        testRun: { id: 7, name: "Run A" },
      },
    };
    const result = mapRunResultRow(raw);
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "source",
        "attempt",
        "executedAt",
        "status",
        "executedBy",
        "repositoryCase",
        "testRun",
        "testRunCase",
      ].sort(),
    );
    expect(result.source).toBe("TestRun");
    // Normalized top-level case/run identity mirrors the testRunCase nesting.
    expect(result.repositoryCase).toEqual({
      id: 100,
      name: "Case",
      source: "MANUAL",
    });
    expect(result.testRun).toEqual({ id: 7, name: "Run A" });
  });
});

// ── mapRunResultDetail ─────────────────────────────────────────────────────

describe("mapRunResultDetail", () => {
  it("full shape: stepResults inlined, customFields denormalized (Dropdown resolved), evidence as-is, notes via extractProseMirrorText", () => {
    const raw = {
      id: 1,
      statusId: 1,
      status: { id: 1, name: "Passed" },
      executedBy: {
        id: "u1",
        name: "Alice",
        email: "a@b",
      },
      editedBy: null,
      editedAt: null,
      executedAt: "2026-01-01T00:00:00Z",
      attempt: 1,
      elapsed: 42,
      notes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Some note" }],
          },
        ],
      },
      evidence: { custom: "blob", screenshots: 3 },
      testRunCase: {
        id: 50,
        repositoryCaseId: 100,
        repositoryCase: { id: 100, name: "Case", source: "MANUAL" },
        testRun: { id: 7, name: "Run A" },
      },
      attachments: [
        { id: 1, name: "screen.png", url: "https://x" },
      ],
      issues: [],
      resultFieldValues: [
        {
          value: 7,
          field: {
            displayName: "Severity",
            type: { type: "Dropdown" },
            fieldOptions: [
              { fieldOption: { id: 7, name: "High" } },
              { fieldOption: { id: 8, name: "Low" } },
            ],
          },
        },
      ],
      stepResults: [
        {
          id: 11,
          statusId: 1,
          stepStatus: { id: 1, name: "Passed" },
          notes: null,
          evidence: null,
          executedAt: "2026-01-01T00:00:00Z",
          elapsed: null,
          step: null,
          attachments: [],
          issues: [],
        },
      ],
    };
    const result = mapRunResultDetail(raw);
    expect(result.stepResults).toHaveLength(1);
    expect(result.customFields).toEqual({ Severity: "High" });
    expect(result.evidence).toEqual({ custom: "blob", screenshots: 3 });
    expect(result.notes).toBe("Some note");
    expect(result.attachments).toEqual([
      { id: 1, fileName: "screen.png", url: "https://x" },
    ]);
  });
});

// ── JUnit mappers (automated-run results union) ─────────────────────────────

describe("mapJunitResultRow", () => {
  const rawJunit = {
    id: 7,
    type: "FAILURE",
    message: "expected true to be false",
    time: 1.25,
    executedAt: "2026-03-01T00:00:00Z",
    status: { id: 2, name: "Failed" },
    createdBy: { id: "u9", name: "CI Bot", email: "ci@b" },
    repositoryCase: { id: 300, name: "login spec", source: "JUNIT" },
    testSuite: {
      id: 40,
      name: "auth.spec.ts",
      testRunId: 60,
      testRun: { id: 60, name: "Nightly" },
    },
  };

  it("row shape: source JUnit, executedBy from createdBy (importer), suite + top-level repositoryCase/testRun, testRunCase null", () => {
    const result = mapJunitResultRow(rawJunit);
    expect(result).toEqual({
      id: 7,
      source: "JUnit",
      junitType: "FAILURE",
      message: "expected true to be false",
      time: 1.25,
      executedAt: "2026-03-01T00:00:00Z",
      status: { id: 2, name: "Failed" },
      executedBy: { id: "u9", name: "CI Bot", email: "ci@b" },
      repositoryCase: { id: 300, name: "login spec", source: "JUNIT" },
      testRun: { id: 60, name: "Nightly" },
      suite: { id: 40, name: "auth.spec.ts" },
      testRunCase: null,
    });
  });

  it("nullable relations: status/createdBy/repositoryCase/testSuite null-safe", () => {
    const result = mapJunitResultRow({
      ...rawJunit,
      status: null,
      createdBy: null,
      repositoryCase: null,
      testSuite: null,
    });
    expect(result.status).toBeNull();
    expect(result.executedBy).toBeNull();
    expect(result.repositoryCase).toBeNull();
    expect(result.testRun).toBeNull();
    expect(result.suite).toBeNull();
  });

  it("detail: adds content/systemOut/systemErr/assertions/file/line/createdAt + mapped attachments", () => {
    const result = mapJunitResultDetail({
      ...rawJunit,
      content: "stack trace here",
      systemOut: "stdout",
      systemErr: "stderr",
      assertions: 3,
      file: "auth.spec.ts",
      line: 42,
      createdAt: "2026-03-01T00:00:05Z",
      attachments: [{ id: 1, name: "trace.zip", url: "https://x" }],
    });
    expect(result.source).toBe("JUnit");
    expect(result.content).toBe("stack trace here");
    expect(result.systemOut).toBe("stdout");
    expect(result.systemErr).toBe("stderr");
    expect(result.assertions).toBe(3);
    expect(result.file).toBe("auth.spec.ts");
    expect(result.line).toBe(42);
    expect(result.attachments).toEqual([
      { id: 1, fileName: "trace.zip", url: "https://x" },
    ]);
  });
});

// ── mapRunDetailTestCase — latestResult union (manual vs JUnit) ─────────────

describe("mapRunDetailTestCase latestResult union", () => {
  const base = {
    id: 1,
    order: 1,
    isCompleted: true,
    assignedTo: null,
    status: { id: 2, name: "Failed" },
  };
  const manualResult = {
    id: 99,
    statusId: 1,
    status: { id: 1, name: "Passed" },
    executedBy: { id: "u1", name: "Alice", email: "a@b" },
    executedAt: "2026-01-02T00:00:00Z",
  };
  const junitResult = {
    id: 7,
    executedAt: "2026-01-03T00:00:00Z",
    status: { id: 2, name: "Failed" },
    createdBy: { id: "u9", name: "CI Bot", email: "ci@b" },
  };

  it("automated run (no manual results): junit result surfaces with source JUnit", () => {
    const result = mapRunDetailTestCase({
      ...base,
      repositoryCase: {
        id: 50,
        name: "spec",
        source: "JUNIT",
        junitResults: [junitResult],
      },
      results: [],
    });
    expect(result.latestResult).toEqual({
      id: 7,
      source: "JUnit",
      status: { id: 2, name: "Failed" },
      executedBy: { id: "u9", name: "CI Bot", email: "ci@b" },
      executedAt: "2026-01-03T00:00:00Z",
    });
  });

  it("union: junit newer than manual -> junit wins", () => {
    const result = mapRunDetailTestCase({
      ...base,
      repositoryCase: {
        id: 50,
        name: "spec",
        source: "JUNIT",
        junitResults: [junitResult],
      },
      results: [manualResult],
    });
    expect(result.latestResult?.source).toBe("JUnit");
    expect(result.latestResult?.id).toBe(7);
  });

  it("union: manual newer than junit -> manual wins with source TestRun", () => {
    const result = mapRunDetailTestCase({
      ...base,
      repositoryCase: {
        id: 50,
        name: "spec",
        source: "JUNIT",
        junitResults: [{ ...junitResult, executedAt: "2026-01-01T00:00:00Z" }],
      },
      results: [manualResult],
    });
    expect(result.latestResult?.source).toBe("TestRun");
    expect(result.latestResult?.id).toBe(99);
  });

  it("union: junit with null executedAt loses to any manual result", () => {
    const result = mapRunDetailTestCase({
      ...base,
      repositoryCase: {
        id: 50,
        name: "spec",
        source: "JUNIT",
        junitResults: [{ ...junitResult, executedAt: null }],
      },
      results: [manualResult],
    });
    expect(result.latestResult?.source).toBe("TestRun");
  });

  it("rows fetched without the junit include (undefined junitResults) fall back to manual half", () => {
    const result = mapRunDetailTestCase({
      ...base,
      repositoryCase: { id: 50, name: "spec", source: "MANUAL" },
      results: [manualResult],
    });
    expect(result.latestResult?.source).toBe("TestRun");
    expect(result.latestResult?.id).toBe(99);
  });
});

// ── Results cursor + merge (two-source union pagination) ────────────────────

describe("parseResultsCursor / formatResultsCursor", () => {
  it("undefined -> empty cursor (page 1)", () => {
    expect(parseResultsCursor(undefined)).toEqual({});
  });

  it("legacy bare number -> TestRunResults position", () => {
    expect(parseResultsCursor(100)).toEqual({ tr: 100 });
  });

  it("compound string round-trips", () => {
    expect(parseResultsCursor("tr:100|ju:50")).toEqual({ tr: 100, ju: 50 });
    expect(parseResultsCursor("ju:50")).toEqual({ ju: 50 });
    expect(formatResultsCursor({ tr: 100, ju: 50 })).toBe("tr:100|ju:50");
    expect(formatResultsCursor({ ju: 50 })).toBe("ju:50");
    expect(formatResultsCursor({})).toBeNull();
  });

  it("malformed strings -> null (rejected, not silently page 1)", () => {
    expect(parseResultsCursor("garbage")).toBeNull();
    expect(parseResultsCursor("tr:0")).toBeNull();
    expect(parseResultsCursor("tr:-5")).toBeNull();
    expect(parseResultsCursor("tr:1|xx:2")).toBeNull();
  });
});

describe("mergeResultsPage", () => {
  const tr = (id: number, executedAt: string | null) => ({
    source: "TestRun" as const,
    id,
    executedAt,
  });
  const ju = (id: number, executedAt: string | null) => ({
    source: "JUnit" as const,
    id,
    executedAt,
  });

  it("interleaves the two sources by executedAt desc", () => {
    const page = mergeResultsPage(
      [tr(1, "2026-01-04T00:00:00Z"), tr(2, "2026-01-02T00:00:00Z")],
      [ju(9, "2026-01-03T00:00:00Z"), ju(8, "2026-01-01T00:00:00Z")],
      10,
      {},
    );
    expect(page.items.map((i) => `${i.source}:${i.id}`)).toEqual([
      "TestRun:1",
      "JUnit:9",
      "TestRun:2",
      "JUnit:8",
    ]);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("null executedAt sorts first (matches Postgres DESC NULLS FIRST)", () => {
    const page = mergeResultsPage(
      [tr(1, "2026-01-04T00:00:00Z")],
      [ju(9, null)],
      10,
      {},
    );
    expect(page.items.map((i) => `${i.source}:${i.id}`)).toEqual([
      "JUnit:9",
      "TestRun:1",
    ]);
  });

  it("equal executedAt: TestRun ranked before JUnit (deterministic cross-source tiebreak)", () => {
    const t = "2026-01-04T00:00:00Z";
    const page = mergeResultsPage([tr(1, t)], [ju(9, t)], 10, {});
    expect(page.items.map((i) => i.source)).toEqual(["TestRun", "JUnit"]);
  });

  it("hasNextPage when combined fetch exceeds limit; nextCursor tracks last CONSUMED id per source", () => {
    const page = mergeResultsPage(
      [tr(5, "2026-01-05T00:00:00Z"), tr(4, "2026-01-01T00:00:00Z")],
      [ju(9, "2026-01-04T00:00:00Z"), ju(8, "2026-01-03T00:00:00Z")],
      2,
      {},
    );
    expect(page.items.map((i) => `${i.source}:${i.id}`)).toEqual([
      "TestRun:5",
      "JUnit:9",
    ]);
    expect(page.hasNextPage).toBe(true);
    // tr:4 and ju:8 were fetched but NOT consumed — cursor must NOT advance
    // past them (they get re-fetched next page).
    expect(page.nextCursor).toBe("tr:5|ju:9");
  });

  it("source with no consumed row carries its incoming position forward", () => {
    // Page 2 of a merged feed: incoming ju position 9; this page consumes
    // only TestRun rows (all newer), so ju:9 must persist in nextCursor.
    const page = mergeResultsPage(
      [tr(5, "2026-01-05T00:00:00Z"), tr(4, "2026-01-04T00:00:00Z"), tr(3, "2026-01-03T00:00:00Z")],
      [ju(8, "2026-01-01T00:00:00Z")],
      2,
      { ju: 9 },
    );
    expect(page.items.map((i) => `${i.source}:${i.id}`)).toEqual([
      "TestRun:5",
      "TestRun:4",
    ]);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBe("tr:4|ju:9");
  });

  it("single-source page (automated run: no TestRun rows) paginates on ju only", () => {
    const page = mergeResultsPage(
      [],
      [ju(9, "2026-01-03T00:00:00Z"), ju(8, "2026-01-02T00:00:00Z"), ju(7, "2026-01-01T00:00:00Z")],
      2,
      {},
    );
    expect(page.items.map((i) => i.id)).toEqual([9, 8]);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBe("ju:8");
  });
});
