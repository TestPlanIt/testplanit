import { describe, it, expect } from "vitest";
import { extractTextFromNode } from "./extractTextFromJson";

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
