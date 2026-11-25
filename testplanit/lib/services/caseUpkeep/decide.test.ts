import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTemplate: vi.fn(),
  rewrite: vi.fn(),
}));
vi.mock("~/lib/services/jira-panel-generation", () => ({
  loadTemplateData: mocks.loadTemplate,
}));
vi.mock("./rewrite", () => ({ rewriteCase: mocks.rewrite }));

import { decideSuggestion } from "./decide";

const proposedText = {
  name: "Totals include tax",
  fieldValues: { Priority: "Low" },
  steps: [{ step: "Open the cart", expectedResult: "Total with tax" }],
};
const proposed = {
  templateId: 4,
  ...proposedText,
  base: {
    name: "Totals add up",
    fieldValues: { Priority: "High" },
    steps: [{ step: "Open the cart", expectedResult: "Total" }],
  },
};
const mappings = [
  { fieldName: "Priority", caseFieldId: 5, fieldType: "Dropdown" },
];

function makeTx(
  opts: {
    suggestion?: Record<string, unknown> | null;
    testCase?: Record<string, unknown> | null;
  } = {}
) {
  const suggestion =
    opts.suggestion === undefined
      ? {
          status: "PENDING",
          kind: "UPDATE",
          issueId: 100,
          baseCaseVersion: 3,
          proposed,
        }
      : opts.suggestion;
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    caseChangeSuggestion: {
      findFirst: vi.fn().mockResolvedValue(suggestion),
      update: vi.fn().mockResolvedValue({}),
    },
    repositoryCaseIssue: { updateMany: vi.fn().mockResolvedValue({}) },
    repositoryCases: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.testCase === undefined
            ? { currentVersion: 3, templateId: 4 }
            : opts.testCase
        ),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

const decide = (tx: ReturnType<typeof makeTx>, action: "apply" | "dismiss") =>
  decideSuggestion(tx, { suggestionId: 9, caseId: 12, action, userId: "u1" });

const closedAs = (tx: ReturnType<typeof makeTx>, status: string) => {
  expect(tx.caseChangeSuggestion.update).toHaveBeenCalledWith({
    where: { id: 9 },
    data: { status, decidedById: "u1", decidedAt: expect.any(Date) },
  });
  expect(tx.repositoryCaseIssue.updateMany).toHaveBeenCalledWith({
    where: { caseId: 12, issueId: 100 },
    data: { alignedAt: expect.any(Date) },
  });
};
const untouched = (tx: ReturnType<typeof makeTx>) => {
  expect(tx.caseChangeSuggestion.update).not.toHaveBeenCalled();
  expect(tx.repositoryCaseIssue.updateMany).not.toHaveBeenCalled();
  expect(tx.repositoryCases.update).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadTemplate.mockResolvedValue({ fieldMappings: mappings });
  mocks.rewrite.mockResolvedValue({ ok: true, version: 4, skippedFields: [] });
});

