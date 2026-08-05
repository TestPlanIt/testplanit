import { describe, expect, it } from "vitest";

import {
  ASSIGNED_TO_UNASSIGNED_SENTINEL,
  BETWEEN_OPERATOR,
  FILTER_DIMENSION_KEY_PATTERN,
  OPERATOR_ARITY,
  RELATIVE_DATE_OPERATORS,
  REPO_STATIC_DIMENSIONS,
  RUN_DIMENSIONS,
  STATUS_UNTESTED_SENTINEL,
  buildDynamicFieldDimension,
  buildFilterDimensions,
  dynamicFieldDimensionKey,
  getOperatorArity,
} from "./filterDimensions";

/** viewOptions.dynamicFields-shaped fixture (Record keyed by displayName). */
const dynamicFieldsRecord = {
  Severity: { fieldId: 1, type: "Dropdown" },
  Labels: { fieldId: 2, type: "Multi-Select" },
  Regression: { fieldId: 3, type: "Checkbox" },
  Estimate: { fieldId: 4, type: "Integer" },
  Weight: { fieldId: 5, type: "Number" },
  Due: { fieldId: 6, type: "Date" },
  Notes: { fieldId: 7, type: "Text Long" },
  Ref: { fieldId: 8, type: "Text String" },
  Spec: { fieldId: 9, type: "Link" },
  Reproduction: { fieldId: 10, type: "Steps" },
};

describe("buildFilterDimensions", () => {
  it("builds the eight repo static dimensions by default, without run dims", () => {
    const registry = buildFilterDimensions();
    expect([...registry.keys()]).toEqual([
      "templates",
      "states",
      "creators",
      "automated",
      "parameterized",
      "attachments",
      "tags",
      "issues",
    ]);
    expect(registry.has("status")).toBe(false);
    expect(registry.has("assignedTo")).toBe(false);
  });

  it("includes run dimensions with their sentinels when requested", () => {
    const registry = buildFilterDimensions({ includeRunDimensions: true });
    const status = registry.get("status");
    const assignedTo = registry.get("assignedTo");
    expect(status).toMatchObject({
      scope: "run",
      valueType: "idList",
      operators: ["in"],
      sentinels: [STATUS_UNTESTED_SENTINEL],
    });
    expect(assignedTo).toMatchObject({
      scope: "run",
      valueType: "userList",
      operators: ["in"],
      sentinels: [ASSIGNED_TO_UNASSIGNED_SENTINEL],
    });
  });

  it("assigns the spec operator sets to the static dimensions", () => {
    const registry = buildFilterDimensions();
    expect(registry.get("templates")?.operators).toEqual(["in"]);
    expect(registry.get("states")?.operators).toEqual(["in"]);
    expect(registry.get("creators")?.operators).toEqual(["in"]);
    for (const key of ["automated", "parameterized", "attachments"]) {
      expect(registry.get(key)?.operators).toEqual(["is"]);
      expect(registry.get(key)?.valueType).toBe("boolean");
    }
    expect(registry.get("tags")?.operators).toEqual(["any", "all", "none"]);
    expect(registry.get("issues")?.operators).toEqual(["any", "all", "none"]);
  });

  it("builds field_<fieldId> dimensions from a dynamicFields record", () => {
    const registry = buildFilterDimensions({
      dynamicFields: dynamicFieldsRecord,
    });
    for (const field of Object.values(dynamicFieldsRecord)) {
      const dimension = registry.get(dynamicFieldDimensionKey(field.fieldId));
      expect(dimension).toBeDefined();
      expect(dimension?.fieldId).toBe(field.fieldId);
      expect(dimension?.fieldType).toBe(field.type);
      expect(dimension?.scope).toBe("repo");
    }
  });

  it("accepts an array-shaped dynamicFields input", () => {
    const registry = buildFilterDimensions({
      dynamicFields: [{ fieldId: 12, type: "Text String" }],
    });
    expect(registry.get("field_12")?.valueType).toBe("text");
  });

  it("skips unknown field types and non-integer field ids", () => {
    const registry = buildFilterDimensions({
      dynamicFields: [
        { fieldId: 20, type: "Attachment" },
        { fieldId: 1.5, type: "Integer" },
      ],
    });
    expect(registry.has("field_20")).toBe(false);
    expect(registry.has("field_1.5")).toBe(false);
    expect(registry.has("field_1")).toBe(false);
  });

  it("keeps the first dimension on duplicate field ids", () => {
    const registry = buildFilterDimensions({
      dynamicFields: [
        { fieldId: 30, type: "Integer" },
        { fieldId: 30, type: "Date" },
      ],
    });
    expect(registry.get("field_30")?.fieldType).toBe("Integer");
  });

  it("every registry key matches the letter-first key pattern", () => {
    const registry = buildFilterDimensions({
      includeRunDimensions: true,
      dynamicFields: dynamicFieldsRecord,
    });
    for (const key of registry.keys()) {
      expect(key).toMatch(FILTER_DIMENSION_KEY_PATTERN);
    }
  });

  it("every operator on every dimension has arity metadata", () => {
    const registry = buildFilterDimensions({
      includeRunDimensions: true,
      dynamicFields: dynamicFieldsRecord,
    });
    for (const dimension of registry.values()) {
      for (const operator of dimension.operators) {
        expect(
          getOperatorArity(operator),
          `${dimension.key}:${operator}`
        ).toBeDefined();
      }
    }
  });
});

