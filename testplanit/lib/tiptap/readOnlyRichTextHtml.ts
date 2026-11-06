import { getHTMLFromFragment, getSchema, type JSONContent } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { Link } from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import type { Schema } from "@tiptap/pm/model";
import DOMPurify from "dompurify";

import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "~/app/extensions/Table";
import { ImageWithResize } from "~/components/tiptap/ImageWithResize";
import { Video } from "~/components/tiptap/video";
import { emptyEditorContent } from "~/app/constants";
import { emojiExtension } from "./emojiExtension";
import {
  createParameterMentionExtension,
  type ParameterChipMeta,
  type ParameterMentionMessages,
} from "./parameterMentionExtension";
import { generateHTMLFallback } from "~/utils/tiptapToHtml";

/**
 * Static HTML for stored TipTap documents that are only ever displayed.
 *
 * A read-only `TipTapEditor` still builds a full ProseMirror view with the
 * complete extension set (menus, emoji picker, uploads, markdown paste) for
 * every step it shows, which is what made the Add Result dialog freeze on
 * cases with many steps. This module serialises the same document through the
 * same node and mark `renderHTML` definitions, so the output matches what the
 * editor would paint, without creating an editor.
 *
 * Node views do not take part in serialisation: tables are covered by the
 * table extension's `renderHTML` (the resize grips never show read-only) and
 * images by StaticImage below. Client-only, like the editor: the serialiser
 * needs a document and the sanitiser a window, so the server renders nothing
 * and the content appears on hydration.
 * components/tiptap/ReadOnlyRichText.parity.test.tsx renders one document
 * both ways and diffs the markup.
 */

/**
 * Images: the editor paints every image through a node view that nests the
 * <img> in alignment and rotation wrappers (components/tiptap/ImageWithResize.tsx),
 * and the editor stylesheet spaces the node-view container. Serialising the
 * same structure keeps the static image in the same place at the same size.
 */
const StaticImage = ImageWithResize.extend({
  renderHTML({ node }) {
    const align = String(node.attrs.align ?? "center");
    const rotation = String(node.attrs.rotation ?? "0");
    const wrapperStyle =
      align === "center"
        ? "white-space: normal; display: flex; justify-content: center; width: 100%; clear: both;"
        : align === "left"
          ? "white-space: normal; float: left; clear: left; margin-right: 1rem;"
          : align === "right"
            ? "white-space: normal; float: right; clear: right; margin-left: 1rem;"
            : "white-space: normal;";
    const rotateStyle =
      rotation && rotation !== "0"
        ? `transform: rotate(${rotation}deg); transition: transform 0.2s ease; display: inline-block;`
        : "transition: transform 0.2s ease; display: inline-block;";
    const imageStyle = `width: ${node.attrs.width || "auto"}; height: ${node.attrs.height || "auto"}; max-width: 100%; display: block;`;
    return [
      "div",
      { class: "react-renderer node-image" },
      [
        "div",
        {
          class: "relative",
          style: wrapperStyle,
          "data-node-view-wrapper": "",
        },
        [
          "div",
          { class: "relative group inline-block" },
          [
            "div",
            { style: rotateStyle },
            [
              "img",
              {
                alt: node.attrs.alt || "",
                title: node.attrs.title || "",
                style: imageStyle,
                draggable: "false",
                src: node.attrs.src,
              },
            ],
          ],
        ],
      ],
    ];
  },
});

/**
 * Tables: the editor's table view wraps the table in a container that the
 * stylesheet spaces (and that holds the resize grips, which never show
 * read-only); the same wrapper keeps the static table where the editor's is.
 */
const StaticTable = Table.extend({
  renderHTML(props) {
    return ["div", { class: "tableWrapper" }, this.parent?.(props)];
  },
});

/** Everything that does not depend on the parameters of the viewed case. */
const STATIC_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: { HTMLAttributes: { class: "list-disc list-outside ps-5" } },
    orderedList: {
      HTMLAttributes: { class: "list-decimal list-outside ps-5" },
    },
    listItem: { HTMLAttributes: { class: "list-item" } },
    link: false,
    underline: false,
  }),
  Underline,
  Link.configure({ openOnClick: false }),
  StaticImage.configure({ inline: false, allowBase64: true }),
  Video,
  Color,
  TextStyle,
  emojiExtension,
  StaticTable,
  TableRow,
  TableCell,
  TableHeader,
];

