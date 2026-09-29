import { describe, expect, it } from "vitest";
import { proseMirrorToMarkdown } from "./richText.js";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

describe("proseMirrorToMarkdown", () => {
  it("renders inline marks", () => {
    expect(
      proseMirrorToMarkdown(
        doc(
          p(
            text("Open the "),
            text("New leads", "bold"),
            text(" board, "),
            text("then", "italic"),
            text(" check "),
            text("3", "code"),
            text(" and "),
            text("old", "strike"),
          ),
        ),
      ),
    ).toBe("Open the **New leads** board, *then* check `3` and ~~old~~");
  });

  it("renders links", () => {
    expect(
      proseMirrorToMarkdown(
        doc(
          p({
            type: "text",
            text: "docs",
            marks: [{ type: "link", attrs: { href: "https://x.test/a" } }],
          }),
        ),
      ),
    ).toBe("[docs](https://x.test/a)");
  });

  it("separates paragraphs with a blank line and keeps hard breaks", () => {
    expect(
      proseMirrorToMarkdown(
        doc(
          p(text("Step 1"), { type: "hardBreak" }, text("Step 2")),
          p(text("Next")),
        ),
      ),
    ).toBe("Step 1\nStep 2\n\nNext");
  });

  it("renders lists, headings, quotes, code blocks and rules", () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Setup")] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p(text("one"))] },
            { type: "listItem", content: [p(text("two"))] },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [{ type: "listItem", content: [p(text("first"))] }],
        },
        { type: "blockquote", content: [p(text("note"))] },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [text("const a = 1;")],
        },
        { type: "horizontalRule" },
      ),
    );
    expect(md).toBe(
      [
        "## Setup",
        "- one\n- two",
        "1. first",
        "> note",
        "```ts\nconst a = 1;\n```",
        "---",
      ].join("\n\n"),
    );
  });

  it("indents nested list content under its item", () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(text("parent")),
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [p(text("child"))] }],
              },
            ],
          },
        ],
      }),
    );
    expect(md).toBe("- parent\n  - child");
  });

  it("reads a document stored as a JSON string, and leaves plain text alone", () => {
    expect(proseMirrorToMarkdown(JSON.stringify(doc(p(text("x", "bold")))))).toBe(
      "**x**",
    );
    expect(proseMirrorToMarkdown("just text")).toBe("just text");
    expect(proseMirrorToMarkdown('{"not":"a doc"}')).toBe('{"not":"a doc"}');
    expect(proseMirrorToMarkdown(null)).toBe("");
  });
});