describe("buildDynamicFieldDimension", () => {
  it("maps each field type to the spec value type and operator set", () => {
    const byType = (type: string) =>
      buildDynamicFieldDimension({ fieldId: 99, type });

    expect(byType("Dropdown")).toMatchObject({
      valueType: "options",
      operators: ["in", "any", "none"],
    });
    expect(byType("Multi-Select")).toMatchObject({
      valueType: "options",
      operators: ["in", "any", "none"],
    });
    expect(byType("Checkbox")).toMatchObject({
      valueType: "boolean",
      operators: ["is"],
    });
    expect(byType("Integer")?.operators).toEqual([
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "any",
      "none",
    ]);
    expect(byType("Number")?.valueType).toBe("number");
    expect(byType("Date")?.operators).toEqual([
      "on",
      "before",
      "after",
      "between",
      "last7",
      "last30",
      "last90",
      "thisYear",
      "any",
      "none",
    ]);
    expect(byType("Text Long")?.operators).toEqual([
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "eq",
      "any",
      "none",
    ]);
    expect(byType("Text String")?.valueType).toBe("text");
    expect(byType("Link")?.operators).toEqual([
      "contains",
      "domain",
      "startsWith",
      "endsWith",
      "eq",
      "any",
      "none",
    ]);
    // Steps has no "ne" (StepsFilterInput precedent).
    expect(byType("Steps")?.operators).toEqual([
      "eq",
      "lt",
      "lte",
      "gt",
      "gte",
      "between",
      "any",
      "none",
    ]);
  });

  it("returns null for unfilterable field types", () => {
    expect(buildDynamicFieldDimension({ fieldId: 1, type: "User" })).toBeNull();
    expect(buildDynamicFieldDimension({ fieldId: 1, type: "" })).toBeNull();
  });
});

describe("operator arity metadata", () => {
  it("matches the spec arity contract", () => {
    expect(getOperatorArity(BETWEEN_OPERATOR)).toEqual({ min: 2, max: 2 });
    for (const operator of RELATIVE_DATE_OPERATORS) {
      expect(getOperatorArity(operator)).toEqual({ min: 0, max: 0 });
    }
    expect(getOperatorArity("is")).toEqual({ min: 1, max: 1 });
    expect(getOperatorArity("in")).toEqual({ min: 1, max: null });
    expect(getOperatorArity("any")).toEqual({ min: 0, max: null });
    expect(getOperatorArity("none")).toEqual({ min: 0, max: null });
    // Bare "all" has no defined semantics — it requires at least one value.
    expect(getOperatorArity("all")).toEqual({ min: 1, max: null });
    for (const operator of [
      "eq",
      "ne",
      "lt",
      "lte",
      "gt",
      "gte",
      "on",
      "before",
      "after",
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "domain",
    ]) {
      expect(getOperatorArity(operator), operator).toEqual({ min: 1, max: 1 });
    }
  });

  it("returns undefined for unknown operators", () => {
    expect(getOperatorArity("banana")).toBeUndefined();
    expect(getOperatorArity("")).toBeUndefined();
  });

  it("has no arity entries outside the normalized vocabulary", () => {
    // Legacy tokens must NOT validate: equals→eq, hasValue→any were
    // normalized away by the spec.
    expect(OPERATOR_ARITY["equals"]).toBeUndefined();
    expect(OPERATOR_ARITY["hasValue"]).toBeUndefined();
    expect(OPERATOR_ARITY["notIn"]).toBeUndefined();
  });
});

describe("static dimension lists", () => {
  it("exposes repo dims with scope repo and run dims with scope run", () => {
    for (const dimension of REPO_STATIC_DIMENSIONS) {
      expect(dimension.scope).toBe("repo");
    }
    for (const dimension of RUN_DIMENSIONS) {
      expect(dimension.scope).toBe("run");
    }
  });
});
