import { describe, expect, it } from "vitest";

import { DbNull } from "@zenstackhq/orm";

import { normalizeRichTextWrite, RICH_TEXT_COLUMNS } from "./richTextColumns";

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Open the page" }] },
  ],
};

describe("normalizeRichTextWrite", () => {
  it("parses a document the web UI serialized before writing", () => {
    const args = { data: { step: JSON.stringify(doc), order: 0 } };
    normalizeRichTextWrite("Steps", args);
    expect(args.data.step).toEqual(doc);
    // Untouched columns keep their value and type.
    expect(args.data.order).toBe(0);
  });

  it("leaves a document object alone", () => {
    const args = { data: { step: doc } };
    normalizeRichTextWrite("Steps", args);
    expect(args.data.step).toBe(doc);
  });

  it("wraps genuine plain text into a document", () => {
    // 604 Steps rows hold plain text rather than a serialized document.
    const args: any = { data: { step: "Access the prioritization view." } };
    normalizeRichTextWrite("Steps", args);
    expect(args.data.step.type).toBe("doc");
    expect(JSON.stringify(args.data.step)).toContain(
      "Access the prioritization view."
    );
  });

  it("keeps null and undefined, which mean cleared rather than empty", () => {
    const args: any = { data: { step: null, expectedResult: undefined } };
    normalizeRichTextWrite("Steps", args);
    expect(args.data.step).toBeNull();
    expect(args.data.expectedResult).toBeUndefined();
  });

  it("passes the DbNull sentinel through untouched", () => {
    const args: any = { data: { expectedResult: DbNull } };
    normalizeRichTextWrite("Steps", args);
    expect(args.data.expectedResult).toBe(DbNull);
  });

  it("normalizes every row of a createMany array", () => {
    const args: any = {
      data: [{ step: JSON.stringify(doc) }, { step: doc }, { step: null }],
    };
    normalizeRichTextWrite("Steps", args);
    expect(args.data[0].step).toEqual(doc);
    expect(args.data[1].step).toBe(doc);
    expect(args.data[2].step).toBeNull();
  });

  it("normalizes both branches of an upsert", () => {
    const args: any = {
      create: { step: JSON.stringify(doc) },
      update: { step: JSON.stringify(doc) },
    };
    normalizeRichTextWrite("Steps", args);
    expect(args.create.step).toEqual(doc);
    expect(args.update.step).toEqual(doc);
  });

  it("normalizes a value nested in a set expression", () => {
    const args: any = { data: { note: { set: JSON.stringify(doc) } } };
    normalizeRichTextWrite("Sessions", args);
    expect(args.data.note.set).toEqual(doc);
  });

  it("ignores models with no rich-text columns", () => {
    const args: any = { data: { name: JSON.stringify(doc) } };
    normalizeRichTextWrite("Projects", args);
    expect(args.data.name).toBe(JSON.stringify(doc));
  });

  it("ignores the polymorphic field-value columns, which need the field type", () => {
    // A Text String field legitimately stores a plain string and a Number
    // field a number; only the field's type says whether the value is a
    // document, so these are normalized by the field editors instead.
    expect(RICH_TEXT_COLUMNS.CaseFieldValues).toBeUndefined();
    expect(RICH_TEXT_COLUMNS.ResultFieldValues).toBeUndefined();
    expect(RICH_TEXT_COLUMNS.SessionFieldValues).toBeUndefined();

    const args: any = { data: { value: "plain string" } };
    normalizeRichTextWrite("CaseFieldValues", args);
    expect(args.data.value).toBe("plain string");
  });

  it("tolerates a write with no data at all", () => {
    expect(() => normalizeRichTextWrite("Steps", {})).not.toThrow();
    expect(() => normalizeRichTextWrite("Steps", undefined)).not.toThrow();
  });
});
