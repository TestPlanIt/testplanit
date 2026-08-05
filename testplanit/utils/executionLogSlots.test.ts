import { describe, expect, it } from "vitest";
import {
  buildExpectedSlotsByCaseId,
  mergeResultsIntoSlots,
  tiptapToPlainText,
  UNTESTED_STATUS,
  type SharedGroupRow,
  type SharedItemRow,
  type StepResultRow,
  type StepRow,
} from "./executionLogSlots";

function tiptapDoc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("tiptapToPlainText", () => {
  it("returns empty string for null / undefined / empty object", () => {
    expect(tiptapToPlainText(null)).toBe("");
    expect(tiptapToPlainText(undefined)).toBe("");
    expect(tiptapToPlainText({})).toBe("");
  });

  it("returns empty string when input is a non-string, non-object primitive", () => {
    expect(tiptapToPlainText(42)).toBe("");
    expect(tiptapToPlainText(true)).toBe("");
  });

  it("extracts text from a simple paragraph", () => {
    expect(tiptapToPlainText(tiptapDoc("Hello"))).toBe("Hello");
  });

  it("joins text from sibling text nodes with a single space", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: "world" },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe("Hello world");
  });

  it("ignores nodes without text (e.g. images)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before" },
            { type: "image", attrs: { src: "x.png" } },
            { type: "text", text: "after" },
          ],
        },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe("Before after");
  });

  it("parses a JSON-encoded string and recurses into it", () => {
    const json = JSON.stringify(tiptapDoc("Stringified"));
    expect(tiptapToPlainText(json)).toBe("Stringified");
  });

  it("falls back to the raw string when JSON parsing fails", () => {
    expect(tiptapToPlainText("not json")).toBe("not json");
  });
});

describe("buildExpectedSlotsByCaseId", () => {
  it("returns an empty map when there are no case steps", () => {
    const result = buildExpectedSlotsByCaseId([], [], []);
    expect(result.size).toBe(0);
  });

  it("ranks placeholders 1-based by their position in the input order", () => {
    const caseSteps: StepRow[] = [
      {
        id: 100,
        testCaseId: 1,
        order: 5, // raw order is arbitrary
        sharedStepGroupId: null,
        step: tiptapDoc("first step"),
        expectedResult: tiptapDoc("first expected"),
      },
      {
        id: 101,
        testCaseId: 1,
        order: 10,
        sharedStepGroupId: null,
        step: tiptapDoc("second step"),
        expectedResult: tiptapDoc("second expected"),
      },
    ];
    const slots = buildExpectedSlotsByCaseId(caseSteps, [], []).get(1)!;
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      key: "100:0",
      stepNumber: "1",
      stepText: "first step",
      expectedResult: "first expected",
      sharedGroupName: null,
    });
    expect(slots[1]).toMatchObject({
      key: "101:0",
      stepNumber: "2",
    });
  });

  it("expands shared-step placeholders into one slot per item with dotted numbers", () => {
    const caseSteps: StepRow[] = [
      {
        id: 200,
        testCaseId: 7,
        order: 0,
        sharedStepGroupId: 50,
        step: null,
        expectedResult: null,
      },
      {
        id: 201,
        testCaseId: 7,
        order: 1,
        sharedStepGroupId: 50,
        step: null,
        expectedResult: null,
      },
    ];
    const sharedItems: SharedItemRow[] = [
      {
        id: 1,
        order: 0,
        sharedStepGroupId: 50,
        step: tiptapDoc("item one"),
        expectedResult: tiptapDoc("exp one"),
      },
      {
        id: 2,
        order: 1,
        sharedStepGroupId: 50,
        step: tiptapDoc("item two"),
        expectedResult: tiptapDoc("exp two"),
      },
    ];
    const sharedGroups: SharedGroupRow[] = [{ id: 50, name: "MyGroup" }];

    const slots = buildExpectedSlotsByCaseId(
      caseSteps,
      sharedItems,
      sharedGroups
    ).get(7)!;
    expect(slots.map((s) => s.stepNumber)).toEqual([
      "1.1",
      "1.2",
      "2.1",
      "2.2",
    ]);
    expect(slots.every((s) => s.sharedGroupName === "MyGroup")).toBe(true);
    expect(slots[0]).toMatchObject({ key: "200:1", stepText: "item one" });
    expect(slots[3]).toMatchObject({ key: "201:2", stepText: "item two" });
  });

  it("mixes regular and shared placeholders into a single ordered list", () => {
    const caseSteps: StepRow[] = [
      {
        id: 1,
        testCaseId: 1,
        order: 0,
        sharedStepGroupId: null,
        step: tiptapDoc("regular A"),
        expectedResult: null,
      },
      {
        id: 2,
        testCaseId: 1,
        order: 1,
        sharedStepGroupId: 99,
        step: null,
        expectedResult: null,
      },
      {
        id: 3,
        testCaseId: 1,
        order: 2,
        sharedStepGroupId: null,
        step: tiptapDoc("regular B"),
        expectedResult: null,
      },
    ];
    const sharedItems: SharedItemRow[] = [
      {
        id: 10,
        order: 0,
        sharedStepGroupId: 99,
        step: tiptapDoc("shared X"),
        expectedResult: null,
      },
      {
        id: 11,
        order: 1,
        sharedStepGroupId: 99,
        step: tiptapDoc("shared Y"),
        expectedResult: null,
      },
    ];

    const slots = buildExpectedSlotsByCaseId(caseSteps, sharedItems, [
      { id: 99, name: "Group" },
    ]).get(1)!;

    expect(slots.map((s) => s.stepNumber)).toEqual(["1", "2.1", "2.2", "3"]);
    expect(slots.map((s) => s.stepText)).toEqual([
      "regular A",
      "shared X",
      "shared Y",
      "regular B",
    ]);
    expect(slots[0].sharedGroupName).toBeNull();
    expect(slots[3].sharedGroupName).toBeNull();
    expect(slots[1].sharedGroupName).toBe("Group");
  });

  it("falls back to null group name when no SharedStepGroup row is provided", () => {
    const caseSteps: StepRow[] = [
      {
        id: 1,
        testCaseId: 1,
        order: 0,
        sharedStepGroupId: 42,
        step: null,
        expectedResult: null,
      },
    ];
    const sharedItems: SharedItemRow[] = [
      {
        id: 1,
        order: 0,
        sharedStepGroupId: 42,
        step: tiptapDoc("only"),
        expectedResult: null,
      },
    ];
    const slots = buildExpectedSlotsByCaseId(caseSteps, sharedItems, []).get(
      1
    )!;
    expect(slots[0].sharedGroupName).toBeNull();
  });

  it("handles a shared placeholder whose group has no items by producing zero slots for it", () => {
    const caseSteps: StepRow[] = [
      {
        id: 1,
        testCaseId: 1,
        order: 0,
        sharedStepGroupId: 999,
        step: null,
        expectedResult: null,
      },
      {
        id: 2,
        testCaseId: 1,
        order: 1,
        sharedStepGroupId: null,
        step: tiptapDoc("after"),
        expectedResult: null,
      },
    ];
    const slots = buildExpectedSlotsByCaseId(caseSteps, [], []).get(1)!;
    expect(slots).toHaveLength(1);
    expect(slots[0].stepNumber).toBe("2");
  });
});

