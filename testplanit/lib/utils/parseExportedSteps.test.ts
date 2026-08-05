import { describe, expect, it } from "vitest";
import {
  hasLabeledStepFormat,
  parseLabeledSteps,
  parseStepsCell,
  tryParseJsonSteps,
} from "./parseExportedSteps";

describe("hasLabeledStepFormat", () => {
  it("detects exporter output with both labels", () => {
    expect(
      hasLabeledStepFormat("Step 1:\nDo a thing\nExpected Result 1:\nResult")
    ).toBe(true);
  });

  it("detects exporter output with only a step label", () => {
    expect(hasLabeledStepFormat("Step 1:\nDo a thing")).toBe(true);
  });

  it("detects exporter output with only an expected-result label", () => {
    expect(hasLabeledStepFormat("Expected Result 1:\nVerify thing")).toBe(true);
  });

  it("rejects legacy pipe-per-line format", () => {
    expect(hasLabeledStepFormat("Step 1 | Result 1\nStep 2 | Result 2")).toBe(
      false
    );
  });

  it("rejects bare plain text", () => {
    expect(hasLabeledStepFormat("Simple step text")).toBe(false);
  });
});

describe("parseLabeledSteps", () => {
  it("parses the customer-reported single-step cell verbatim", () => {
    const cell = [
      "Step 1:",
      "Navigate to the Tasks Page",
      "Expected Result 1:",
      'Verify "My Open Tasks" on the Tasks page has been updated to "Your Open Tasks"',
    ].join("\n");

    const result = parseLabeledSteps(cell);

    expect(result).toEqual([
      {
        step: "Navigate to the Tasks Page",
        expectedResult:
          'Verify "My Open Tasks" on the Tasks page has been updated to "Your Open Tasks"',
        order: 0,
      },
    ]);
  });

  it("parses multiple step blocks separated by --- lines", () => {
    const cell = [
      "Step 1:",
      "Open login page",
      "Expected Result 1:",
      "Login page renders",
      "---",
      "Step 2:",
      "Enter credentials",
      "Expected Result 2:",
      "Dashboard appears",
    ].join("\n");

    expect(parseLabeledSteps(cell)).toEqual([
      {
        step: "Open login page",
        expectedResult: "Login page renders",
        order: 0,
      },
      {
        step: "Enter credentials",
        expectedResult: "Dashboard appears",
        order: 1,
      },
    ]);
  });

  it("preserves expected result when step body is empty", () => {
    const cell = ["Expected Result 1:", "Verify the banner is hidden"].join(
      "\n"
    );

    expect(parseLabeledSteps(cell)).toEqual([
      {
        step: "",
        expectedResult: "Verify the banner is hidden",
        order: 0,
      },
    ]);
  });

  it("preserves multi-line step body", () => {
    const cell = [
      "Step 1:",
      "Line one of the step",
      "Line two of the step",
      "Expected Result 1:",
      "Result body",
    ].join("\n");

    expect(parseLabeledSteps(cell)).toEqual([
      {
        step: "Line one of the step\nLine two of the step",
        expectedResult: "Result body",
        order: 0,
      },
    ]);
  });

  it("handles step with no expected result", () => {
    const cell = ["Step 1:", "Just a step"].join("\n");

    expect(parseLabeledSteps(cell)).toEqual([
      { step: "Just a step", expectedResult: "", order: 0 },
    ]);
  });

  it("normalizes CRLF line endings", () => {
    const cell = "Step 1:\r\nDo a thing\r\nExpected Result 1:\r\nResult";

    expect(parseLabeledSteps(cell)).toEqual([
      { step: "Do a thing", expectedResult: "Result", order: 0 },
    ]);
  });

  it("treats a block with no labels as a bare step body", () => {
    expect(parseLabeledSteps("Plain step text")).toEqual([
      { step: "Plain step text", expectedResult: "", order: 0 },
    ]);
  });
});

describe("tryParseJsonSteps", () => {
  it("parses string step + expectedResult entries from the JSON export", () => {
    const json = JSON.stringify([
      { stepNumber: 1, step: "Open page", expectedResult: "Page loads" },
      { stepNumber: 2, step: "Click button", expectedResult: "Modal opens" },
    ]);

    expect(tryParseJsonSteps(json)).toEqual([
      { step: "Open page", expectedResult: "Page loads", order: 0 },
      { step: "Click button", expectedResult: "Modal opens", order: 1 },
    ]);
  });

  it("extracts text from Tiptap-shaped step/expectedResult values", () => {
    const doc = (text: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const json = JSON.stringify([
      { stepNumber: 1, step: doc("Body"), expectedResult: doc("Result") },
    ]);

    expect(tryParseJsonSteps(json)).toEqual([
      { step: "Body", expectedResult: "Result", order: 0 },
    ]);
  });

  it("returns null for non-JSON input", () => {
    expect(tryParseJsonSteps("Step 1:\nx")).toBeNull();
  });

  it("returns null for JSON that isn't an array", () => {
    expect(tryParseJsonSteps('{"step":"x"}')).toBeNull();
  });
});

describe("parseStepsCell", () => {
  it("reads every step of a JSON cell", () => {
    const json = JSON.stringify([
      { stepNumber: 1, step: "Open page", expectedResult: "Page loads" },
      { stepNumber: 2, step: "Click save", expectedResult: "Saved" },
      { stepNumber: 3, step: "Reload", expectedResult: "Persists" },
    ]);

    expect(parseStepsCell(json).map((s) => s.step)).toEqual([
      "Open page",
      "Click save",
      "Reload",
    ]);
  });

  it("reads every step of the labeled export format", () => {
    const cell = [
      "Step 1:",
      "Open the page",
      "Expected Result 1:",
      "It loads",
      "---",
      "Step 2:",
      "Click save",
      "Expected Result 2:",
      "It saves",
    ].join("\n");

    expect(parseStepsCell(cell)).toEqual([
      { step: "Open the page", expectedResult: "It loads", order: 0 },
      { step: "Click save", expectedResult: "It saves", order: 1 },
    ]);
  });

  it("reads one step per line in the legacy pipe format", () => {
    const cell = "1. Open the page | It loads\n2. Click save | It saves";

    expect(parseStepsCell(cell)).toEqual([
      { step: "Open the page", expectedResult: "It loads", order: 0 },
      { step: "Click save", expectedResult: "It saves", order: 1 },
    ]);
  });

  it("keeps a lone step as one step", () => {
    expect(parseStepsCell("Just do the thing")).toEqual([
      { step: "Just do the thing", expectedResult: "", order: 0 },
    ]);
  });

  it("returns nothing for an empty cell", () => {
    expect(parseStepsCell("")).toEqual([]);
    expect(parseStepsCell("   ")).toEqual([]);
  });
});
