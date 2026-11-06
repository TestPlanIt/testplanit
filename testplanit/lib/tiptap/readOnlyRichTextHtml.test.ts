import { gitHubEmojis, shortcodeToEmoji } from "@tiptap/extension-emoji";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParameterChipMeta } from "./parameterMentionExtension";
import {
  readOnlyRichTextHtml,
  toReadOnlyDocument,
} from "./readOnlyRichTextHtml";

const text = (value: string, marks?: Array<Record<string, unknown>>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });

const PARAMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  {
    id: 2,
    name: "token",
    type: "STRING",
    defaultValue: "s3cret",
    sensitive: true,
  },
  { id: 3, name: "empty", type: "STRING", defaultValue: null },
];

const chip = (label: string) => ({
  type: "parameterMention",
  attrs: { id: label, label, paramId: 1, paramType: "STRING" },
});

describe("toReadOnlyDocument", () => {
  it("passes a document object through", () => {
    const value = doc(paragraph(text("hi")));
    expect(toReadOnlyDocument(value)).toBe(value);
  });

  it("parses the stored string form", () => {
    const value = doc(paragraph(text("hi")));
    expect(toReadOnlyDocument(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 5],
    ["an object without a type", { content: [] }],
    ["a string that is not JSON", "plain text"],
  ])("renders %s as the empty document", (_label, value) => {
    expect(toReadOnlyDocument(value)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("readOnlyRichTextHtml", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serialises the editor's marks, headings and list classes", () => {
    const html = readOnlyRichTextHtml(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
        paragraph(
          text("bold", [{ type: "bold" }]),
          text(" and "),
          text("under", [{ type: "underline" }])
        ),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph(text("one"))] }],
        }
      )
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<u>under</u>");
    expect(html).toContain('<ul class="list-disc list-outside ps-5">');
    expect(html).toContain('<li class="list-item"><p>one</p></li>');
  });

  it("renders tables with their rows and cells", () => {
    const cell = (type: string, value: string) => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [paragraph(text(value))],
    });
    const html = readOnlyRichTextHtml(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", "Head")],
          },
          { type: "tableRow", content: [cell("tableCell", "Body")] },
        ],
      })
    );
    expect(html).toMatch(/<div class="tableWrapper"><table[^>]*>/);
    expect(html).toContain("<tbody>");
    expect(html).toContain("Head");
    expect(html).toContain("<td");
    expect(html).toContain("Body");
  });

  it("keeps the stored column widths on table cells", () => {
    const html = readOnlyRichTextHtml(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: [160] },
                content: [paragraph(text("wide"))],
              },
            ],
          },
        ],
      })
    );
    expect(html).toContain('colwidth="160"');
    expect(html).toContain("width: 160px");
  });

  it("keeps links with their target and drops javascript hrefs", () => {
    const html = readOnlyRichTextHtml(
      doc(
        paragraph(
          text("docs", [
            { type: "link", attrs: { href: "https://example.com/docs" } },
          ])
        ),
        paragraph(
          text("bad", [
            { type: "link", attrs: { href: "javascript:alert(1)" } },
          ])
        )
      )
    );
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("javascript:");
  });

  it("renders parameter chips with the substituted value", () => {
    const html = readOnlyRichTextHtml(doc(paragraph(chip("username"))), {
      parameters: PARAMS,
    });
    expect(html).toContain('class="parameter-ref-chip');
    expect(html).toContain('data-value="alice"');
    expect(html).toContain("@username: alice");
    expect(html).toContain('data-undeclared="false"');
    expect(html).toContain("parameter-ref-chip-copy");
  });

  it("masks a sensitive chip and marks it revealable", () => {
    const html = readOnlyRichTextHtml(doc(paragraph(chip("token"))), {
      parameters: PARAMS,
    });
    expect(html).toContain("@token: ••••••");
    expect(html).not.toContain("@token: s3cret");
    expect(html).toContain('data-sensitive="true"');
    expect(html).toContain('data-value="s3cret"');
  });

  it("renders a chip without a value as its label alone", () => {
    const html = readOnlyRichTextHtml(doc(paragraph(chip("empty"))), {
      parameters: PARAMS,
    });
    expect(html).toContain("@empty</span>");
    expect(html).not.toContain("parameter-ref-chip-copy");
  });

  it("flags a chip for a parameter the surface does not declare", () => {
    const html = readOnlyRichTextHtml(doc(paragraph(chip("missing"))), {
      parameters: PARAMS,
    });
    expect(html).toContain('data-undeclared="true"');
    expect(html).toContain("@missing");
  });

  it("renders chips as labels when no parameters are given", () => {
    const html = readOnlyRichTextHtml(doc(paragraph(chip("username"))));
    expect(html).toContain("@username</span>");
    expect(html).toContain('data-undeclared="true"');
  });

  it("renders emoji nodes through the editor's emoji extension", () => {
    const item = shortcodeToEmoji("smile", gitHubEmojis);
    expect(item?.emoji).toBeTruthy();
    const html = readOnlyRichTextHtml(
      doc(paragraph({ type: "emoji", attrs: { name: "smile" } }))
    );
    expect(html).toContain('data-type="emoji"');
    expect(html).toContain('data-name="smile"');
    // The extension draws the character where the browser supports it and
    // the fallback image elsewhere (jsdom has no canvas, so it falls back).
    const rendersCharacter = html.includes(item!.emoji as string);
    const rendersFallback = html.includes(item!.fallbackImage as string);
    expect(rendersCharacter || rendersFallback).toBe(true);
  });

  it("renders an unknown emoji as its shortcode", () => {
    const html = readOnlyRichTextHtml(
      doc(paragraph({ type: "emoji", attrs: { name: "no_such_emoji" } }))
    );
    expect(html).toContain(":no_such_emoji:");
  });

  it("renders images and videos with their attributes", () => {
    const html = readOnlyRichTextHtml(
      doc(
        {
          type: "image",
          attrs: {
            src: "https://cdn.example.com/a.png",
            alt: "shot",
            width: "120px",
            align: "left",
          },
        },
        { type: "video", attrs: { src: "https://cdn.example.com/a.mp4" } }
      )
    );
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('alt="shot"');
    // The editor's node-view structure, so the stylesheet spaces and aligns
    // the image the same way.
    expect(html).toContain('class="react-renderer node-image"');
    expect(html).toContain("float: left; clear: left;");
    expect(html).toContain("width: 120px; height: auto;");
    expect(html).toContain("<video");
    expect(html).toContain('src="https://cdn.example.com/a.mp4"');
  });

  it("escapes text that looks like markup", () => {
    const html = readOnlyRichTextHtml(
      doc(paragraph(text("<script>alert(1)</script> & <b>x</b>")))
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("falls back to the plain serialiser for a node the schema lacks", () => {
    const html = readOnlyRichTextHtml(
      doc(paragraph(text("kept")), {
        type: "mystery",
        content: [paragraph(text("also kept"))],
      })
    );
    expect(console.warn).toHaveBeenCalled();
    expect(html).toContain("kept");
    expect(html).toContain("also kept");
  });

  it("renders the empty document for stored values that are not documents", () => {
    const emptyParagraph = '<p><br class="ProseMirror-trailingBreak"></p>';
    expect(readOnlyRichTextHtml(null)).toBe(emptyParagraph);
    expect(readOnlyRichTextHtml("not json")).toBe(emptyParagraph);
  });

  it("keeps the height of empty blocks and trailing hard breaks like the editor", () => {
    const html = readOnlyRichTextHtml(
      doc(
        paragraph(),
        paragraph(text("ends in a break"), { type: "hardBreak" }),
        { type: "heading", attrs: { level: 2 } },
        paragraph(text("filled"))
      )
    );
    expect(html).toBe(
      '<p><br class="ProseMirror-trailingBreak"></p>' +
        '<p>ends in a break<br><br class="ProseMirror-trailingBreak"></p>' +
        '<h2><br class="ProseMirror-trailingBreak"></h2>' +
        "<p>filled</p>"
    );
  });

  it("accepts the stored string form", () => {
    const html = readOnlyRichTextHtml(
      JSON.stringify(doc(paragraph(text("from string"))))
    );
    expect(html).toBe("<p>from string</p>");
  });
});
