import { describe, expect, it } from "vitest";

import { buildStepRows } from "./useExportTestRunPdf";

// Minimal Tiptap doc wrapper so extractJsonText yields the given text.
function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

describe("buildStepRows", () => {
  it("returns no rows when the case has no steps", () => {
    expect(buildStepRows(undefined, undefined)).toEqual([]);
    expect(buildStepRows([], [])).toEqual([]);
  });

  it("renders every authored step in order, with no result when none recorded", () => {
    const steps = [
      { id: 2, order: 2, step: doc("Second"), expectedResult: doc("Exp 2") },
      { id: 1, order: 1, step: doc("First"), expectedResult: doc("Exp 1") },
    ];
    const rows = buildStepRows(steps, []);
    expect(rows.map((r) => [r.num, r.stepText, r.expectedText])).toEqual([
      [1, "First", "Exp 1"],
      [2, "Second", "Exp 2"],
    ]);
    expect(rows.every((r) => r.result === undefined)).toBe(true);
  });

  it("overlays a recorded result only on the step that has one", () => {
    const steps = [
      { id: 10, order: 1, step: doc("Open app"), expectedResult: doc("Opens") },
      {
        id: 11,
        order: 2,
        step: doc("Log in"),
        expectedResult: doc("Logged in"),
      },
    ];
    const stepResults = [
      { stepId: 11, sharedStepItemId: null, stepStatus: { name: "Failed" } },
    ];
    const rows = buildStepRows(steps, stepResults);
    expect(rows[0].result).toBeUndefined();
    expect(rows[1].result?.stepStatus?.name).toBe("Failed");
  });

  it("expands a shared-step placeholder into its items and matches results by item", () => {
    const steps = [
      { id: 5, order: 1, step: doc("Plain"), expectedResult: doc("E") },
      {
        id: 6,
        order: 2,
        sharedStepGroupId: 99,
        sharedStepGroup: {
          id: 99,
          name: "Login Flow",
          items: [
            {
              id: 201,
              order: 2,
              step: doc("Submit"),
              expectedResult: doc("OK"),
            },
            {
              id: 200,
              order: 1,
              step: doc("Enter creds"),
              expectedResult: doc("Filled"),
            },
          ],
        },
      },
    ];
    const stepResults = [
      // result for the shared item id 200 (keyed by stepId:sharedStepItemId)
      { stepId: 6, sharedStepItemId: 200, stepStatus: { name: "Passed" } },
    ];
    const rows = buildStepRows(steps, stepResults);

    // Plain step, then the two shared items in their own order.
    expect(rows.map((r) => [r.num, r.stepText, r.sharedGroup ?? null])).toEqual(
      [
        [1, "Plain", null],
        [2, "Enter creds", "Login Flow"],
        [3, "Submit", "Login Flow"],
      ]
    );
    // Only the matching shared item carries the result.
    expect(rows[1].result?.stepStatus?.name).toBe("Passed");
    expect(rows[2].result).toBeUndefined();
  });
});
