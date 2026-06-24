import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: { findUnique: vi.fn() },
    repositoryCases: { findMany: vi.fn() },
    testRunCases: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

import { prisma } from "~/lib/prisma";
import {
  buildAutomationCandidatesContext,
  resolveFieldValue,
  serializeContextForPrompt,
  type AutomationCandidatesContext,
} from "./automationCandidatesContext";

const projectFindUnique = prisma.projects.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const casesFindMany = prisma.repositoryCases.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const trcGroupBy = prisma.testRunCases.groupBy as unknown as ReturnType<
  typeof vi.fn
>;

type FieldOption = { id: number; name: string };
type FieldType = { type: string };

function caseRow(
  overrides: Partial<{
    id: number;
    name: string;
    className: string | null;
    createdAt: Date;
    executionCount: number;
    estimate: number | null;
    forecastManual: number | null;
    steps: Array<{ id: number }>;
    caseFieldValues: Array<{
      value: unknown;
      field: {
        displayName: string;
        systemName: string;
        isDeleted: boolean;
        isEnabled: boolean;
        type: FieldType | null;
        fieldOptions: Array<{ fieldOption: FieldOption }>;
      };
    }>;
    caseIssues: Array<{ issue: Record<string, unknown> }>;
  }> = {}
) {
  const { executionCount, estimate, forecastManual, ...rest } = overrides;
  return {
    id: 1,
    name: "Case",
    className: null,
    source: "MANUAL",
    automated: false,
    hasParameters: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    estimate: estimate ?? null,
    forecastManual: forecastManual ?? null,
    steps: [],
    caseFieldValues: [],
    caseIssues: [],
    _count: { testRuns: executionCount ?? 0 },
    ...rest,
  };
}

/** Helper to build a field stub when we don't care about option resolution. */
function plainField(
  displayName: string,
  systemName: string,
  overrides: Partial<{
    isDeleted: boolean;
    isEnabled: boolean;
    type: FieldType | null;
    fieldOptions: Array<{ fieldOption: FieldOption }>;
  }> = {}
) {
  return {
    displayName,
    systemName,
    isDeleted: false,
    isEnabled: true,
    type: { type: "Text String" },
    fieldOptions: [],
    ...overrides,
  };
}

