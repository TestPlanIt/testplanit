import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldMapping } from "~/lib/services/jira-panel-generation";

const mocks = vi.hoisted(() => ({ createVersion: vi.fn() }));
vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: mocks.createVersion,
}));
vi.mock("~/lib/services/testCaseImport", () => ({
  convertStepToTipTap: (value: unknown) => ({ tiptap: value }),
}));

import type { UpkeepCaseText } from "./caseText";
import { rewriteCase } from "./rewrite";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const mappings: FieldMapping[] = [
  {
    fieldName: "Priority",
    caseFieldId: 5,
    fieldType: "Dropdown",
    fieldOptions: [
      { id: 10, name: "High" },
      { id: 11, name: "Low" },
    ],
  },
  { fieldName: "Preconditions", caseFieldId: 6, fieldType: "Text Long" },
  { fieldName: "Notes", caseFieldId: 7, fieldType: "Text String" },
];

function makeTx(
  opts: {
    row?: Record<string, unknown> | null;
    claimed?: number;
    shared?: boolean;
  } = {}
) {
  const row =
    opts.row === undefined
      ? {
          id: 12,
          name: "Totals add up",
          currentVersion: 3,
          caseFieldValues: [
            { id: 50, fieldId: 5, value: 10 },
            { id: 51, fieldId: 6, value: doc("Cart has two items") },
          ],
          steps: [
            {
              id: 70,
              step: doc("Open the cart"),
              expectedResult: doc("Total is shown"),
              order: 0,
              sharedStepGroupId: opts.shared ? 9 : null,
            },
            {
              id: 71,
              step: doc("Remove an item"),
              expectedResult: doc("Total drops"),
              order: 4,
              sharedStepGroupId: null,
            },
          ],
        }
      : opts.row;
  return {
    repositoryCases: {
      findFirst: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
    },
    caseFieldValues: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    steps: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  };
}

const current: UpkeepCaseText = {
  name: "Totals add up",
  fieldValues: { Priority: "High", Preconditions: "Cart has two items" },
  steps: [
    { step: "Open the cart", expectedResult: "Total is shown" },
    { step: "Remove an item", expectedResult: "Total drops" },
  ],
};

const run = (
  tx: ReturnType<typeof makeTx>,
  proposed = current,
  expectedVersion = 3
) =>
  rewriteCase(tx, {
    caseId: 12,
    expectedVersion,
    proposed,
    fieldMappings: mappings,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createVersion.mockResolvedValue({});
});

