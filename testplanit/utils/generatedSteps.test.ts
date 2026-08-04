import { describe, expect, it } from "vitest";
import {
  findGeneratedStepsEntry,
  normalizeGeneratedSteps,
} from "./generatedSteps";

describe("normalizeGeneratedSteps", () => {
  it("passes through the requested array of step objects unchanged", () => {
    const steps = normalizeGeneratedSteps([
      { step: "one", expectedResult: "r1" },
      { step: "two", expectedResult: "r2" },
      { step: "three", expectedResult: "r3" },
    ]);

    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.step)).toEqual(["one", "two", "three"]);
    expect(steps.map((s) => s.expectedResult)).toEqual(["r1", "r2", "r3"]);
  });

  it("keeps shared-step metadata on the step", () => {
    const [step] = normalizeGeneratedSteps([
      { step: "a", expectedResult: "b", sharedStepGroupId: 7, order: 2 },
    ]);

    expect(step.sharedStepGroupId).toBe(7);
    expect(step.order).toBe(2);
  });

  it("accepts action / expected key spellings", () => {
    const steps = normalizeGeneratedSteps([
      { action: "click", expected_result: "modal opens" },
      { Action: "type", ExpectedOutcome: "text appears" },
    ]);

    expect(steps).toEqual([
      expect.objectContaining({ step: "click", expectedResult: "modal opens" }),
      expect.objectContaining({ step: "type", expectedResult: "text appears" }),
    ]);
  });

  it("splits a numbered list emitted as one string into a step each", () => {
    const steps = normalizeGeneratedSteps(
      "1. Open the login page\n2. Enter valid credentials\n3. Submit the form"
    );

    expect(steps.map((s) => s.step)).toEqual([
      "Open the login page",
      "Enter valid credentials",
      "Submit the form",
    ]);
  });

  it("splits a bulleted list the same way", () => {
    const steps = normalizeGeneratedSteps("- Open app\n- Tap settings");
    expect(steps.map((s) => s.step)).toEqual(["Open app", "Tap settings"]);
  });

  it("keeps an unmarked multi-line string as a single step", () => {
    const steps = normalizeGeneratedSteps("Open the page\nand wait for it");
    expect(steps).toHaveLength(1);
  });

  it("splits a numbered list packed into one step object", () => {
    const steps = normalizeGeneratedSteps([
      {
        step: "1. Open the page\n2. Click save\n3. Reload",
        expectedResult: "The change persists",
      },
    ]);

    expect(steps.map((s) => s.step)).toEqual([
      "Open the page",
      "Click save",
      "Reload",
    ]);
    // The one expected result belongs to the last action.
    expect(steps.map((s) => s.expectedResult)).toEqual([
      "",
      "",
      "The change persists",
    ]);
  });

  it("leaves an already-split response alone", () => {
    const steps = normalizeGeneratedSteps([
      { step: "1. Open the page", expectedResult: "shown" },
      { step: "2. Click save", expectedResult: "saved" },
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0].step).toBe("1. Open the page");
  });

  it("does not restructure a shared-step placeholder", () => {
    const steps = normalizeGeneratedSteps([
      { step: "1. a\n2. b", expectedResult: "", sharedStepGroupId: 4 },
    ]);

    expect(steps).toHaveLength(1);
  });

  it("wraps a single step object in an array", () => {
    const steps = normalizeGeneratedSteps({
      step: "only one",
      expectedResult: "done",
    });
    expect(steps).toEqual([{ step: "only one", expectedResult: "done" }]);
  });

  it("turns an array of plain strings into steps", () => {
    const steps = normalizeGeneratedSteps(["first", "second"]);
    expect(steps.map((s) => s.step)).toEqual(["first", "second"]);
    expect(steps.every((s) => s.expectedResult === "")).toBe(true);
  });

  it("treats a TipTap document as one step body, not a container", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    const steps = normalizeGeneratedSteps([doc]);

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe(doc);
  });

  it("returns an empty array for absent or unusable values", () => {
    expect(normalizeGeneratedSteps(undefined)).toEqual([]);
    expect(normalizeGeneratedSteps(null)).toEqual([]);
    expect(normalizeGeneratedSteps([])).toEqual([]);
    expect(normalizeGeneratedSteps("   ")).toEqual([]);
    expect(normalizeGeneratedSteps([{ unrelated: "value" }])).toEqual([]);
  });
});

describe("findGeneratedStepsEntry", () => {
  it("finds the steps by field name", () => {
    const found = findGeneratedStepsEntry({
      Description: "text",
      Steps: [
        { step: "a", expectedResult: "b" },
        { step: "c", expectedResult: "d" },
      ],
    });

    expect(found?.key).toBe("Steps");
    expect(found?.steps).toHaveLength(2);
  });

  it("finds the steps by shape when the field is named otherwise", () => {
    const found = findGeneratedStepsEntry({
      Procedure: [{ action: "a", expectedResult: "b" }],
    });

    expect(found?.key).toBe("Procedure");
    expect(found?.steps).toHaveLength(1);
  });

  it("does not mistake other field values for steps", () => {
    expect(
      findGeneratedStepsEntry({
        Description: "Open the app and check the result",
        Tags: [1, 2, 3],
        Priority: "High",
      })
    ).toBeNull();
    expect(findGeneratedStepsEntry(undefined)).toBeNull();
  });
});
