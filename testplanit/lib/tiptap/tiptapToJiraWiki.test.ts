import { describe, expect, it } from "vitest";
import { tiptapToJiraWiki } from "./tiptapToJiraWiki";

const doc = (...content: any[]) => ({ type: "doc", content });
const p = (...content: any[]) => ({ type: "paragraph", content });
const text = (t: string, ...marks: any[]) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks } : {}),
});

describe("tiptapToJiraWiki", () => {
  it("rejects non-document input", () => {
    expect(() => tiptapToJiraWiki(null)).toThrow(/type === 'doc'/);
    expect(() => tiptapToJiraWiki("h1. hi")).toThrow(/type === 'doc'/);
    expect(() => tiptapToJiraWiki({ type: "paragraph" })).toThrow(
      /type === 'doc'/
    );
  });

  it("serializes paragraphs separated by blank lines", () => {
    expect(tiptapToJiraWiki(doc(p(text("first")), p(text("second"))))).toBe(
      "first\n\nsecond"
    );
  });

  describe("marks", () => {
    it("serializes TipTap mark names", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            p(
              text("b", { type: "bold" }),
              text(" "),
              text("i", { type: "italic" }),
              text(" "),
              text("u", { type: "underline" }),
              text(" "),
              text("s", { type: "strike" }),
              text(" "),
              text("m", { type: "code" })
            )
          )
        )
      ).toBe("*b* _i_ +u+ -s- {{m}}");
    });

    it("serializes ADF mark names (strong/em) identically", () => {
      expect(
        tiptapToJiraWiki(
          doc(p(text("b", { type: "strong" }), text("i", { type: "em" })))
        )
      ).toBe("*b*_i_");
    });

    it("serializes links and hardens the href against ] and |", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            p(
              text("Jira", {
                type: "link",
                attrs: { href: "https://example.com/a]b|c" },
              })
            )
          )
        )
      ).toBe("[Jira|https://example.com/a%5Db%7Cc]");
    });

    it("drops unknown marks but keeps the text", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            p(text("colored", { type: "textStyle", attrs: { color: "#f00" } }))
          )
        )
      ).toBe("colored");
    });
  });

  describe("escaping", () => {
    it("escapes wiki structure characters in plain text", () => {
      expect(tiptapToJiraWiki(doc(p(text("5*3 a_b c+d {x} [y] e|f !g"))))).toBe(
        "5\\*3 a\\_b c\\+d \\{x} \\[y] e\\|f \\!g"
      );
    });

    it("neutralizes list/heading tokens at line starts", () => {
      expect(tiptapToJiraWiki(doc(p(text("- not a list"))))).toBe(
        "\\- not a list"
      );
      expect(tiptapToJiraWiki(doc(p(text("h1. not a heading"))))).toBe(
        "\\h1. not a heading"
      );
    });

    it("emits input backslashes as entities — Jira renders \\\\ as a line break, so doubling would corrupt paths", () => {
      expect(tiptapToJiraWiki(doc(p(text("C:\\temp\\new"))))).toBe(
        "C:&#92;temp&#92;new"
      );
      // A user-typed backslash can never pair with an escape backslash
      // into an accidental forced line break.
      expect(tiptapToJiraWiki(doc(p(text("\\*not bold*"))))).toBe(
        "&#92;\\*not bold\\*"
      );
    });
  });

  describe("blocks", () => {
    it("serializes headings with clamped levels", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
            { type: "heading", attrs: { level: 9 }, content: [text("Deep")] }
          )
        )
      ).toBe("h2. Title\n\nh6. Deep");
    });

    it("serializes nested and mixed lists with marker paths", () => {
      const nested = doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p(text("top")),
              {
                type: "orderedList",
                content: [{ type: "listItem", content: [p(text("inner"))] }],
              },
            ],
          },
          { type: "listItem", content: [p(text("second"))] },
        ],
      });
      expect(tiptapToJiraWiki(nested)).toBe("* top\n*# inner\n* second");
    });

    it("serializes code blocks verbatim with a language", () => {
      expect(
        tiptapToJiraWiki(
          doc({
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [text("const a = *not bold*;")],
          })
        )
      ).toBe("{code:ts}\nconst a = *not bold*;\n{code}");
    });

    it("serializes blockquotes with the quote macro", () => {
      expect(
        tiptapToJiraWiki(
          doc({ type: "blockquote", content: [p(text("wise"))] })
        )
      ).toBe("{quote}\nwise\n{quote}");
    });

    it("serializes horizontal rules from both TipTap and ADF names", () => {
      expect(
        tiptapToJiraWiki(doc({ type: "horizontalRule" }, { type: "rule" }))
      ).toBe("----\n\n----");
    });
  });

  describe("tables", () => {
    it("serializes header and body rows", () => {
      const table = doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [p(text("Step"))] },
              { type: "tableHeader", content: [p(text("Result"))] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(text("Login"))] },
              { type: "tableCell", content: [p(text("OK"))] },
            ],
          },
        ],
      });
      expect(tiptapToJiraWiki(table)).toBe("||Step||Result||\n|Login|OK|");
    });

    it("encodes pipes and collapses newlines inside cells, and pads empty cells", () => {
      const table = doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(text("a|b\nc"))] },
              { type: "tableCell", content: [p()] },
            ],
          },
        ],
      });
      expect(tiptapToJiraWiki(table)).toBe("|a&#124;b c| |");
    });
  });

  describe("editor-specific inline nodes", () => {
    it("embeds remote images and degrades data URIs to alt text", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            p({
              type: "image",
              attrs: { src: "https://cdn.example.com/x.png" },
            }),
            p({
              type: "image",
              attrs: { src: "data:image/png;base64,AAAA", alt: "screenshot" },
            })
          )
        )
      ).toBe("!https://cdn.example.com/x.png!\n\nscreenshot");
    });

    it("renders mentions, parameter mentions, and emoji as text", () => {
      expect(
        tiptapToJiraWiki(
          doc(
            p(
              { type: "mention", attrs: { label: "@alice" } },
              text(" uses "),
              { type: "parameterMention", attrs: { label: "@env" } },
              text(" "),
              { type: "emoji", attrs: { shortName: ":rocket:" } }
            )
          )
        )
      ).toBe("@alice uses @env :rocket:");
    });
  });

  it("degrades unknown block nodes to their inline text instead of throwing", () => {
    expect(
      tiptapToJiraWiki(doc({ type: "video", content: [text("clip")] }))
    ).toBe("clip");
  });

  it("serializes the generated iteration issue body shape (paragraph + table + link)", () => {
    const body = doc(
      p(
        text("Failed in "),
        text("Run 7", { type: "link", attrs: { href: "https://tpi/run/7" } })
      ),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [p(text("Field"))] },
              { type: "tableHeader", content: [p(text("Value"))] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(text("Status"))] },
              { type: "tableCell", content: [p(text("Failed"))] },
            ],
          },
        ],
      }
    );
    expect(tiptapToJiraWiki(body)).toBe(
      "Failed in [Run 7|https://tpi/run/7]\n\n||Field||Value||\n|Status|Failed|"
    );
  });
});