describe("buildAutomationCandidatesContext", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    casesFindMany.mockReset();
    trcGroupBy.mockReset();
    trcGroupBy.mockResolvedValue([]);
    projectFindUnique.mockResolvedValue({ id: 7, name: "Demo Project" });
  });

  it("throws when the project does not exist", async () => {
    projectFindUnique.mockResolvedValue(null);
    await expect(
      buildAutomationCandidatesContext(999, { maxCases: 25 })
    ).rejects.toThrow(/project 999 not found/);
  });

  it("queries only manual, non-archived, non-deleted cases whose workflow state is IN_PROGRESS or DONE", async () => {
    casesFindMany.mockResolvedValue([]);
    await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(casesFindMany).toHaveBeenCalledTimes(1);
    const args = casesFindMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      projectId: 7,
      automated: false,
      isDeleted: false,
      isArchived: false,
      // NOT_STARTED is excluded — automating a draft spec is wasted effort.
      state: { workflowType: { in: ["IN_PROGRESS", "DONE"] } },
    });
  });

  it("returns an empty context for a project with no manual cases", async () => {
    casesFindMany.mockResolvedValue([]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx).toEqual({
      projectId: 7,
      projectName: "Demo Project",
      cases: [],
      totalManualCases: 0,
      truncated: false,
      selectionStrategy: "most_executed",
    });
  });

  it("counts steps and projects the case identity (including executionCount) into the materialized row", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        id: 42,
        name: "Login flow",
        className: "auth",
        executionCount: 17,
        steps: [{ id: 1 }, { id: 2 }, { id: 3 }],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases).toEqual([
      {
        id: 42,
        name: "Login flow",
        className: "auth",
        stepCount: 3,
        executionCount: 17,
        estimateSeconds: null,
        flakinessScore: null,
        createdAtIso: "2026-01-01T00:00:00.000Z",
        customFields: {},
        linkedIssues: [],
      },
    ]);
  });

  it("flakiest_first picks the cases whose pass/fail outcomes flip the most", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1 }),
      caseRow({ id: 2 }),
      caseRow({ id: 3 }),
    ]);
    trcGroupBy.mockResolvedValue([
      // Case 1: 50 pass, 50 fail → flakiness 1.0
      {
        repositoryCaseId: 1,
        _sum: { passedIterations: 50, failedIterations: 50 },
      },
      // Case 2: 100 pass, 0 fail → flakiness 0.0
      {
        repositoryCaseId: 2,
        _sum: { passedIterations: 100, failedIterations: 0 },
      },
      // Case 3: 30 pass, 10 fail → flakiness 0.333
      {
        repositoryCaseId: 3,
        _sum: { passedIterations: 30, failedIterations: 10 },
      },
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "flakiest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([1, 3]);
    expect(ctx.selectionStrategy).toBe("flakiest_first");
  });

  it("longest_first picks the cases with the highest manual estimate", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, estimate: 120 }),
      caseRow({ id: 2, estimate: 3600 }),
      caseRow({ id: 3, estimate: null }),
      caseRow({ id: 4, estimate: 600 }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "longest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([2, 4]);
    expect(ctx.selectionStrategy).toBe("longest_first");
  });

  it("estimateSeconds prefers forecastManual (tester-derived) over the original estimate", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, estimate: 60, forecastManual: 900 }),
      caseRow({ id: 2, estimate: 600, forecastManual: null }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    const c1 = ctx.cases.find((c) => c.id === 1)!;
    const c2 = ctx.cases.find((c) => c.id === 2)!;
    expect(c1.estimateSeconds).toBe(900); // forecast overrides the 60s estimate
    expect(c2.estimateSeconds).toBe(600); // falls back to estimate when no forecast
  });

  it("longest_first ranks by forecastManual when present, else estimate, else null", async () => {
    casesFindMany.mockResolvedValue([
      // forecast 100, beats anything-else here
      caseRow({ id: 1, forecastManual: 100, estimate: 0 }),
      // no forecast, estimate 50
      caseRow({ id: 2, forecastManual: null, estimate: 50 }),
      // no forecast or estimate — sorts last
      caseRow({ id: 3, forecastManual: null, estimate: null }),
      // forecast 25 (lower than #1's 100 but > #2's 50)
      caseRow({ id: 4, forecastManual: 25, estimate: 999 }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 4,
      strategy: "longest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([1, 2, 4, 3]);
  });

  it("longest_first sorts cases with null estimates after cases with any estimate", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, estimate: null }),
      caseRow({ id: 2, estimate: 1 }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "longest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([2, 1]);
  });

  it("flakinessScore is null for cases with no executions and 0 for cases with one-sided outcomes", async () => {
    casesFindMany.mockResolvedValue([caseRow({ id: 1 }), caseRow({ id: 2 })]);
    trcGroupBy.mockResolvedValue([
      // Case 1: only passes — one-sided
      {
        repositoryCaseId: 1,
        _sum: { passedIterations: 10, failedIterations: 0 },
      },
      // Case 2: no aggregate row → score stays null
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    const c1 = ctx.cases.find((c) => c.id === 1)!;
    const c2 = ctx.cases.find((c) => c.id === 2)!;
    expect(c1.flakinessScore).toBe(0);
    expect(c2.flakinessScore).toBe(null);
  });

  it("keys custom fields by displayName so the LLM sees field names not ids", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [
          { value: "High", field: plainField("Priority", "priority") },
          {
            value: { ops: [{ insert: "Important auth flow" }] },
            field: plainField("Description", "description"),
          },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({
      Priority: "High",
      Description: { ops: [{ insert: "Important auth flow" }] },
    });
  });

  it("resolves Dropdown FieldOption ids to their option names (Priority: 146 → 'Medium')", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [
          {
            value: 146,
            field: plainField("Priority", "priority", {
              type: { type: "Dropdown" },
              fieldOptions: [
                { fieldOption: { id: 146, name: "Medium" } },
                { fieldOption: { id: 147, name: "High" } },
              ],
            }),
          },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({ Priority: "Medium" });
  });

  it("resolves Multi-Select FieldOption id arrays to arrays of names", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [
          {
            value: [10, 12],
            field: plainField("Tags", "tags", {
              type: { type: "Multi-Select" },
              fieldOptions: [
                { fieldOption: { id: 10, name: "regression" } },
                { fieldOption: { id: 11, name: "smoke" } },
                { fieldOption: { id: 12, name: "auth" } },
              ],
            }),
          },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({
      Tags: ["regression", "auth"],
    });
  });

  it("skips disabled and deleted fields (admin-stripped values are noise)", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [
          { value: "live", field: plainField("Active", "active") },
          {
            value: "stale",
            field: plainField("OldField", "old_field", { isDeleted: true }),
          },
          {
            value: "disabled",
            field: plainField("Disabled", "disabled", { isEnabled: false }),
          },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({ Active: "live" });
  });

  it("skips null custom field values", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [
          { value: null, field: plainField("Priority", "priority") },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({});
  });

  it("falls back to systemName when displayName is empty", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseFieldValues: [{ value: "x", field: plainField("", "fallback") }],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.customFields).toEqual({ fallback: "x" });
  });

  it("passes linked-issue metadata through provider-agnostically (no Jira special-casing)", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({
        caseIssues: [
          {
            issue: {
              externalKey: "PROJ-123",
              title: "Login intermittently fails",
              description: "Repro: ...",
              status: "Open",
              externalStatus: "In Progress",
              priority: "Critical",
              issueTypeName: "Bug",
              externalData: {
                labels: ["auth", "regression"],
                components: ["login"],
              },
            },
          },
        ],
      }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases[0]!.linkedIssues).toEqual([
      {
        externalKey: "PROJ-123",
        title: "Login intermittently fails",
        description: "Repro: ...",
        status: "Open",
        externalStatus: "In Progress",
        priority: "Critical",
        issueType: "Bug",
        externalData: { labels: ["auth", "regression"], components: ["login"] },
      },
    ]);
  });

  it("most_executed (default) picks the highest-execution cases first", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, executionCount: 2 }),
      caseRow({ id: 2, executionCount: 50 }),
      caseRow({ id: 3, executionCount: 10 }),
      caseRow({ id: 4, executionCount: 0 }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 2 });
    expect(ctx.cases.map((c) => c.id)).toEqual([2, 3]);
    expect(ctx.totalManualCases).toBe(4);
    expect(ctx.truncated).toBe(true);
    expect(ctx.selectionStrategy).toBe("most_executed");
  });

  it("oldest_first picks the earliest-created cases", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, createdAt: new Date("2024-01-01") }),
      caseRow({ id: 2, createdAt: new Date("2023-01-01") }),
      caseRow({ id: 3, createdAt: new Date("2026-01-01") }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "oldest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([2, 1]);
    expect(ctx.selectionStrategy).toBe("oldest_first");
  });

  it("newest_first picks the most-recently-created cases", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1, createdAt: new Date("2024-01-01") }),
      caseRow({ id: 2, createdAt: new Date("2023-01-01") }),
      caseRow({ id: 3, createdAt: new Date("2026-01-01") }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "newest_first",
    });
    expect(ctx.cases.map((c) => c.id)).toEqual([3, 1]);
    expect(ctx.selectionStrategy).toBe("newest_first");
  });

  it("random returns N cases drawn from the full set", async () => {
    casesFindMany.mockResolvedValue([
      caseRow({ id: 1 }),
      caseRow({ id: 2 }),
      caseRow({ id: 3 }),
      caseRow({ id: 4 }),
    ]);
    const ctx = await buildAutomationCandidatesContext(7, {
      maxCases: 2,
      strategy: "random",
    });
    expect(ctx.cases).toHaveLength(2);
    // Every returned id must be from the input set (no hallucination).
    const validIds = new Set([1, 2, 3, 4]);
    for (const c of ctx.cases) {
      expect(validIds.has(c.id)).toBe(true);
    }
    expect(ctx.selectionStrategy).toBe("random");
  });

  it("truncated=false and rankedCount=totalManualCases when N >= total", async () => {
    casesFindMany.mockResolvedValue([caseRow({ id: 1 }), caseRow({ id: 2 })]);
    const ctx = await buildAutomationCandidatesContext(7, { maxCases: 25 });
    expect(ctx.cases).toHaveLength(2);
    expect(ctx.truncated).toBe(false);
    expect(ctx.totalManualCases).toBe(2);
  });
});

