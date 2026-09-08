import { describe, expect, it } from "vitest";
import {
  extractTextFromNode,
  extractTextWithImageMarkers,
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
