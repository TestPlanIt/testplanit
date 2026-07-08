import { describe, expect, it } from "vitest";
import { adfToWikiMarkup } from "./jiraWikiMarkup";

// Small ADF builders so the wiki-markup expectations below read as content,
// not as nested JSON noise.
const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const text = (t: string, ...marks: string[]) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const para = (...content: any[]) => ({ type: "paragraph", content });
const li = (...content: any[]) => ({ type: "listItem", content });

describe("adfToWikiMarkup", () => {
  it("returns an empty string for empty / non-doc input", () => {
    expect(adfToWikiMarkup(null)).toBe("");
    expect(adfToWikiMarkup(undefined)).toBe("");
    expect(adfToWikiMarkup({})).toBe("");
    expect(adfToWikiMarkup(doc())).toBe("");
  });

  it("emits a plain paragraph as its text (no wrapping markup)", () => {
    expect(adfToWikiMarkup(doc(para(text("just words"))))).toBe("just words");
  });

  it("maps inline marks to wiki syntax", () => {
    expect(adfToWikiMarkup(doc(para(text("x", "strong"))))).toBe("*x*");
    expect(adfToWikiMarkup(doc(para(text("x", "em"))))).toBe("_x_");
    expect(adfToWikiMarkup(doc(para(text("x", "underline"))))).toBe("+x+");
    expect(adfToWikiMarkup(doc(para(text("x", "strike"))))).toBe("-x-");
    expect(adfToWikiMarkup(doc(para(text("x", "code"))))).toBe("{{x}}");
  });

  it("accepts raw TipTap mark names (bold/italic) as well as ADF names", () => {
    expect(adfToWikiMarkup(doc(para(text("x", "bold"))))).toBe("*x*");
    expect(adfToWikiMarkup(doc(para(text("x", "italic"))))).toBe("_x_");
  });

  it("nests multiple marks on one run (marks apply in array order)", () => {
    // strong then em wraps strong first, em outside — Jira renders either
    // nesting identically, so we just pin the deterministic output.
    expect(adfToWikiMarkup(doc(para(text("x", "strong", "em"))))).toBe("_*x*_");
  });

  it("renders a link as [text|href], and plain text when href is absent", () => {
    expect(
      adfToWikiMarkup(
        doc(
          para({
            type: "text",
            text: "site",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          })
        )
      )
    ).toBe("[site|https://example.com]");
    expect(
      adfToWikiMarkup(doc(para({ type: "text", text: "x", marks: [{ type: "link" }] })))
    ).toBe("x");
  });

  it("preserves surrounding text around a marked run", () => {
    expect(
      adfToWikiMarkup(doc(para(text("a "), text("bold", "strong"), text(" b"))))
    ).toBe("a *bold* b");
  });

  it("renders headings with the right level, clamped to h1..h6", () => {
    expect(
      adfToWikiMarkup(doc({ type: "heading", attrs: { level: 2 }, content: [text("Title")] }))
    ).toBe("h2. Title");
    expect(
      adfToWikiMarkup(doc({ type: "heading", attrs: { level: 9 }, content: [text("Deep")] }))
    ).toBe("h6. Deep");
  });

  it("renders bullet and ordered lists", () => {
    expect(
      adfToWikiMarkup(
        doc({
          type: "bulletList",
          content: [li(para(text("one"))), li(para(text("two")))],
        })
      )
    ).toBe("* one\n* two");
    expect(
      adfToWikiMarkup(
        doc({
          type: "orderedList",
          content: [li(para(text("first"))), li(para(text("second")))],
        })
      )
    ).toBe("# first\n# second");
  });

  it("renders nested and mixed lists with combined markers", () => {
    // An ordered item containing a bullet sub-list → the sub-items use the
    // combined "#*" prefix, matching Jira's own nesting syntax.
    expect(
      adfToWikiMarkup(
        doc({
          type: "orderedList",
          content: [
            li(para(text("outer")), {
              type: "bulletList",
              content: [li(para(text("inner")))],
            }),
          ],
        })
      )
    ).toBe("# outer\n#* inner");
  });

  it("renders a code block with and without a language", () => {
    expect(
      adfToWikiMarkup(
        doc({
          type: "codeBlock",
          attrs: { language: "java" },
          content: [text("int x = 1;")],
        })
      )
    ).toBe("{code:java}\nint x = 1;\n{code}");
    expect(
      adfToWikiMarkup(doc({ type: "codeBlock", content: [text("plain code")] }))
    ).toBe("{code}\nplain code\n{code}");
  });

  it("renders block quotes and horizontal rules", () => {
    expect(
      adfToWikiMarkup(doc({ type: "blockquote", content: [para(text("quoted"))] }))
    ).toBe("{quote}\nquoted\n{quote}");
    expect(adfToWikiMarkup(doc({ type: "rule" }))).toBe("----");
  });

  it("maps hard breaks to newlines within a paragraph", () => {
    expect(
      adfToWikiMarkup(doc(para(text("line one"), { type: "hardBreak" }, text("line two"))))
    ).toBe("line one\nline two");
  });

  it("renders a table with a header row (||) and body rows (|)", () => {
    expect(
      adfToWikiMarkup(
        doc({
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [para(text("A"))] },
                { type: "tableHeader", content: [para(text("B"))] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [para(text("1"))] },
                { type: "tableCell", content: [para(text("2"))] },
              ],
            },
          ],
        })
      )
    ).toBe("||A||B||\n|1|2|");
  });

  it("separates consecutive blocks with a single blank line", () => {
    expect(
      adfToWikiMarkup(
        doc(
          { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
          para(text("body"))
        )
      )
    ).toBe("h1. Title\n\nbody");
  });
});
