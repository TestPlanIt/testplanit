import { describe, expect, it } from "vitest";
import { stripHtmlTags } from "./stripHtmlTags";

describe("stripHtmlTags", () => {
  it("returns empty string for null/undefined/empty input", () => {
    expect(stripHtmlTags(null)).toBe("");
    expect(stripHtmlTags(undefined)).toBe("");
    expect(stripHtmlTags("")).toBe("");
  });

  it("strips HTML tags", () => {
    expect(stripHtmlTags("<p>Hello <strong>world</strong></p>")).toBe(
      "Hello world"
    );
  });

  it("decodes HTML entities", () => {
    expect(
      stripHtmlTags(
        "&#39;Up&#39; control doesn&#39;t close &quot;LEP&quot; &amp; more"
      )
    ).toBe("'Up' control doesn't close \"LEP\" & more");
    expect(stripHtmlTags("a&nbsp;b &lt;tag&gt;")).toBe("a b <tag>");
  });

  it("preserves inner whitespace and trims the ends", () => {
    expect(stripHtmlTags("  line one\nline two  ")).toBe("line one\nline two");
  });
});
