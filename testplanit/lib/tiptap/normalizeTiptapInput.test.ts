import { describe, expect, it } from "vitest";
import { normalizeTiptapInput } from "./normalizeTiptapInput";

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};

describe("normalizeTiptapInput", () => {
  it("keeps a document object as-is", () => {
    expect(normalizeTiptapInput(doc)).toBe(doc);
  });

  it("parses a JSON-stringified document", () => {
    expect(normalizeTiptapInput(JSON.stringify(doc))).toEqual(doc);
  });

  it("wraps plain text as one paragraph per line, keeping blank lines", () => {
    expect(normalizeTiptapInput("first\n\nthird")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "third" }] },
      ],
    });
  });

  it("treats a string that only looks like JSON as text", () => {
    expect(normalizeTiptapInput("{not json")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "{not json" }] },
      ],
    });
  });

  it("normalizes blank, null, undefined and non-text scalars to null", () => {
    expect(normalizeTiptapInput("   ")).toBeNull();
    expect(normalizeTiptapInput(null)).toBeNull();
    expect(normalizeTiptapInput(undefined)).toBeNull();
    expect(normalizeTiptapInput(42)).toBeNull();
  });
});
