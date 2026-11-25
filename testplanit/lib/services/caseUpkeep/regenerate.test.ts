import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: null as any,
  loadTemplate: vi.fn(),
  review: vi.fn(),
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.tx),
}));
vi.mock("~/lib/services/jira-panel-generation", () => ({
  loadTemplateData: mocks.loadTemplate,
}));
vi.mock("./review", () => ({ reviewCasesAgainstIssue: mocks.review }));

import { regenerateSuggestion } from "./regenerate";

const CHANGED = new Date("2026-11-24T10:00:00Z");
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const proposed = {
  name: "Totals include tax",
  fieldValues: {},
  steps: [{ step: "Open the cart", expectedResult: "Total with tax" }],
};

function makeDb(
  opts: {
    suggestion?: Record<string, unknown> | null;
    row?: Record<string, unknown> | null;
    issue?: Record<string, unknown> | null;
  } = {}
) {
  return {
    caseChangeSuggestion: {
      findFirst: vi.fn().mockResolvedValue(
        opts.suggestion === undefined
          ? {
              status: "PENDING",
              projectId: 7,
              issueId: 100,
              webhookActionId: "rule-1",
            }
          : opts.suggestion
      ),
    },
    repositoryCases: {
      findFirst: vi.fn().mockResolvedValue(
        opts.row === undefined
          ? {
              id: 12,
              name: "Totals add up",
              templateId: 4,
              currentVersion: 5,
              caseFieldValues: [],
              steps: [
                {
                  step: doc("Open the cart"),
                  expectedResult: doc("Total"),
                  sharedStepGroupId: null,
                },
              ],
            }
          : opts.row
      ),
    },
    issue: {
      findFirst: vi.fn().mockResolvedValue(
        opts.issue === undefined
          ? {
              name: "DEMO-42",
              externalKey: "DEMO-42",
              title: "Checkout totals",
              description: "Add tax",
              contentUpdatedAt: CHANGED,
            }
          : opts.issue
      ),
    },
  };
}

function makeTx(
  opts: {
    status?: string | null;
    fresh?: { currentVersion: number } | null;
  } = {}
) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    caseChangeSuggestion: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.status === null ? null : { status: opts.status ?? "PENDING" }
        ),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    repositoryCases: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.fresh === undefined ? { currentVersion: 5 } : opts.fresh
        ),
    },
    repositoryCaseIssue: { updateMany: vi.fn().mockResolvedValue({}) },
  };
}

const run = (db: ReturnType<typeof makeDb>) =>
  regenerateSuggestion(db, {
    suggestionId: 9,
    caseId: 12,
    userId: "u1",
    tenantId: "t1",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx = makeTx();
  mocks.loadTemplate.mockResolvedValue({
    template: { id: 4, name: "Functional", fields: [] },
    fieldMappings: [],
  });
  mocks.review.mockResolvedValue({
    ok: true,
    decisions: [{ caseId: 12, action: "update", reason: "Tax", proposed }],
    newCases: [],
    problems: [],
  });
});

