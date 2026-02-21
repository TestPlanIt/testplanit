import { describe, it, expect } from "vitest";
import {
  convertHtmlToTipTapJSON,
  convertTextToTipTapJSON,
  convertMarkdownToTipTapJSON,
  ensureTipTapJSON,
  isLikelyMarkdown,
  serializeTipTapJSON,
} from "./tiptapConversion";

describe("convertTextToTipTapJSON", () => {
  it("should convert simple text to TipTap JSON doc", () => {
    const result = convertTextToTipTapJSON("Hello World");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
    expect(result.content!.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle multiline text", () => {
    const result = convertTextToTipTapJSON("Line 1\n\nLine 2");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle empty text by returning empty doc", () => {
    const result = convertTextToTipTapJSON("");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle text with only whitespace", () => {
    const result = convertTextToTipTapJSON("   ");

    expect(result.type).toBe("doc");
  });
});

describe("convertHtmlToTipTapJSON", () => {
  it("should convert simple HTML to TipTap JSON", () => {
    const result = convertHtmlToTipTapJSON("<p>Hello World</p>");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle empty HTML", () => {
    const result = convertHtmlToTipTapJSON("");

    expect(result.type).toBe("doc");
  });

  it("should handle HTML with bold text", () => {
    const result = convertHtmlToTipTapJSON("<p><strong>Bold</strong></p>");

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle HTML with lists", () => {
    const result = convertHtmlToTipTapJSON(
      "<ul><li>Item 1</li><li>Item 2</li></ul>"
    );

    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });
});

describe("ensureTipTapJSON", () => {
  it("should return valid TipTap JSON unchanged", () => {
    const validJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };

    const result = ensureTipTapJSON(validJSON);

    expect(result).toEqual(validJSON);
  });

  it("should convert plain text to TipTap JSON", () => {
    const result = ensureTipTapJSON("Plain text");

    expect(result.type).toBe("doc");
    expect(result.content![0].type).toBe("paragraph");
    // The text content structure may vary based on TipTap's generateJSON
    expect(result.content).toBeDefined();
  });

  it("should convert JSON string to TipTap JSON", () => {
    const jsonString = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "From string" }] },
      ],
    });

    const result = ensureTipTapJSON(jsonString);

    expect(result.type).toBe("doc");
    expect(result.content![0].content![0].text).toBe("From string");
  });

  it("should handle null/undefined", () => {
    const resultNull = ensureTipTapJSON(null);
    const resultUndefined = ensureTipTapJSON(undefined);

    expect(resultNull.type).toBe("doc");
    expect(resultUndefined.type).toBe("doc");
  });

  it("should handle empty object", () => {
    const result = ensureTipTapJSON({});

    expect(result.type).toBe("doc");
  });

  it("should handle object with type but no content", () => {
    const result = ensureTipTapJSON({ type: "doc" });

    expect(result.type).toBe("doc");
  });
});

describe("serializeTipTapJSON", () => {
  it("should serialize TipTap JSON to string", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Test" }] },
      ],
    };

    const result = serializeTipTapJSON(json);

    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual(json);
  });

  it("should return empty doc for null", () => {
    const result = serializeTipTapJSON(null);
    const parsed = JSON.parse(result);

    expect(parsed.type).toBe("doc");
  });

  it("should handle already serialized string", () => {
    const jsonString = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });

    const result = serializeTipTapJSON(jsonString);

    // Should return the string as-is if it's already valid JSON
    expect(typeof result).toBe("string");
  });

  it("should convert plain text and serialize", () => {
    const result = serializeTipTapJSON("Plain text");
    const parsed = JSON.parse(result);

    expect(parsed.type).toBe("doc");
    expect(parsed.content).toBeDefined();
    expect(parsed.content[0].type).toBe("paragraph");
  });
});

