import { describe, expect, it } from "vitest";
import {
  applyInlineFormatting,
  convertHtmlToTipTapJSON,
  convertMarkdownToTipTapJSON,
  convertTextToTipTapJSON,
  ensureTipTapJSON,
  isLikelyMarkdown,
  serializeTipTapJSON,
  tipTapJSONEquals,
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

/** Flatten every text node in a document, ignoring structure. */
function collectText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(collectText).join("");
}

/** The mark types carried by the text node whose text is `needle`. */
function marksOn(node: any, needle: string): string[] {
  if (!node) return [];
  if (node.type === "text" && node.text === needle) {
    return (node.marks ?? []).map((m: any) => m.type);
  }
  for (const child of node.content ?? []) {
    const found = marksOn(child, needle);
    if (found.length > 0) return found;
  }
  return [];
}

describe("applyInlineFormatting", () => {
  // The italic pattern matches the empty string between a bold span's two
  // opening asterisks. That empty <em> used to rewind the write cursor, so
  // every bold span in a paragraph had its text emitted twice with a dangling
  // "**" — reported as issue #595.
  it("does not duplicate the text of a bold span", () => {
    expect(applyInlineFormatting("must **never** open")).toBe(
      "must <strong>never</strong> open"
    );
    expect(applyInlineFormatting("set to **10 minutes** in staging")).toBe(
      "set to <strong>10 minutes</strong> in staging"
    );
  });

  it("handles bold and italic together", () => {
    expect(applyInlineFormatting("**bold** and *italic*")).toBe(
      "<strong>bold</strong> and <em>italic</em>"
    );
    expect(applyInlineFormatting("a *i* b **b** c")).toBe(
      "a <em>i</em> b <strong>b</strong> c"
    );
  });

  it("handles several bold spans in one line", () => {
    expect(applyInlineFormatting("**a** **b** **c**")).toBe(
      "<strong>a</strong> <strong>b</strong> <strong>c</strong>"
    );
  });

  it("marks a span at either end of the line", () => {
    expect(applyInlineFormatting("trailing **bold**")).toBe(
      "trailing <strong>bold</strong>"
    );
    expect(applyInlineFormatting("**leading** trailing")).toBe(
      "<strong>leading</strong> trailing"
    );
  });

  it("leaves text with no emphasis untouched", () => {
    expect(applyInlineFormatting("plain text only")).toBe("plain text only");
    // A lone asterisk is arithmetic, not emphasis.
    expect(applyInlineFormatting("snake_case and 2 * 3 = 6")).toBe(
      "snake_case and 2 * 3 = 6"
    );
  });

  it("keeps unmatched asterisks literal instead of emitting empty emphasis", () => {
    expect(applyInlineFormatting("a ** b")).toBe("a ** b");
    expect(applyInlineFormatting("**")).toBe("**");
    expect(applyInlineFormatting("****")).toBe("****");
  });

  it("escapes HTML in both marked and unmarked text", () => {
    expect(
      applyInlineFormatting("an <script>alert(1)</script> tag with **bold**")
    ).toBe(
      "an &lt;script&gt;alert(1)&lt;/script&gt; tag with <strong>bold</strong>"
    );
    expect(applyInlineFormatting("**<b>x</b>**")).toBe(
      "<strong>&lt;b&gt;x&lt;/b&gt;</strong>"
    );
  });

  it("leaves nested emphasis as literal asterisks rather than half-applying it", () => {
    // Not a parser: `*a **b** c*` has no correct single-pass answer here. The
    // outer italic is dropped rather than emitted as a partial `<em>a </em>`
    // with a dangling tail, which is what it used to produce.
    expect(applyInlineFormatting("*a **b** c*")).toBe(
      "*a <strong>b</strong> c*"
    );
    expect(applyInlineFormatting("**a *b* c**")).toBe(
      "<strong>a *b* c</strong>"
    );
  });
});

describe("emphasis is rendered the same by both conversion paths", () => {
  // ensureTipTapJSON routes on isLikelyMarkdown, which needs 2+ weak signals.
  // A description with a single bold span has one, so it takes the plain-text
  // path, while the same text in a list item has two and goes through marked.
  // Issue #595 was visible precisely because those two paths disagreed.
  it("marks a lone bold span whichever path handles it", () => {
    const viaText = convertTextToTipTapJSON("must **never** open");
    const viaMarkdown = convertMarkdownToTipTapJSON("must **never** open");

    expect(collectText(viaText)).toBe("must never open");
    expect(collectText(viaMarkdown)).toBe("must never open");
    expect(marksOn(viaText, "never")).toContain("bold");
    expect(marksOn(viaMarkdown, "never")).toContain("bold");
  });

  it("agrees on a bold span inside a list item", () => {
    const viaText = convertTextToTipTapJSON("- set to **10 minutes**");
    const viaMarkdown = convertMarkdownToTipTapJSON("- set to **10 minutes**");

    expect(collectText(viaText)).toBe("set to 10 minutes");
    expect(collectText(viaMarkdown)).toBe("set to 10 minutes");
    expect(marksOn(viaText, "10 minutes")).toContain("bold");
    expect(marksOn(viaMarkdown, "10 minutes")).toContain("bold");
  });

  it("routes a single bold span through the plain-text path", () => {
    // Documents why the two paths have to agree rather than asserting a
    // preference: one weak signal is below the markdown threshold.
    expect(isLikelyMarkdown("must **never** open")).toBe(false);
    expect(isLikelyMarkdown("- set to **10 minutes**")).toBe(true);
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

    // Assert the TEXT, not just the shape: this input duplicated the bold
    // span for a long time and the shape-only assertion never noticed.
    const text = collectText(result);
    expect(text).toBe("bold and italic");
    expect(marksOn(result, "bold")).toContain("bold");
    expect(marksOn(result, "italic")).toContain("italic");
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

describe("tipTapJSONEquals", () => {
  // The seam under test: Postgres jsonb re-orders object keys, so the
  // same document serializes differently from the DB and the editor.
  const editorOrder =
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}';
  const jsonbOrder =
    '{"content":[{"content":[{"text":"Hello","type":"text"}],"type":"paragraph"}],"type":"doc"}';

  it("treats jsonb key order and editor key order as the same document", () => {
    expect(tipTapJSONEquals(editorOrder, jsonbOrder)).toBe(true);
  });

  it("still detects a real text change", () => {
    const changed = editorOrder.replace("Hello", "Goodbye");
    expect(tipTapJSONEquals(editorOrder, changed)).toBe(false);
  });

  it("does not treat content order as insignificant", () => {
    const twoParagraphs = (first: string, second: string) =>
      JSON.stringify({
        type: "doc",
        content: [first, second].map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      });
    expect(
      tipTapJSONEquals(twoParagraphs("a", "b"), twoParagraphs("b", "a"))
    ).toBe(false);
  });

  it("treats null and the canonical empty document as equal", () => {
    expect(tipTapJSONEquals(null, serializeTipTapJSON(null))).toBe(true);
  });
});
