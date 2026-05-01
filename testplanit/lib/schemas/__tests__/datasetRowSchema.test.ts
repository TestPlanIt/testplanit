import { describe, expect, it } from "vitest";

import {
  dataSetRowCreateSchema,
  csvImportRowSchema,
  buildRowSchemaFromParameters,
} from "~/lib/schemas/datasetRowSchema";

describe("dataSetRowCreateSchema", () => {
  it("requires dataSetId, label, rowIndex, valuesJson", () => {
    const ok = dataSetRowCreateSchema.safeParse({
      dataSetId: 1,
      label: null,
      rowIndex: 0,
      valuesJson: { x: "y" },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects missing dataSetId", () => {
    const bad = dataSetRowCreateSchema.safeParse({
      label: null,
      rowIndex: 0,
      valuesJson: {},
    });
    expect(bad.success).toBe(false);
  });

  it("accepts label as string", () => {
    const ok = dataSetRowCreateSchema.safeParse({
      dataSetId: 1,
      label: "first",
      rowIndex: 0,
      valuesJson: {},
    });
    expect(ok.success).toBe(true);
  });
});

describe("csvImportRowSchema", () => {
  it("accepts row with optional label and arbitrary values", () => {
    const ok = csvImportRowSchema.safeParse({
      label: "row1",
      values: { a: "1", b: "true" },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts missing label", () => {
    const ok = csvImportRowSchema.safeParse({ values: {} });
    expect(ok.success).toBe(true);
  });
});

describe("buildRowSchemaFromParameters", () => {
  it("rejects non-numeric value for INTEGER parameter", () => {
    const schema = buildRowSchemaFromParameters([
      {
        name: "count",
        type: "INTEGER",
        required: true,
      },
    ]);
    const bad = schema.safeParse({ count: "abc" });
    expect(bad.success).toBe(false);
  });

  it("coerces INTEGER values from string", () => {
    const schema = buildRowSchemaFromParameters([
      {
        name: "count",
        type: "INTEGER",
        required: true,
      },
    ]);
    const ok = schema.safeParse({ count: "42" });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data).toMatchObject({ count: 42 });
    }
  });

  it("rejects empty value for required parameter", () => {
    const schema = buildRowSchemaFromParameters([
      { name: "username", type: "STRING", required: true },
    ]);
    const bad = schema.safeParse({ username: "" });
    expect(bad.success).toBe(false);
  });

  it("accepts SELECT (inline) value matching allowedValuesJson", () => {
    const schema = buildRowSchemaFromParameters([
      {
        name: "env",
        type: "SELECT",
        required: true,
        allowedValuesJson: ["dev", "prod"],
      },
    ]);
    const ok = schema.safeParse({ env: "dev" });
    expect(ok.success).toBe(true);
  });

  it("rejects SELECT (inline) value not in the allowed list", () => {
    const schema = buildRowSchemaFromParameters([
      {
        name: "env",
        type: "SELECT",
        required: true,
        allowedValuesJson: ["dev", "prod"],
      },
    ]);
    const bad = schema.safeParse({ env: "staging" });
    expect(bad.success).toBe(false);
  });

  it("coerces BOOLEAN values from string 'true'/'false'", () => {
    const schema = buildRowSchemaFromParameters([
      { name: "flag", type: "BOOLEAN", required: true },
    ]);
    const okTrue = schema.safeParse({ flag: "true" });
    expect(okTrue.success).toBe(true);
    if (okTrue.success) {
      expect(okTrue.data).toMatchObject({ flag: true });
    }
    const okFalse = schema.safeParse({ flag: "false" });
    expect(okFalse.success).toBe(true);
    if (okFalse.success) {
      expect(okFalse.data).toMatchObject({ flag: false });
    }
  });

  it("treats non-required parameters as optional", () => {
    const schema = buildRowSchemaFromParameters([
      { name: "nickname", type: "STRING", required: false },
    ]);
    const ok = schema.safeParse({});
    expect(ok.success).toBe(true);
  });

  it("uses lookupAllowedValues for SELECT lookup parameters", () => {
    const schema = buildRowSchemaFromParameters([
      {
        name: "user",
        type: "SELECT",
        required: true,
        lookupAllowedValues: ["alice", "bob"],
      },
    ]);
    const ok = schema.safeParse({ user: "alice" });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ user: "carol" });
    expect(bad.success).toBe(false);
  });
});
