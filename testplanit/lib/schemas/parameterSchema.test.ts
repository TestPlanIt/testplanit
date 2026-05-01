import { describe, expect, it } from "vitest";

import {
  parameterCreateSchema,
  parameterTypeSchema,
  parameterValueSchema,
} from "./parameterSchema";

/**
 * Helper: builds a minimal valid input for parameterCreateSchema. Tests
 * override only the fields they exercise.
 */
function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    testCaseId: 1,
    name: "param",
    type: "STRING",
    ...overrides,
  };
}

describe("parameterTypeSchema", () => {
  it("accepts the four valid ParameterType values", () => {
    expect(parameterTypeSchema.parse("STRING")).toBe("STRING");
    expect(parameterTypeSchema.parse("INTEGER")).toBe("INTEGER");
    expect(parameterTypeSchema.parse("BOOLEAN")).toBe("BOOLEAN");
    expect(parameterTypeSchema.parse("SELECT")).toBe("SELECT");
  });
});

describe("parameterValueSchema", () => {
  it("accepts a string value", () => {
    expect(parameterValueSchema.parse("hello")).toBe("hello");
  });

  it("accepts an integer value", () => {
    expect(parameterValueSchema.parse(42)).toBe(42);
  });

  it("accepts a boolean value", () => {
    expect(parameterValueSchema.parse(true)).toBe(true);
    expect(parameterValueSchema.parse(false)).toBe(false);
  });

  it("rejects a float (non-integer number)", () => {
    // The schema unions string + integer + boolean. 3.14 is a number but
    // fails the .int() refinement, so the union has no matching branch.
    const result = parameterValueSchema.safeParse(3.14);
    expect(result.success).toBe(false);
  });
});

describe("parameterCreateSchema - SELECT XOR boundary check", () => {
  it("accepts SELECT with allowedValuesJson set and lookupDataSetId null", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "SELECT",
        allowedValuesJson: ["yes", "no"],
        lookupDataSetId: null,
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts SELECT with lookupDataSetId set and allowedValuesJson null", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "SELECT",
        allowedValuesJson: null,
        lookupDataSetId: 99,
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects SELECT with BOTH allowedValuesJson and lookupDataSetId set", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "SELECT",
        allowedValuesJson: ["yes", "no"],
        lookupDataSetId: 99,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toContain("exactly one");
    }
  });

  it("rejects SELECT with NEITHER allowedValuesJson nor lookupDataSetId", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "SELECT",
        allowedValuesJson: null,
        lookupDataSetId: null,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toContain("exactly one");
    }
  });

  it("rejects STRING with allowedValuesJson set", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "STRING",
        allowedValuesJson: ["yes", "no"],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toContain("must not specify");
    }
  });

  it("rejects STRING with lookupDataSetId set", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({
        type: "STRING",
        lookupDataSetId: 99,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toContain("must not specify");
    }
  });

  it("accepts INTEGER with neither allowedValuesJson nor lookupDataSetId", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({ type: "INTEGER" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts BOOLEAN with neither allowedValuesJson nor lookupDataSetId", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({ type: "BOOLEAN" }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects an invalid type string (e.g., FLOAT) with an issue on the type path", () => {
    const result = parameterCreateSchema.safeParse(
      buildInput({ type: "FLOAT" }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      const typeIssue = result.error.issues.find((i) => i.path[0] === "type");
      expect(typeIssue).toBeDefined();
    }
  });

  it("applies defaults for order, required, and sensitive when omitted", () => {
    const result = parameterCreateSchema.safeParse(buildInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order).toBe(0);
      expect(result.data.required).toBe(false);
      expect(result.data.sensitive).toBe(false);
    }
  });

  it("rejects missing required field testCaseId", () => {
    const result = parameterCreateSchema.safeParse({
      name: "param",
      type: "STRING",
    });

    expect(result.success).toBe(false);
  });
});
