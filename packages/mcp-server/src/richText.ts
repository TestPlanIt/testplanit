/**
 * Rich-text documents (Tiptap / ProseMirror JSON) rendered as Markdown.
 *
 * The host stores rich text as documents and converts Markdown written by an
 * API client back into one, so returning Markdown lets an agent read a step,
 * change it and write it back without losing its formatting. Plain-text
 * extraction dropped bold, lists, links and code on every round trip.
 *
 * Covers what the TestPlanIt editor produces: paragraphs, headings, bullet,
 * ordered and task lists, blockquotes, code blocks, rules, hard breaks,
 * images, and bold / italic / strike / code / link marks. Marks Markdown has
 * no syntax for (underline, colour) keep their text.
 */

interface PMNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: PMNode[];
}

/** A document stored as a JSON string, or `null` when the text is not one. */
function parseSerializedDoc(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const isNode = (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string";
  if (Array.isArray(parsed)) {
    return parsed.length > 0 && parsed.every(isNode) ? parsed : null;
  }
  return isNode(parsed) && (parsed as PMNode).type === "doc" ? parsed : null;
}

function renderText(node: PMNode): string {
  let text = node.text ?? "";
  if (!text) return "";
  const marks = node.marks ?? [];
  const has = (type: string) => marks.some((m) => m.type === type);
  if (has("code")) {
    const fence = text.includes("`") ? "``" : "`";
    text = `${fence}${text}${fence}`;
  } else {
    if (has("bold")) text = `**${text}**`;
    if (has("italic")) text = `*${text}*`;
    if (has("strike")) text = `~~${text}~~`;
  }
  const link = marks.find((m) => m.type === "link");
  const href = link?.attrs?.href;
  if (typeof href === "string" && href) text = `[${text}](${href})`;
  return text;
}

function renderInline(nodes: PMNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") return renderText(n);
      if (n.type === "hardBreak" || n.type === "hard_break") return "\n";
      if (n.type === "image") {
        const src = typeof n.attrs?.src === "string" ? n.attrs.src : "";
        const alt = typeof n.attrs?.alt === "string" ? n.attrs.alt : "";
        return src ? `![${alt}](${src})` : "";
      }
      return renderInline(n.content);
    })
    .join("");
}

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : prefix + line))
    .join("\n");

function renderList(node: PMNode, ordered: boolean): string {
  const start =
    typeof node.attrs?.start === "number" ? (node.attrs.start as number) : 1;
  return (node.content ?? [])
    .map((item, i) => {
      let marker = ordered ? `${start + i}. ` : "- ";
      if (item.type === "taskItem") {
        marker = `- [${item.attrs?.checked ? "x" : " "}] `;
      }
      const body = renderBlocks(item.content, "\n");
      return marker + indent(body, " ".repeat(marker.length));
    })
    .join("\n");
}

function renderBlock(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `${"#".repeat(level)} ${renderInline(node.content)}`;
    }
    case "bulletList":
    case "bullet_list":
      return renderList(node, false);
    case "orderedList":
    case "ordered_list":
      return renderList(node, true);
    case "taskList":
      return renderList(node, false);
    case "blockquote":
      return renderBlocks(node.content)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "codeBlock":
    case "code_block": {
      const lang =
        typeof node.attrs?.language === "string" ? node.attrs.language : "";
      // A code block parsed from Markdown keeps the fence's final newline.
      const code = (node.content ?? [])
        .map((n) => n.text ?? "")
        .join("")
        .replace(/\n$/, "");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "horizontalRule":
    case "horizontal_rule":
      return "---";
    case "text":
    case "hardBreak":
    case "image":
      return renderInline([node]);
    default:
      // Unknown containers (tables, custom nodes): keep their content.
      return node.content ? renderBlocks(node.content) : renderInline([node]);
  }
}

function renderBlocks(nodes: PMNode[] | undefined, separator = "\n\n"): string {
  return (nodes ?? [])
    .map(renderBlock)
    .filter((block) => block !== "")
    .join(separator);
}

/**
 * Markdown for a rich-text value in any stored shape: a document object, a
 * document serialized as a JSON string, or plain text (returned unchanged).
 * `null` / `undefined` give "".
 */
export function proseMirrorToMarkdown(value: unknown): string {
  if (value == null) return "";
  let doc: unknown = value;
  if (typeof doc === "string") {
    const parsed = parseSerializedDoc(doc);
    if (parsed === null) return doc;
    doc = parsed;
  }
  if (Array.isArray(doc)) return renderBlocks(doc as PMNode[]);
  const node = doc as PMNode;
  if (node.type === "doc") return renderBlocks(node.content);
  return renderBlock(node);
}
