import { describe, expect, it } from "vitest";
import {
  convertHtmlToTipTapJSON,
  convertMarkdownToTipTapJSON,
  convertTextToTipTapJSON,
  ensureTipTapJSON,
  isLikelyMarkdown,
  serializeTipTapJSON,
} from "./tiptapConversion";
import { isJsonText } from "~/lib/utils/isJsonText";

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
    expect(isLikelyMarkdown("This is a normal paragraph of text.")).toBe(false);
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

describe("isJsonText", () => {
  it("recognizes a JSON object or array that is not a document", () => {
    expect(isJsonText('{\n  "task_id": "abc"\n}')).toBe(true);
    expect(isJsonText('  [1, 2, {"a": null}]  ')).toBe(true);
  });

  it("rejects documents, prose and broken JSON", () => {
    expect(isJsonText('{"type":"doc","content":[]}')).toBe(false);
    expect(isJsonText("Click **Save** and check [x](y)")).toBe(false);
    expect(isJsonText('{"task_id": ')).toBe(false);
    expect(isJsonText("42")).toBe(false);
  });
});

describe("ensureTipTapJSON with JSON text", () => {
  const collectText = (node: any): string[] =>
    node.type === "text"
      ? [node.text]
      : (node.content ?? []).flatMap(collectText);
  const collectMarks = (node: any): string[] => [
    ...(node.marks ?? []).map((m: any) => m.type),
    ...(node.content ?? []).flatMap(collectMarks),
  ];

  it("keeps JSON verbatim instead of reading it as markdown", () => {
    const text = [
      "{",
      '  "glob": "*.png or *.jpg",',
      '  "note": "**not bold** and [not a link](https://x.y)",',
      '  "steps": "- not a list"',
      "}",
    ].join("\n");

    const doc = ensureTipTapJSON(text);

    expect(doc.type).toBe("doc");
    expect(doc.content?.every((n) => n.type === "paragraph")).toBe(true);
    expect(collectMarks(doc)).toEqual([]);
    // One text node per line, indentation included, joined by hard breaks.
    expect(collectText(doc)).toEqual(text.split("\n"));
  });

  it("normalizes CRLF line endings from spreadsheet cells", () => {
    const doc = ensureTipTapJSON('{\r\n  "a": 1\r\n}');
    expect(collectText(doc)).toEqual(["{", '  "a": 1', "}"]);
  });

  it("still returns a serialized document as the document itself", () => {
    const serialized = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    });
    expect(ensureTipTapJSON(serialized)).toEqual(JSON.parse(serialized));
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