describe("isLikelyMarkdown", () => {
  it("should detect markdown headings", () => {
    expect(isLikelyMarkdown("# Hello World")).toBe(true);
    expect(isLikelyMarkdown("## Section\nSome text")).toBe(true);
    expect(isLikelyMarkdown("### Sub-section")).toBe(true);
  });

  it("should detect markdown links", () => {
    expect(isLikelyMarkdown("Check [this link](http://example.com)")).toBe(
      true
    );
  });

  it("should detect markdown images", () => {
    expect(isLikelyMarkdown("![alt text](http://example.com/img.png)")).toBe(
      true
    );
  });

  it("should detect fenced code blocks", () => {
    expect(isLikelyMarkdown("```\ncode here\n```")).toBe(true);
    expect(isLikelyMarkdown("```js\nconsole.log('hi')\n```")).toBe(true);
  });

  it("should detect markdown tables", () => {
    expect(isLikelyMarkdown("| Col1 | Col2 |\n| --- | --- |")).toBe(true);
  });

  it("should detect strikethrough", () => {
    expect(isLikelyMarkdown("This is ~~deleted~~ text")).toBe(true);
  });

  it("should NOT detect plain text as markdown", () => {
    expect(isLikelyMarkdown("Just a plain sentence.")).toBe(false);
    expect(isLikelyMarkdown("Hello world")).toBe(false);
    expect(isLikelyMarkdown("This is a normal paragraph of text.")).toBe(
      false
    );
  });

  it("should require 2+ weak patterns to classify as markdown", () => {
    // Single bold is not enough
    expect(isLikelyMarkdown("Some **bold** text")).toBe(false);
    // Bold + list = markdown
    expect(isLikelyMarkdown("**bold** and\n- item 1\n- item 2")).toBe(true);
    // Bold + inline code = markdown
    expect(isLikelyMarkdown("**bold** and `code`")).toBe(true);
  });

  it("should handle empty or whitespace-only input", () => {
    expect(isLikelyMarkdown("")).toBe(false);
    expect(isLikelyMarkdown("   ")).toBe(false);
  });
});

describe("convertMarkdownToTipTapJSON", () => {
  it("should convert markdown heading to TipTap JSON", () => {
    const result = convertMarkdownToTipTapJSON("# Hello");
    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
    // Should contain a heading node
    const heading = result.content?.find((n) => n.type === "heading");
    expect(heading).toBeDefined();
  });

  it("should convert markdown bold/italic", () => {
    const result = convertMarkdownToTipTapJSON("**bold** and *italic*");
    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should convert markdown lists", () => {
    const result = convertMarkdownToTipTapJSON("- item 1\n- item 2\n- item 3");
    expect(result.type).toBe("doc");
    const bulletList = result.content?.find((n) => n.type === "bulletList");
    expect(bulletList).toBeDefined();
  });

  it("should convert markdown links", () => {
    const result = convertMarkdownToTipTapJSON("[link](http://example.com)");
    expect(result.type).toBe("doc");
    expect(result.content).toBeDefined();
  });

  it("should handle empty input", () => {
    const result = convertMarkdownToTipTapJSON("");
    expect(result.type).toBe("doc");
  });

  it("should handle complex markdown", () => {
    const md = `# Test Plan

## Prerequisites

- Node.js installed
- Database running

## Steps

1. Open the app
2. Click **Login**
3. Enter credentials`;

    const result = convertMarkdownToTipTapJSON(md);
    expect(result.type).toBe("doc");
    expect(result.content!.length).toBeGreaterThan(1);
  });
});

describe("ensureTipTapJSON with markdown", () => {
  it("should auto-detect and convert markdown with headings", () => {
    const result = ensureTipTapJSON("# Hello World\n\nSome **bold** text.");
    expect(result.type).toBe("doc");
    const heading = result.content?.find((n) => n.type === "heading");
    expect(heading).toBeDefined();
  });

  it("should still prioritize JSON over markdown", () => {
    const json = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const result = ensureTipTapJSON(json);
    expect(result.type).toBe("doc");
    expect(result.content![0].type).toBe("paragraph");
  });

  it("should still prioritize HTML over markdown", () => {
    const result = ensureTipTapJSON("<p>Hello</p>");
    expect(result.type).toBe("doc");
  });

  it("should treat non-markdown text as plain text", () => {
    const result = ensureTipTapJSON("Just a sentence.");
    expect(result.type).toBe("doc");
    expect(result.content![0].type).toBe("paragraph");
  });

  it("should detect markdown with links", () => {
    const result = ensureTipTapJSON(
      "Visit [TestPlanIt](https://testplanit.com) for details."
    );
    expect(result.type).toBe("doc");
  });
});
