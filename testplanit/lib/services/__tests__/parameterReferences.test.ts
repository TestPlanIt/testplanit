import { describe, expect, it, vi } from "vitest";

import {
  scanParameterReferences,
  rewriteParameterReferences,
} from "~/lib/services/parameterReferences";

type StepRow = {
  id: number;
  step: unknown;
  expectedResult: unknown;
};

type RowFixture = {
  id: number;
  valuesJson: Record<string, unknown>;
  isDeleted?: boolean;
};

interface FakeTxOptions {
  steps?: StepRow[];
  rows?: RowFixture[];
  ownerCaseId?: number;
}

function makeTx(opts: FakeTxOptions = {}) {
  const stepUpdates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const rowUpdates: Array<{ id: number; data: Record<string, unknown> }> = [];

  const tx = {
    steps: {
      findMany: vi.fn(async () =>
        (opts.steps ?? []).map((s) => ({
          id: s.id,
          step: s.step,
          expectedResult: s.expectedResult,
        }))
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          stepUpdates.push({ id: where.id, data });
          return { id: where.id };
        }
      ),
    },
    dataSet: {
      findFirst: vi.fn(async () => {
        if (!opts.rows || opts.rows.length === 0) return null;
        return {
          id: 999,
          ownerCaseId: opts.ownerCaseId ?? 1,
          rows: (opts.rows ?? [])
            .filter((r) => !r.isDeleted)
            .map((r) => ({ id: r.id, valuesJson: r.valuesJson })),
        };
      }),
    },
    dataSetRow: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          rowUpdates.push({ id: where.id, data });
          return { id: where.id };
        }
      ),
    },
  };

  return { tx, stepUpdates, rowUpdates };
}

const mentionNode = (label: string) => ({
  type: "parameterMention",
  attrs: { id: label, label, paramId: 1, paramType: "STRING" },
});

const docWithMentions = (mentions: string[]) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Use " },
        ...mentions.map(mentionNode),
        { type: "text", text: " here" },
      ],
    },
  ],
});

describe("scanParameterReferences", () => {
  it("returns zero counts for a case with no steps and no dataset", async () => {
    const { tx } = makeTx();
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.stepCount).toBe(0);
    expect(result.expectedCount).toBe(0);
    expect(result.rowCount).toBe(0);
    expect(result.steps).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("counts a parameterMention node in step JSON", async () => {
    const { tx } = makeTx({
      steps: [
        {
          id: 10,
          step: docWithMentions(["username"]),
          expectedResult: docWithMentions([]),
        },
      ],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.stepCount).toBe(1);
    expect(result.steps).toContainEqual(
      expect.objectContaining({ stepId: 10, field: "step" })
    );
  });

  it("counts a parameterMention node in expectedResult JSON", async () => {
    const { tx } = makeTx({
      steps: [
        {
          id: 11,
          step: docWithMentions([]),
          expectedResult: docWithMentions(["username"]),
        },
      ],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.expectedCount).toBe(1);
    expect(result.steps).toContainEqual(
      expect.objectContaining({ stepId: 11, field: "expectedResult" })
    );
  });

  it("counts dataset row references via valuesJson key match", async () => {
    const { tx } = makeTx({
      rows: [
        { id: 5, valuesJson: { username: "alice", count: 1 } },
        { id: 6, valuesJson: { count: 2 } },
      ],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.rowCount).toBe(1);
    expect(result.rows).toContainEqual({ rowId: 5, key: "username" });
  });

  it("defensively parses stringified Tiptap JSON", async () => {
    const { tx } = makeTx({
      steps: [
        {
          id: 12,
          step: JSON.stringify(docWithMentions(["username"])),
          expectedResult: null,
        },
      ],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.stepCount).toBe(1);
  });

  it("ignores parameterMention nodes whose label does not match", async () => {
    const { tx } = makeTx({
      steps: [
        {
          id: 13,
          step: docWithMentions(["someOther"]),
          expectedResult: null,
        },
      ],
      rows: [{ id: 7, valuesJson: { someOther: "val" } }],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.stepCount).toBe(0);
    expect(result.rowCount).toBe(0);
  });

  it("walks nested content arrays recursively", async () => {
    const nested = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [mentionNode("username")],
                },
              ],
            },
          ],
        },
      ],
    };
    const { tx } = makeTx({
      steps: [{ id: 14, step: nested, expectedResult: null }],
    });
    const result = await scanParameterReferences(tx, 1, "username");
    expect(result.stepCount).toBe(1);
  });
});

describe("rewriteParameterReferences", () => {
  it("renames a chip in step JSON and writes back via tx.steps.update", async () => {
    const { tx, stepUpdates } = makeTx({
      steps: [
        {
          id: 20,
          step: docWithMentions(["old"]),
          expectedResult: null,
        },
      ],
    });
    await rewriteParameterReferences(tx, 1, "old", "new");
    expect(stepUpdates.length).toBe(1);
    const written = stepUpdates[0].data.step;
    const parsed = typeof written === "string" ? JSON.parse(written) : written;
    const flat = JSON.stringify(parsed);
    expect(flat).not.toContain('"label":"old"');
    expect(flat).toContain('"label":"new"');
  });

  it("renames a key in DataSetRow.valuesJson", async () => {
    const { tx, rowUpdates } = makeTx({
      rows: [{ id: 30, valuesJson: { old: "value", other: 5 } }],
    });
    await rewriteParameterReferences(tx, 1, "old", "new");
    expect(rowUpdates.length).toBe(1);
    const data = rowUpdates[0].data.valuesJson as Record<string, unknown>;
    expect(data).toHaveProperty("new", "value");
    expect(data).toHaveProperty("other", 5);
    expect(data).not.toHaveProperty("old");
  });

  it("does not write when oldName is not present", async () => {
    const { tx, stepUpdates, rowUpdates } = makeTx({
      steps: [
        {
          id: 40,
          step: docWithMentions(["nothere"]),
          expectedResult: null,
        },
      ],
      rows: [{ id: 41, valuesJson: { foo: "bar" } }],
    });
    await rewriteParameterReferences(tx, 1, "old", "new");
    expect(stepUpdates).toEqual([]);
    expect(rowUpdates).toEqual([]);
  });

  it("propagates errors from tx.steps.update so caller transaction rolls back", async () => {
    const tx = {
      steps: {
        findMany: vi.fn(async () => [
          { id: 50, step: docWithMentions(["old"]), expectedResult: null },
        ]),
        update: vi.fn(async () => {
          throw new Error("simulated db failure");
        }),
      },
      dataSet: { findFirst: vi.fn(async () => null) },
      dataSetRow: { update: vi.fn() },
    };
    await expect(
      rewriteParameterReferences(tx, 1, "old", "new")
    ).rejects.toThrow(/simulated db failure/);
  });
});