describe("decideSuggestion", () => {
  it("finds the suggestion only on the case it belongs to", async () => {
    const tx = makeTx({ suggestion: null });
    expect(await decide(tx, "apply")).toEqual({ ok: false, code: "not_found" });
    expect(tx.caseChangeSuggestion.findFirst).toHaveBeenCalledWith({
      where: { id: 9, caseId: 12 },
      select: { issueId: true },
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    untouched(tx);
  });

  it("refuses a suggestion that is already decided or superseded, after taking the lock", async () => {
    for (const status of ["APPLIED", "DISMISSED", "SUPERSEDED"]) {
      const tx = makeTx({ suggestion: { status, issueId: 100 } });
      expect(await decide(tx, "dismiss")).toEqual({
        ok: false,
        code: "not_pending",
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      untouched(tx);
    }
  });

  it("dismisses without touching the case, and marks the case aligned", async () => {
    const tx = makeTx();
    expect(await decide(tx, "dismiss")).toEqual({
      ok: true,
      status: "DISMISSED",
    });
    closedAs(tx, "DISMISSED");
    expect(tx.repositoryCases.findFirst).not.toHaveBeenCalled();
    expect(tx.repositoryCases.update).not.toHaveBeenCalled();
    expect(mocks.rewrite).not.toHaveBeenCalled();
  });

  it("dismisses even when the case has changed since", async () => {
    const tx = makeTx({ testCase: { currentVersion: 9, templateId: 4 } });
    expect(await decide(tx, "dismiss")).toEqual({
      ok: true,
      status: "DISMISSED",
    });
  });

  it("applies an update as a normal edit and makes the user the reviewer", async () => {
    const tx = makeTx();
    expect(await decide(tx, "apply")).toEqual({ ok: true, status: "APPLIED" });
    expect(mocks.loadTemplate).toHaveBeenCalledWith(4, tx);
    expect(mocks.rewrite).toHaveBeenCalledWith(tx, {
      caseId: 12,
      expectedVersion: 3,
      // Only the case after the change is written, not what it was shown against.
      proposed: proposedText,
      fieldMappings: mappings,
    });
    expect(tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { reviewedById: "u1", reviewedAt: expect.any(Date) },
    });
    closedAs(tx, "APPLIED");
  });

  it("applies a retirement by deleting the case", async () => {
    const tx = makeTx({
      suggestion: {
        status: "PENDING",
        kind: "RETIRE",
        issueId: 100,
        baseCaseVersion: 3,
        proposed: null,
      },
    });
    expect(await decide(tx, "apply")).toEqual({ ok: true, status: "APPLIED" });
    expect(tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { isDeleted: true },
    });
    expect(mocks.rewrite).not.toHaveBeenCalled();
    closedAs(tx, "APPLIED");
  });

  it("refuses to apply to a case that was deleted", async () => {
    const tx = makeTx({ testCase: null });
    expect(await decide(tx, "apply")).toEqual({ ok: false, code: "gone" });
    expect(tx.repositoryCases.findFirst).toHaveBeenCalledWith({
      where: { id: 12, isDeleted: false },
      select: { currentVersion: true, templateId: true },
    });
    untouched(tx);
  });

  it("refuses to apply to a case that has changed since the suggestion was made", async () => {
    const tx = makeTx({ testCase: { currentVersion: 4, templateId: 4 } });
    expect(await decide(tx, "apply")).toEqual({ ok: false, code: "stale" });
    untouched(tx);
    expect(mocks.rewrite).not.toHaveBeenCalled();
  });

  it("refuses an update whose stored proposal cannot be read or is for another template", async () => {
    for (const bad of [null, { name: "x" }, { ...proposed, templateId: 5 }]) {
      const tx = makeTx({
        suggestion: {
          status: "PENDING",
          kind: "UPDATE",
          issueId: 100,
          baseCaseVersion: 3,
          proposed: bad,
        },
      });
      expect(await decide(tx, "apply")).toEqual({ ok: false, code: "stale" });
      untouched(tx);
    }
    expect(mocks.rewrite).not.toHaveBeenCalled();
  });

  it("refuses when the case's template can no longer be read", async () => {
    mocks.loadTemplate.mockResolvedValue(null);
    const tx = makeTx();
    expect(await decide(tx, "apply")).toEqual({ ok: false, code: "stale" });
    untouched(tx);
  });

  it("passes on a rewrite that was refused", async () => {
    mocks.rewrite.mockResolvedValueOnce({ ok: false, reason: "changed" });
    const changed = makeTx();
    expect(await decide(changed, "apply")).toEqual({
      ok: false,
      code: "stale",
    });
    untouched(changed);

    mocks.rewrite.mockResolvedValueOnce({ ok: false, reason: "gone" });
    const gone = makeTx();
    expect(await decide(gone, "apply")).toEqual({ ok: false, code: "gone" });
    untouched(gone);
  });
});
