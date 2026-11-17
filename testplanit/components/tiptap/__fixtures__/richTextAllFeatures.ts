import type { JSONContent } from "@tiptap/core";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

/**
 * One document that uses every node and mark the editor can store, for
 * checking that the static read-only renderer paints what the read-only
 * editor paints (ReadOnlyRichText.parity.test.tsx and the browser
 * side-by-side). Keep every feature here when the editor gains one.
 */

const text = (
  value: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
): JSONContent => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  ...(content.length ? { content } : {}),
});
const heading = (level: number, value: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const listItem = (...content: JSONContent[]): JSONContent => ({
  type: "listItem",
  content,
});
const chip = (label: string): JSONContent => ({
  type: "parameterMention",
  attrs: { id: label, label, paramId: 1, paramType: "STRING" },
});
const cell = (
  type: "tableCell" | "tableHeader",
  content: JSONContent[],
  attrs: Record<string, unknown> = {}
): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
  content,
});

/** A 1x1 image so screenshots do not depend on the network. */
export const FIXTURE_IMAGE_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#6366f1"/><text x="80" y="52" font-size="20" text-anchor="middle" fill="white">image</text></svg>'
  );

export const RICH_TEXT_FIXTURE_PARAMETERS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  {
    id: 2,
    name: "token",
    type: "STRING",
    defaultValue: "s3cret-value",
    sensitive: true,
  },
  { id: 3, name: "empty", type: "STRING", defaultValue: null },
];

export const RICH_TEXT_ALL_FEATURES: JSONContent = {
  type: "doc",
  content: [
    heading(1, "Heading one"),
    heading(2, "Heading two"),
    heading(3, "Heading three"),
    paragraph(
      text("Plain, "),
      text("bold", [{ type: "bold" }]),
      text(", "),
      text("italic", [{ type: "italic" }]),
      text(", "),
      text("struck", [{ type: "strike" }]),
      text(", "),
      text("underlined", [{ type: "underline" }]),
      text(", "),
      text("inline code", [{ type: "code" }]),
      text(", "),
      text("coloured", [{ type: "textStyle", attrs: { color: "#b91c1c" } }]),
      text(", "),
      text("bold italic link", [
        { type: "bold" },
        { type: "italic" },
        { type: "link", attrs: { href: "https://example.com/docs" } },
      ]),
      text(" and a line"),
      { type: "hardBreak" },
      text("break with an emoji "),
      { type: "emoji", attrs: { name: "rocket" } },
      text(" and an emoticon "),
      { type: "emoji", attrs: { name: "smile" } },
      text(".")
    ),
    paragraph(
      text("Chips: "),
      chip("username"),
      text(" sensitive "),
      chip("token"),
      text(" no value "),
      chip("empty"),
      text(" undeclared "),
      chip("missing"),
      text(".")
    ),
    {
      type: "bulletList",
      content: [
        listItem(paragraph(text("First bullet"))),
        listItem(paragraph(text("Second bullet with a nested list")), {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            listItem(paragraph(text("Nested third"))),
            listItem(paragraph(text("Nested fourth"))),
          ],
        }),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        listItem(paragraph(text("Ordered one"))),
        listItem(paragraph(text("Ordered two"))),
      ],
    },
    {
      type: "blockquote",
      content: [paragraph(text("A quoted paragraph."))],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const answer = 42;\nexport default answer;")],
    },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", [paragraph(text("Column A"))], {
              colwidth: [160],
            }),
            cell("tableHeader", [paragraph(text("Column B"))]),
            cell("tableHeader", [paragraph(text("Column C"))]),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", [paragraph(text("spans two columns"))], {
              colspan: 2,
            }),
            cell("tableCell", [paragraph(text("spans two rows"))], {
              rowspan: 2,
            }),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", [paragraph(text("a1", [{ type: "bold" }]))]),
            cell("tableCell", [
              paragraph(text("b1")),
              paragraph(text("second paragraph")),
            ]),
          ],
        },
      ],
    },
    {
      type: "image",
      attrs: {
        src: FIXTURE_IMAGE_SRC,
        alt: "centered image",
        title: "centered",
        width: "160px",
        align: "center",
      },
    },
    paragraph(text("Text after the centered image.")),
    {
      type: "image",
      attrs: {
        src: FIXTURE_IMAGE_SRC,
        alt: "left image",
        title: "left",
        width: "120px",
        height: "68px",
        align: "left",
        rotation: "15",
      },
    },
    paragraph(
      text(
        "Text that wraps beside the floated image when the surface is wide enough to show it floating to the left of the paragraph."
      )
    ),
    {
      type: "video",
      attrs: { src: "https://example.invalid/clip.mp4" },
    },
    paragraph(),
    paragraph(text("The paragraph above is empty.")),
  ],
};