describe("resolveFieldValue (direct)", () => {
  it("passes through Text String values unchanged", () => {
    expect(
      resolveFieldValue("free-form text", {
        type: { type: "Text String" },
        fieldOptions: [],
      })
    ).toBe("free-form text");
  });

  it("resolves numeric Dropdown values to option names", () => {
    expect(
      resolveFieldValue(42, {
        type: { type: "Dropdown" },
        fieldOptions: [
          { fieldOption: { id: 41, name: "Low" } },
          { fieldOption: { id: 42, name: "High" } },
        ],
      })
    ).toBe("High");
  });

  it("falls back to the raw value when the option id is unknown (stale value)", () => {
    expect(
      resolveFieldValue(99, {
        type: { type: "Dropdown" },
        fieldOptions: [{ fieldOption: { id: 1, name: "Only" } }],
      })
    ).toBe(99);
  });

  it("coerces numeric-string ids before lookup", () => {
    expect(
      resolveFieldValue("42", {
        type: { type: "Dropdown" },
        fieldOptions: [{ fieldOption: { id: 42, name: "High" } }],
      })
    ).toBe("High");
  });
});

describe("serializeContextForPrompt", () => {
  function ctx(
    cases: Array<{
      id: number;
      name: string;
      className: string | null;
      stepCount: number;
      executionCount: number;
      estimateSeconds: number | null;
      flakinessScore: number | null;
      customFields: Record<string, unknown>;
      linkedIssues: Array<Record<string, unknown>>;
    }>
  ): AutomationCandidatesContext {
    return {
      projectId: 7,
      projectName: "Demo",
      cases: cases as unknown as AutomationCandidatesContext["cases"],
      totalManualCases: cases.length,
      truncated: false,
      selectionStrategy: "most_executed",
    };
  }

  it("emits one JSON object per case, joined by newlines (NDJSON)", () => {
    const ndjson = serializeContextForPrompt(
      ctx([
        {
          id: 1,
          name: "A",
          className: null,
          stepCount: 1,
          executionCount: 0,
          estimateSeconds: null,
          flakinessScore: null,
          customFields: {},
          linkedIssues: [],
        },
        {
          id: 2,
          name: "B",
          className: null,
          stepCount: 2,
          executionCount: 5,
          estimateSeconds: 120,
          flakinessScore: 0.4,
          customFields: {},
          linkedIssues: [],
        },
      ])
    );
    const lines = ndjson.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe(1);
    expect(JSON.parse(lines[1]!).id).toBe(2);
  });

  it("returns an empty string for an empty case list (caller skips the LLM call)", () => {
    expect(serializeContextForPrompt(ctx([]))).toBe("");
  });
});
