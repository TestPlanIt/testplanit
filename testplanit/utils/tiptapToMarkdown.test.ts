import { describe, it, expect } from "vitest";
import { tiptapToMarkdown } from "./tiptapToMarkdown";

describe("tiptapToMarkdown", () => {
  it("should convert a paragraph to plain text", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    expect(tiptapToMarkdown(json)).toBe("Hello world");
  });

  it("should convert bold text to markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Bold",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(json)).toBe("**Bold**");
  });

  it("should convert italic text to markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Italic",
              marks: [{ type: "italic" }],
            },
          ],
        },
      ],
    };
    expect(tiptapToMarkdown(json)).toBe("*Italic*");
  });

  it("should convert headings to markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Subtitle" }],
        },
      ],
    };
    const result = tiptapToMarkdown(json);
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
  });

  it("should convert bullet lists to markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 1" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Item 2" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = tiptapToMarkdown(json);
    expect(result).toMatch(/^-\s+Item 1/m);
    expect(result).toMatch(/^-\s+Item 2/m);
  });

  it("should convert links to markdown", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Click here",
              marks: [
                {
                  type: "link",
                  attrs: { href: "http://example.com", target: "_blank" },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = tiptapToMarkdown(json);
    expect(result).toContain("[Click here](http://example.com)");
  });

  it("should handle empty content", () => {
    const json = { type: "doc", content: [] };
    expect(tiptapToMarkdown(json)).toBe("");
  });

  it("should handle null/undefined", () => {
    expect(tiptapToMarkdown(null)).toBe("");
    expect(tiptapToMarkdown(undefined)).toBe("");
  });

  it("should handle string input (JSON string)", () => {
    const json = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "From string" }] },
      ],
    });
    expect(tiptapToMarkdown(json)).toBe("From string");
  });

  it("should return plain string for non-JSON string input", () => {
    expect(tiptapToMarkdown("Just plain text")).toBe("Just plain text");
  });
});
