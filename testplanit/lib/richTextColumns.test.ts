import { describe, expect, it, vi } from "vitest";

import { DbNull } from "@zenstackhq/orm";

import {
  type FieldTypeReader,
  normalizeRichTextWrite,
  normalizeTextLongFieldValueWrite,
  RICH_TEXT_COLUMNS,
} from "./richTextColumns";

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

describe("normalizeRichTextWrite with Markdown step text", () => {
  // Issue #658: the MCP server sends step text as written.
  it("converts Markdown to marks", () => {
    const args: any = { data: { step: "Open the **New leads** board" } };
    normalizeRichTextWrite("Steps", args);
    const [paragraph] = args.data.step.content;
    const bold = paragraph.content.find((n: any) => n.text === "New leads");
    expect(bold.marks).toEqual([{ type: "bold" }]);
  });
});

describe("normalizeTextLongFieldValueWrite", () => {
  const TEXT_LONG = 7;
  const TEXT_STRING = 8;

  const makeReader = (rowFieldId: number | null = null) => {
    const reader = {
      caseFields: {
        findMany: vi.fn(async ({ where }: any) =>
          [
            { id: TEXT_LONG, type: { type: "Text Long" } },
            { id: TEXT_STRING, type: { type: "Text String" } },
          ].filter((f) => where.id.in.includes(f.id))
        ),
      },
      caseFieldValues: {
        findFirst: vi.fn(async () =>
          rowFieldId === null ? null : { fieldId: rowFieldId }
        ),
      },
    };
    return reader as typeof reader & FieldTypeReader;
  };

  const parse = (value: unknown) => JSON.parse(value as string);

  it("stores Markdown written to a Text Long field as a serialized document", async () => {
    const reader = makeReader();
    const args: any = {
      data: {
        testCase: { connect: { id: 1 } },
        field: { connect: { id: TEXT_LONG } },
        value: "Created by the **beta** MCP.",
      },
    };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "create",
      args,
      reader
    );

    const stored = parse(args.data.value);
    expect(stored.type).toBe("doc");
    const bold = stored.content[0].content.find((n: any) => n.text === "beta");
    expect(bold.marks).toEqual([{ type: "bold" }]);
  });

  it("leaves a serialized document byte-identical", async () => {
    const serialized = JSON.stringify(doc);
    const args: any = { data: { fieldId: TEXT_LONG, value: serialized } };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "create",
      args,
      makeReader()
    );
    expect(args.data.value).toBe(serialized);
  });

  it("leaves other field types alone", async () => {
    const args: any = { data: { fieldId: TEXT_STRING, value: "**raw**" } };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "create",
      args,
      makeReader()
    );
    expect(args.data.value).toBe("**raw**");
  });

  it("runs no lookup when no row carries text", async () => {
    const reader = makeReader(TEXT_LONG);
    const args: any = {
      data: [
        { fieldId: TEXT_LONG, value: 3 },
        { fieldId: TEXT_LONG, value: "  " },
        { fieldId: TEXT_LONG, value: doc },
      ],
    };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "createMany",
      args,
      reader
    );
    expect(reader.caseFields.findMany).not.toHaveBeenCalled();
    expect(reader.caseFieldValues.findFirst).not.toHaveBeenCalled();
    expect(args.data[2].value).toBe(doc);
  });

  it("converts only the Text Long rows of a createMany, in one lookup", async () => {
    const reader = makeReader();
    const args: any = {
      data: [
        { testCaseId: 1, fieldId: TEXT_LONG, value: "Line with `code`" },
        { testCaseId: 1, fieldId: TEXT_STRING, value: "Line with `code`" },
      ],
    };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "createMany",
      args,
      reader
    );
    expect(reader.caseFields.findMany).toHaveBeenCalledTimes(1);
    expect(parse(args.data[0].value).type).toBe("doc");
    expect(args.data[1].value).toBe("Line with `code`");
  });

  it("finds the field of an update from the row it targets", async () => {
    const reader = makeReader(TEXT_LONG);
    const args: any = { where: { id: 42 }, data: { value: "- a\n- b" } };
    await normalizeTextLongFieldValueWrite(
      "CaseFieldValues",
      "update",
      args,
      reader
    );
    expect(reader.caseFieldValues.findFirst).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { fieldId: true },
    });
    expect(parse(args.data.value).content[0].type).toBe("bulletList");
  });

  it("ignores other models", async () => {
    const reader = makeReader();
    const args: any = { data: { fieldId: TEXT_LONG, value: "**x**" } };
    await normalizeTextLongFieldValueWrite(
      "ResultFieldValues",
      "create",
      args,
      reader
    );
    expect(args.data.value).toBe("**x**");
    expect(reader.caseFields.findMany).not.toHaveBeenCalled();
  });
});