describe("mergeResultsIntoSlots", () => {
  const slots = [
    {
      key: "100:0",
      stepNumber: "1",
      stepText: "step one",
      expectedResult: "expected one",
      sharedGroupName: null,
    },
    {
      key: "101:0",
      stepNumber: "2",
      stepText: "step two",
      expectedResult: "expected two",
      sharedGroupName: null,
    },
  ];

  it("renders each slot as Untested when no results exist", () => {
    const out = mergeResultsIntoSlots(slots, [], 555);
    expect(out).toHaveLength(2);
    out.forEach((row, i) => {
      expect(row.status).toEqual(UNTESTED_STATUS);
      expect(row.elapsed).toBeNull();
      expect(row.executedAt).toBeNull();
      expect(row.id).toBe(`slot-555-${slots[i].key}`);
    });
  });

  it("merges a matching result onto its slot and uses the result's id", () => {
    const result: StepResultRow = {
      id: 999,
      stepId: 100,
      sharedStepItemId: null,
      elapsed: 12,
      executedAt: new Date("2025-01-15T10:00:00Z"),
      stepStatus: { name: "Passed", color: { value: "#2A843F" } },
    };
    const out = mergeResultsIntoSlots(slots, [result], 555);
    expect(out[0]).toMatchObject({
      id: "step-999",
      stepNumber: "1",
      status: { name: "Passed", color: "#2A843F" },
      elapsed: 12,
      executedAt: "2025-01-15T10:00:00.000Z",
    });
    // slot 2 had no result -> still Untested
    expect(out[1].status).toEqual(UNTESTED_STATUS);
    expect(out[1].id).toBe("slot-555-101:0");
  });

  it("matches by (stepId, sharedStepItemId) — placeholders with the same stepId go to different slots", () => {
    const sharedSlots = [
      {
        key: "200:1",
        stepNumber: "1.1",
        stepText: "shared a",
        expectedResult: "",
        sharedGroupName: "G",
      },
      {
        key: "200:2",
        stepNumber: "1.2",
        stepText: "shared b",
        expectedResult: "",
        sharedGroupName: "G",
      },
    ];
    const results: StepResultRow[] = [
      {
        id: 1,
        stepId: 200,
        sharedStepItemId: 1,
        elapsed: null,
        executedAt: null,
        stepStatus: { name: "Passed", color: { value: "#2A843F" } },
      },
      {
        id: 2,
        stepId: 200,
        sharedStepItemId: 2,
        elapsed: null,
        executedAt: null,
        stepStatus: { name: "Failed", color: { value: "#F44B25" } },
      },
    ];
    const out = mergeResultsIntoSlots(sharedSlots, results, 555);
    expect(out[0].status.name).toBe("Passed");
    expect(out[1].status.name).toBe("Failed");
  });

  it("accepts an ISO date string for executedAt and passes it through unchanged", () => {
    const result: StepResultRow = {
      id: 1,
      stepId: 100,
      sharedStepItemId: null,
      elapsed: null,
      executedAt: "2025-03-01T12:00:00.000Z",
      stepStatus: null,
    };
    const out = mergeResultsIntoSlots(slots, [result], 555);
    expect(out[0].executedAt).toBe("2025-03-01T12:00:00.000Z");
    // Missing stepStatus -> fall back to Untested name/color
    expect(out[0].status).toEqual(UNTESTED_STATUS);
  });

  it("does not match a result for a stepId that exists in another case (no cross-case leakage)", () => {
    const result: StepResultRow = {
      id: 999,
      stepId: 200, // not in our slots
      sharedStepItemId: null,
      elapsed: null,
      executedAt: null,
      stepStatus: { name: "Passed", color: { value: "#2A843F" } },
    };
    const out = mergeResultsIntoSlots(slots, [result], 555);
    out.forEach((row) => expect(row.status).toEqual(UNTESTED_STATUS));
  });

  it("appends a result whose step was removed from the case instead of dropping it", () => {
    const removed: StepResultRow = {
      id: 42,
      stepId: 300, // soft-deleted, so it has no slot
      sharedStepItemId: null,
      elapsed: 12,
      executedAt: "2025-03-01T12:00:00.000Z",
      stepStatus: { name: "Failed", color: { value: "#C6252C" } },
      step: {
        step: { type: "text", text: "old step" },
        expectedResult: { type: "text", text: "old expected" },
        order: 5,
        testCaseId: 1,
      },
    };
    const out = mergeResultsIntoSlots(slots, [removed], 555, 1);
    expect(out).toHaveLength(3);
    // Live slots keep their numbering and stay unflagged.
    expect(out[0].isRemovedStep).toBeUndefined();
    expect(out[1].isRemovedStep).toBeUndefined();

    const orphan = out[2];
    expect(orphan.isRemovedStep).toBe(true);
    expect(orphan.stepNumber).toBe("3");
    expect(orphan.stepText).toBe("old step");
    expect(orphan.expectedResult).toBe("old expected");
    expect(orphan.status).toEqual({ name: "Failed", color: "#C6252C" });
    expect(orphan.elapsed).toBe(12);
    expect(orphan.executedAt).toBe("2025-03-01T12:00:00.000Z");
  });

  it("numbers removed steps after the highest live rank, not the row count", () => {
    // One shared placeholder expanded into two dotted sub-rows: 2 rows, rank 1.
    const sharedSlots = [
      {
        key: "100:1",
        stepNumber: "1.1",
        stepText: "item one",
        expectedResult: "",
        sharedGroupName: "Group",
      },
      {
        key: "100:2",
        stepNumber: "1.2",
        stepText: "item two",
        expectedResult: "",
        sharedGroupName: "Group",
      },
    ];
    const removed: StepResultRow = {
      id: 7,
      stepId: 300,
      sharedStepItemId: null,
      elapsed: null,
      executedAt: null,
      stepStatus: null,
      step: {
        step: null,
        expectedResult: null,
        order: 1,
        testCaseId: 1,
      },
    };
    const out = mergeResultsIntoSlots(sharedSlots, [removed], 555, 1);
    expect(out).toHaveLength(3);
    expect(out[2].stepNumber).toBe("2");
  });

  it("orders multiple removed steps by their recorded step order", () => {
    const mk = (id: number, stepId: number, order: number): StepResultRow => ({
      id,
      stepId,
      sharedStepItemId: null,
      elapsed: null,
      executedAt: null,
      stepStatus: null,
      step: {
        step: { type: "text", text: `step ${order}` },
        expectedResult: null,
        order,
        testCaseId: 1,
      },
    });
    const out = mergeResultsIntoSlots(
      slots,
      [mk(9, 302, 9), mk(8, 301, 3)],
      555,
      1
    );
    expect(out.slice(2).map((r) => r.stepText)).toEqual(["step 3", "step 9"]);
    expect(out.slice(2).map((r) => r.stepNumber)).toEqual(["3", "4"]);
  });

  it("does not adopt an unmatched result whose step belongs to another case", () => {
    const foreign: StepResultRow = {
      id: 999,
      stepId: 200,
      sharedStepItemId: null,
      elapsed: null,
      executedAt: null,
      stepStatus: { name: "Passed", color: { value: "#2A843F" } },
      step: {
        step: null,
        expectedResult: null,
        order: 1,
        testCaseId: 2, // different case
      },
    };
    const out = mergeResultsIntoSlots(slots, [foreign], 555, 1);
    expect(out).toHaveLength(2);
    out.forEach((row) => expect(row.status).toEqual(UNTESTED_STATUS));
  });
});