describe("regenerateSuggestion", () => {
  it("finds the suggestion only on its own case, and only while it is pending", async () => {
    const missing = makeDb({ suggestion: null });
    expect(await run(missing)).toEqual({ ok: false, code: "not_found" });
    expect(
      missing.caseChangeSuggestion.findFirst.mock.calls[0][0].where
    ).toEqual({ id: 9, caseId: 12 });
    expect(
      await run(makeDb({ suggestion: { status: "APPLIED", issueId: 100 } }))
    ).toEqual({ ok: false, code: "not_pending" });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("stops when the case, the issue or the template is gone", async () => {
    expect(await run(makeDb({ row: null }))).toEqual({
      ok: false,
      code: "gone",
    });
    expect(await run(makeDb({ issue: null }))).toEqual({
      ok: false,
      code: "gone",
    });
    mocks.loadTemplate.mockResolvedValueOnce(null);
    expect(await run(makeDb())).toEqual({ ok: false, code: "gone" });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("asks the model about this one case against the issue as it reads now, as the user", async () => {
    const db = makeDb();
    await run(db);
    expect(mocks.review).toHaveBeenCalledWith(db, {
      projectId: 7,
      tenantId: "t1",
      userId: "u1",
      issue: {
        key: "DEMO-42",
        title: "Checkout totals",
        description: "Add tax",
        previous: null,
      },
      otherIssues: [],
      cases: [
        {
          id: 12,
          name: "Totals add up",
          fieldValues: {},
          steps: [{ step: "Open the cart", expectedResult: "Total" }],
          stepsFixed: false,
        },
      ],
      template: { id: 4, name: "Functional", fields: [] },
    });
  });

  it("names an issue without a tracker key by its own name and reads a missing description as empty", async () => {
    const db = makeDb({
      issue: {
        name: "Local 3",
        externalKey: null,
        title: "A bug",
        description: null,
        contentUpdatedAt: null,
      },
    });
    await run(db);
    expect(mocks.review.mock.calls[0][1].issue).toMatchObject({
      key: "Local 3",
      description: "",
    });
    expect(
      mocks.tx.caseChangeSuggestion.create.mock.calls[0][0].data
        .issueContentUpdatedAt
    ).toBeNull();
  });

  it("reports a project with no AI model, and a failed check with its reason", async () => {
    mocks.review.mockResolvedValueOnce({ ok: false, reason: "no_llm" });
    expect(await run(makeDb())).toEqual({ ok: false, code: "no_llm" });
    mocks.review.mockResolvedValueOnce({
      ok: false,
      reason: "failed",
      detail: "rate limited",
    });
    expect(await run(makeDb())).toEqual({
      ok: false,
      code: "failed",
      detail: "rate limited",
    });
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("replaces the old suggestion with a new one against the case's current version", async () => {
    expect(await run(makeDb())).toEqual({ ok: true, outcome: "suggested" });
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.tx.caseChangeSuggestion.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: "SUPERSEDED" },
    });
    expect(mocks.tx.caseChangeSuggestion.create).toHaveBeenCalledWith({
      data: {
        projectId: 7,
        caseId: 12,
        issueId: 100,
        issueContentUpdatedAt: CHANGED,
        baseCaseVersion: 5,
        kind: "UPDATE",
        proposed: {
          templateId: 4,
          base: {
            name: "Totals add up",
            fieldValues: {},
            steps: [{ step: "Open the cart", expectedResult: "Total" }],
          },
          ...proposed,
        },
        rationale: "Tax",
        webhookActionId: "rule-1",
      },
    });
    expect(mocks.tx.repositoryCaseIssue.updateMany).not.toHaveBeenCalled();
  });

  it("suggests retiring, with no proposed text and no reason when none was given", async () => {
    mocks.review.mockResolvedValue({
      ok: true,
      decisions: [{ caseId: 12, action: "retire", reason: "" }],
      newCases: [],
      problems: [],
    });
    expect(await run(makeDb())).toEqual({ ok: true, outcome: "suggested" });
    const data = mocks.tx.caseChangeSuggestion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "RETIRE", rationale: null });
    expect(data).not.toHaveProperty("proposed");
  });

  it("closes the suggestion and marks the case aligned when nothing needs changing now", async () => {
    for (const decisions of [[{ caseId: 12, action: "unchanged" }], []]) {
      mocks.tx = makeTx();
      mocks.review.mockResolvedValue({
        ok: true,
        decisions,
        newCases: [],
        problems: [],
      });
      expect(await run(makeDb())).toEqual({ ok: true, outcome: "up_to_date" });
      expect(mocks.tx.caseChangeSuggestion.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: { status: "SUPERSEDED" },
      });
      expect(mocks.tx.repositoryCaseIssue.updateMany).toHaveBeenCalledWith({
        where: { caseId: 12, issueId: 100 },
        data: { alignedAt: expect.any(Date) },
      });
      expect(mocks.tx.caseChangeSuggestion.create).not.toHaveBeenCalled();
    }
  });

  it("writes nothing when the suggestion was decided while the model was reading", async () => {
    for (const status of ["DISMISSED", null]) {
      mocks.tx = makeTx({ status });
      expect(await run(makeDb())).toEqual({ ok: false, code: "not_pending" });
      expect(mocks.tx.caseChangeSuggestion.update).not.toHaveBeenCalled();
      expect(mocks.tx.caseChangeSuggestion.create).not.toHaveBeenCalled();
    }
  });

  it("writes nothing when the case was saved again or deleted while the model was reading", async () => {
    for (const fresh of [{ currentVersion: 6 }, null]) {
      mocks.tx = makeTx({ fresh });
      expect(await run(makeDb())).toEqual({ ok: false, code: "gone" });
      expect(mocks.tx.caseChangeSuggestion.update).not.toHaveBeenCalled();
    }
  });
});
