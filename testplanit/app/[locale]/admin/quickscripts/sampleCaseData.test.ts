import { describe, expect, it } from "vitest";
import { buildSampleFields, SAMPLE_CASE_BASE } from "./sampleCaseData";

describe("SAMPLE_CASE_BASE", () => {
  it("should have expected base fields", () => {
    expect(SAMPLE_CASE_BASE.name).toBe("User Login with Valid Credentials");
    expect(SAMPLE_CASE_BASE.id).toBe(42);
    expect(SAMPLE_CASE_BASE.folder).toBe("Authentication");
    expect(SAMPLE_CASE_BASE.state).toBe("Ready");
    expect(SAMPLE_CASE_BASE.estimate).toBe(15);
    expect(SAMPLE_CASE_BASE.automated).toBe(false);
    expect(SAMPLE_CASE_BASE.tags).toBe("Smoke, Authentication");
    expect(SAMPLE_CASE_BASE.createdBy).toBe("jane.doe@example.com");
    expect(SAMPLE_CASE_BASE.createdAt).toBe("2025-01-15");
  });

  it("should have 3 steps with 1-indexed order", () => {
    expect(SAMPLE_CASE_BASE.steps).toHaveLength(3);
    expect(SAMPLE_CASE_BASE.steps[0].order).toBe(1);
    expect(SAMPLE_CASE_BASE.steps[1].order).toBe(2);
    expect(SAMPLE_CASE_BASE.steps[2].order).toBe(3);
  });

  it("should have step and expectedResult on each step", () => {
    for (const step of SAMPLE_CASE_BASE.steps) {
      expect(step).toHaveProperty("step");
      expect(step).toHaveProperty("expectedResult");
      expect(step.step.length).toBeGreaterThan(0);
      expect(step.expectedResult.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSampleFields", () => {
  it("should return empty object for undefined input", () => {
    expect(buildSampleFields(undefined)).toEqual({});
  });

  it("should return empty object for empty array", () => {
    expect(buildSampleFields([])).toEqual({});
  });

  it("should map Checkbox type to 'Yes'", () => {
    const result = buildSampleFields([
      { systemName: "isActive", type: { type: "Checkbox" } },
    ]);
    expect(result).toEqual({ isActive: "Yes" });
  });

  it("should map Date type to '2025-03-15'", () => {
    const result = buildSampleFields([
      { systemName: "dueDate", type: { type: "Date" } },
    ]);
    expect(result).toEqual({ dueDate: "2025-03-15" });
  });

  it("should map Dropdown type to 'Option A'", () => {
    const result = buildSampleFields([
      { systemName: "priority", type: { type: "Dropdown" } },
    ]);
    expect(result).toEqual({ priority: "Option A" });
  });

  it("should map Integer type to '5'", () => {
    const result = buildSampleFields([
      { systemName: "retryCount", type: { type: "Integer" } },
    ]);
    expect(result).toEqual({ retryCount: "5" });
  });

  it("should map Number type to '2.5'", () => {
    const result = buildSampleFields([
      { systemName: "score", type: { type: "Number" } },
    ]);
    expect(result).toEqual({ score: "2.5" });
  });

  it("should map Link type to a URL", () => {
    const result = buildSampleFields([
      { systemName: "reference", type: { type: "Link" } },
    ]);
    expect(result).toEqual({ reference: "https://example.com/reference" });
  });

  it("should map Multi-Select type to comma-separated options", () => {
    const result = buildSampleFields([
      { systemName: "components", type: { type: "Multi-Select" } },
    ]);
    expect(result).toEqual({ components: "Option A, Option B, Option C" });
  });

  it("should map Text String type", () => {
    const result = buildSampleFields([
      { systemName: "shortDesc", type: { type: "Text String" } },
    ]);
    expect(result).toEqual({ shortDesc: "Sample text value" });
  });

  it("should map Text Long type", () => {
    const result = buildSampleFields([
      { systemName: "description", type: { type: "Text Long" } },
    ]);
    expect(result).toEqual({
      description: "This is a longer sample text description.",
    });
  });

  it("should fall back to 'Sample value' for unknown field types", () => {
    const result = buildSampleFields([
      { systemName: "custom", type: { type: "UnknownType" } },
    ]);
    expect(result).toEqual({ custom: "Sample value" });
  });

  it("should fall back to 'Sample value' when type is null", () => {
    const result = buildSampleFields([
      { systemName: "noType", type: null },
    ]);
    expect(result).toEqual({ noType: "Sample value" });
  });

  it("should fall back to 'Sample value' when type is undefined", () => {
    const result = buildSampleFields([
      { systemName: "noType" },
    ]);
    expect(result).toEqual({ noType: "Sample value" });
  });

  it("should handle multiple fields at once", () => {
    const result = buildSampleFields([
      { systemName: "priority", type: { type: "Dropdown" } },
      { systemName: "isActive", type: { type: "Checkbox" } },
      { systemName: "dueDate", type: { type: "Date" } },
    ]);
    expect(result).toEqual({
      priority: "Option A",
      isActive: "Yes",
      dueDate: "2025-03-15",
    });
  });
});
