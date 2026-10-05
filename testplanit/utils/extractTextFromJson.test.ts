import { describe, expect, it } from "vitest";
import {
  extractTextFromNode,
  extractTextWithImageMarkers,
  extractTextWithLineBreaks,
} from "./extractTextFromJson";

describe("extractTextFromNode Utility", () => {
  it("should return empty string for null or undefined input", () => {
    expect(extractTextFromNode(null)).toBe("");
    expect(extractTextFromNode(undefined)).toBe("");
  });

  it("should return the string if the node itself is a string", () => {
    expect(extractTextFromNode("just a string")).toBe("just a string");
  });

  it("should extract text from a simple text node", () => {
    const node = { type: "text", text: "Hello World" };
    expect(extractTextFromNode(node)).toBe("Hello World");
  });

  it("should extract and join text from nested content nodes", () => {
    const node = {
      type: "paragraph",
      content: [
        { type: "text", text: "Part 1." },
        { type: "text", text: " " }, // Space node
        { type: "text", text: "Part 2." },
      ],
    };
    expect(extractTextFromNode(node)).toBe("Part 1. Part 2."); // Joined without extra spaces
  });

  it("should handle deeply nested content", () => {
    const node = {
      type: "doc",
      content: [
        {
          type: "heading",
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First sentence." },
            {
              type: "bold", // Node type doesn't matter, only text/content
              content: [{ type: "text", text: " Bold text. " }],
            },
            { type: "text", text: "Last sentence." },
          ],
        },
      ],
    };
    expect(extractTextFromNode(node)).toBe(
      "TitleFirst sentence. Bold text. Last sentence."
    );
  });

  it("should return empty string for nodes without text or content", () => {
    const node = { type: "image", attrs: { src: "..." } };
    expect(extractTextFromNode(node)).toBe("");
  });

  it("should return empty string for node with empty content array", () => {
    const node = { type: "paragraph", content: [] };
    expect(extractTextFromNode(node)).toBe("");
  });
});

describe("extractTextWithImageMarkers", () => {
  it("renders image nodes as numbered markers with recovered filenames", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "The login form:" }],
        },
        {
          type: "image",
          attrs: {
            src: "/api/storage/uploads/document-images/5/mockup.png_1753651200000_mockup.png",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Submit is disabled until valid." }],
        },
      ],
    };
    expect(extractTextWithImageMarkers(doc)).toBe(
      "The login form:\n[image 1: mockup.png]\nSubmit is disabled until valid."
    );
  });

  it("numbers data-URI images in document order", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "data:image/png;base64,AAAA" } },
        { type: "image", attrs: { src: "data:image/jpeg;base64,BBBB" } },
      ],
    };
    expect(extractTextWithImageMarkers(doc)).toBe(
      "[image 1: embedded-media-1.png]\n[image 2: embedded-media-2.jpeg]"
    );
  });

  it("keeps list structure line-separated and collapses blank runs", () => {
    const doc = {
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
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "second" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractTextWithImageMarkers(doc)).toBe("first\nsecond");
  });

  it("returns empty string for non-docs", () => {
    expect(extractTextWithImageMarkers(null)).toBe("");
    expect(extractTextWithImageMarkers("text")).toBe("");
  });
});

describe("extractTextWithLineBreaks", () => {
  const p = (...content: any[]) => ({ type: "paragraph", content });
  const t = (text: string) => ({ type: "text", text });

  it("puts each paragraph on its own line", () => {
    const doc = {
      type: "doc",
      content: [
        p(t("Scenario Outline: Build a topology")),
        p(t("Given 2-port SmartNICs")),
        p(t("| racks | x |")),
      ],
    };
    expect(extractTextWithLineBreaks(doc)).toBe(
      "Scenario Outline: Build a topology\nGiven 2-port SmartNICs\n| racks | x |"
    );
  });

  it("turns hard breaks into line breaks and keeps marks inline", () => {
    const doc = {
      type: "doc",
      content: [
        p(
          t("Given "),
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "hardBreak" },
          t("And more")
        ),
      ],
    };
    expect(extractTextWithLineBreaks(doc)).toBe("Given bold\nAnd more");
  });

  it("marks list items and indents their continuation lines", () => {
    const item = (...content: any[]) => ({ type: "listItem", content });
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            item(p(t("first"))),
            item(p(t("second")), {
              type: "bulletList",
              content: [item(p(t("nested")))],
            }),
          ],
        },
      ],
    };
    expect(extractTextWithLineBreaks(doc)).toBe(
      "1. first\n2. second\n   - nested"
    );
  });

  it("flattens tables into padded pipe rows", () => {
    const cell = (type: string, text: string) => ({
      type,
      content: [p(t(text))],
    });
    const doc = {
      type: "doc",
      content: [
        p(t("Examples:")),
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("tableHeader", "racks"), cell("tableHeader", "x")],
            },
            {
              type: "tableRow",
              content: [cell("tableCell", "2"), cell("tableCell", "24")],
            },
          ],
        },
      ],
    };
    expect(extractTextWithLineBreaks(doc)).toBe(
      "Examples:\n| racks | x  |\n| 2     | 24 |"
    );
  });

  it("collapses blank runs and returns empty for non-documents", () => {
    const doc = { type: "doc", content: [p(t("a")), p(), p(), p(), p(t("b"))] };
    expect(extractTextWithLineBreaks(doc)).toBe("a\n\nb");
    expect(extractTextWithLineBreaks(null)).toBe("");
    expect(extractTextWithLineBreaks({ type: "doc", content: [] })).toBe("");
  });
});
