import { describe, expect, it } from "vitest";

import {
  buildIterationOverrideSchema,
  type OverrideParameterSchemaEntry,
} from "./iterationOverrideSchema";

describe("buildIterationOverrideSchema", () => {
  it("validates STRING required and rejects empty", () => {
    const schema = buildIterationOverrideSchema([
      { name: "username", type: "STRING", required: true },
    ]);
    expect(schema.safeParse({ username: "alice" }).success).toBe(true);
    expect(schema.safeParse({ username: "" }).success).toBe(false);
  });

  it("STRING optional treats empty string as null", () => {
    const schema = buildIterationOverrideSchema([
      { name: "nickname", type: "STRING", required: false },
    ]);
    const r = schema.safeParse({ nickname: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nickname).toBeNull();
    }
  });

  it("INTEGER coerces numeric strings", () => {
    const schema = buildIterationOverrideSchema([
      { name: "n", type: "INTEGER", required: true },
    ]);
    const r = schema.safeParse({ n: "42" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.n).toBe(42);
    }
    expect(schema.safeParse({ n: "abc" }).success).toBe(false);
  });

  it("BOOLEAN coerces truthy/falsy", () => {
    const schema = buildIterationOverrideSchema([
      { name: "flag", type: "BOOLEAN", required: true },
    ]);
    expect(schema.safeParse({ flag: "true" }).data?.flag).toBe(true);
    expect(schema.safeParse({ flag: "" }).data?.flag).toBe(false);
  });

  it("SELECT rejects values not in allowedValues", () => {
    const params: OverrideParameterSchemaEntry[] = [
      {
        name: "env",
        type: "SELECT",
        required: true,
        allowedValues: ["dev", "stage", "prod"],
      },
    ];
    const schema = buildIterationOverrideSchema(params);
    expect(schema.safeParse({ env: "stage" }).success).toBe(true);
    expect(schema.safeParse({ env: "qa" }).success).toBe(false);
  });

  it("SELECT optional with empty string becomes null", () => {
    const schema = buildIterationOverrideSchema([
      {
        name: "env",
        type: "SELECT",
        required: false,
        allowedValues: ["dev", "prod"],
      },
    ]);
    const r = schema.safeParse({ env: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.env).toBeNull();
  });
});