const NO_PARAMETERS: ParameterChipMeta[] = [];

interface CachedSchema {
  messagesKey: string | undefined;
  schema: Schema;
}

/**
 * One schema per parameter list. Building a schema resolves every extension
 * and compiles the ProseMirror node specs, which is far more than rendering a
 * step costs, and a case with twenty steps shows forty read-only documents
 * that all share one parameter list. The chip messages are baked into the
 * parameter node, so the translated strings are part of the key too; the
 * messages object itself may be rebuilt on every render by the caller.
 */
const schemaCache = new WeakMap<ParameterChipMeta[], CachedSchema>();

function getReadOnlySchema(
  parameters: ParameterChipMeta[] | undefined,
  messages: ParameterMentionMessages | undefined
): Schema {
  const key = parameters ?? NO_PARAMETERS;
  const messagesKey = messages
    ? `${messages.clickToReveal}\u0000${messages.copyValue}`
    : undefined;
  const cached = schemaCache.get(key);
  if (cached && cached.messagesKey === messagesKey) return cached.schema;
  const schema = getSchema([
    ...STATIC_EXTENSIONS,
    createParameterMentionExtension(key, messages, { withSuggestion: false }),
  ]);
  schemaCache.set(key, { messagesKey, schema });
  return schema;
}

/**
 * Attributes the editor serialises that DOMPurify does not allow by default:
 * `target` on links and `colwidth` on table cells (the stored column width,
 * which the table extension reads back when the document is edited again).
 * `data-*` attributes, which chips and emoji use, are allowed by default.
 */
const SANITIZE_OPTIONS = { ADD_ATTR: ["target", "colwidth"] };

export interface ReadOnlyRichTextHtmlOptions {
  parameters?: ParameterChipMeta[];
  messages?: ParameterMentionMessages;
}

/**
 * The document a read-only surface shows for a stored value: the JSON object,
 * its string form, or an empty document for anything else, as the editor does.
 */
export function toReadOnlyDocument(content: unknown): JSONContent {
  let value = content;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return emptyEditorContent;
    }
  }
  if (!value || typeof value !== "object" || !("type" in value)) {
    return emptyEditorContent;
  }
  return value as JSONContent;
}

const TEXTBLOCK_TAGS = "p, h1, h2, h3, h4, h5, h6, pre > code";

/**
 * ProseMirror gives every empty text block, and every one that ends in a
 * hard break, a trailing <br> so the line keeps its height; without it an
 * empty paragraph collapses and everything below it moves up.
 */
function withTrailingBreaks(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll(TEXTBLOCK_TAGS).forEach((block) => {
    const last = block.lastChild;
    const endsInBreak =
      last instanceof Element &&
      last.tagName === "BR" &&
      !last.classList.contains("ProseMirror-trailingBreak");
    if (block.childNodes.length === 0 || endsInBreak) {
      const br = document.createElement("br");
      br.className = "ProseMirror-trailingBreak";
      block.appendChild(br);
    }
  });
  return template.innerHTML;
}

/**
 * Sanitised HTML for a stored TipTap document. Accepts the JSON object, its
 * string form, or anything else (rendered as an empty document, like the
 * editor does). A document the schema cannot represent, such as one with a
 * node type the editor never registered, falls back to the plain serialiser
 * in utils/tiptapToHtml, which keeps the text where the editor would have
 * shown nothing.
 */
export function readOnlyRichTextHtml(
  content: unknown,
  options: ReadOnlyRichTextHtmlOptions = {}
): string {
  if (typeof document === "undefined") return "";
  const doc = toReadOnlyDocument(content);
  let html: string;
  try {
    const schema = getReadOnlySchema(options.parameters, options.messages);
    html = withTrailingBreaks(
      getHTMLFromFragment(schema.nodeFromJSON(doc).content, schema)
    );
  } catch (error) {
    console.warn("Read-only rich text could not be rendered:", error);
    html = generateHTMLFallback(doc);
  }
  return DOMPurify.sanitize(html, SANITIZE_OPTIONS);
}
