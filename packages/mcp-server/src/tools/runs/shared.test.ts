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
  mapStepResult,
  computeStatusRollup,
  extractStatusNames,
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
      ["id", "attempt", "executedAt", "status", "executedBy", "testRunCase"].sort(),
    );
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