describe("rewriteCase", () => {
  it("refuses a case that is gone", async () => {
    const tx = makeTx({ row: null });
    expect(await run(tx)).toEqual({ ok: false, reason: "gone" });
    expect(tx.repositoryCases.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, isDeleted: false } })
    );
    expect(tx.repositoryCases.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a case that has moved on from the expected version", async () => {
    const tx = makeTx();
    expect(await run(tx, current, 2)).toEqual({ ok: false, reason: "changed" });
    expect(tx.repositoryCases.updateMany).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });

  it("refuses when another save takes the version first", async () => {
    const tx = makeTx({ claimed: 0 });
    expect(await run(tx)).toEqual({ ok: false, reason: "changed" });
    expect(tx.steps.update).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });

  it("claims the next version and writes nothing else when nothing differs", async () => {
    const tx = makeTx();
    expect(await run(tx)).toEqual({ ok: true, version: 4, skippedFields: [] });
    expect(tx.repositoryCases.updateMany).toHaveBeenCalledWith({
      where: { id: 12, currentVersion: 3, isDeleted: false },
      data: { name: "Totals add up", currentVersion: 4 },
    });
    expect(tx.caseFieldValues.update).not.toHaveBeenCalled();
    expect(tx.caseFieldValues.create).not.toHaveBeenCalled();
    expect(tx.steps.update).not.toHaveBeenCalled();
    expect(tx.steps.create).not.toHaveBeenCalled();
    expect(tx.steps.updateMany).not.toHaveBeenCalled();
    expect(mocks.createVersion).toHaveBeenCalledWith(tx, 12, {
      copyFieldValues: true,
    });
  });

  it("renames the case, keeping the old name when the new one is blank and cutting a long one", async () => {
    const renamed = makeTx();
    await run(renamed, { ...current, name: "Totals include tax" });
    expect(renamed.repositoryCases.updateMany.mock.calls[0][0].data.name).toBe(
      "Totals include tax"
    );

    const blank = makeTx();
    await run(blank, { ...current, name: "   " });
    expect(blank.repositoryCases.updateMany.mock.calls[0][0].data.name).toBe(
      "Totals add up"
    );

    const long = makeTx();
    await run(long, { ...current, name: "x".repeat(400) });
    expect(
      long.repositoryCases.updateMany.mock.calls[0][0].data.name
    ).toHaveLength(255);
  });

  it("updates a changed field, creates a missing one and leaves an unchanged one", async () => {
    const tx = makeTx();
    const result = await run(tx, {
      ...current,
      fieldValues: {
        Priority: "Low",
        Preconditions: "Cart has two items",
        Notes: "Smoke",
      },
    });
    expect(result).toEqual({ ok: true, version: 4, skippedFields: [] });
    expect(tx.caseFieldValues.update).toHaveBeenCalledTimes(1);
    expect(tx.caseFieldValues.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { value: 11 },
    });
    expect(tx.caseFieldValues.create).toHaveBeenCalledWith({
      data: { testCaseId: 12, fieldId: 7, value: "Smoke" },
    });
  });

  it("skips a value the field cannot take, a null, and a field the template lacks", async () => {
    const tx = makeTx();
    const result = await run(tx, {
      ...current,
      fieldValues: {
        Priority: "Urgent",
        Notes: null,
        Severity: "Blocker",
      },
    });
    expect(result).toEqual({
      ok: true,
      version: 4,
      skippedFields: ["Priority"],
    });
    expect(tx.caseFieldValues.update).not.toHaveBeenCalled();
    expect(tx.caseFieldValues.create).not.toHaveBeenCalled();
  });

  it("rewrites only the step that changed, in its own row", async () => {
    const tx = makeTx();
    await run(tx, {
      ...current,
      steps: [
        current.steps[0],
        { step: "Remove an item", expectedResult: "Total drops with tax" },
      ],
    });
    expect(tx.steps.update).toHaveBeenCalledTimes(1);
    expect(tx.steps.update).toHaveBeenCalledWith({
      where: { id: 71 },
      data: {
        step: { tiptap: "Remove an item" },
        expectedResult: { tiptap: "Total drops with tax" },
      },
    });
    expect(tx.steps.create).not.toHaveBeenCalled();
    expect(tx.steps.updateMany).not.toHaveBeenCalled();
  });

  it("adds extra steps after the last existing one", async () => {
    const tx = makeTx();
    await run(tx, {
      ...current,
      steps: [
        ...current.steps,
        { step: "Check out", expectedResult: "Order placed" },
        { step: "Open the receipt", expectedResult: "" },
      ],
    });
    expect(tx.steps.create.mock.calls.map((c) => c[0].data)).toEqual([
      {
        testCaseId: 12,
        step: { tiptap: "Check out" },
        expectedResult: { tiptap: "Order placed" },
        order: 5,
      },
      {
        testCaseId: 12,
        step: { tiptap: "Open the receipt" },
        expectedResult: { tiptap: "" },
        order: 6,
      },
    ]);
  });

  it("deletes the steps beyond the proposed ones", async () => {
    const tx = makeTx();
    await run(tx, { ...current, steps: [current.steps[0]] });
    expect(tx.steps.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [71] } },
      data: { isDeleted: true },
    });
    expect(tx.steps.update).not.toHaveBeenCalled();
  });

  it("gives a case with no steps its first ones from order 0", async () => {
    const tx = makeTx({
      row: {
        id: 12,
        name: "Totals add up",
        currentVersion: 3,
        caseFieldValues: [],
        steps: [],
      },
    });
    await run(tx, {
      name: "Totals add up",
      fieldValues: {},
      steps: [{ step: "Open the cart", expectedResult: "" }],
    });
    expect(tx.steps.create.mock.calls[0][0].data.order).toBe(0);
  });

  it("leaves every step alone when the case shares steps with others", async () => {
    const tx = makeTx({ shared: true });
    await run(tx, { ...current, steps: [] });
    expect(tx.steps.update).not.toHaveBeenCalled();
    expect(tx.steps.create).not.toHaveBeenCalled();
    expect(tx.steps.updateMany).not.toHaveBeenCalled();
    expect(mocks.createVersion).toHaveBeenCalled();
  });
});
