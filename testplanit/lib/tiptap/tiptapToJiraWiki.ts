// TipTap-doc → Jira wiki markup serializer for Jira Server / Data Center.
//
// Jira Cloud (REST v3) takes rich text as Atlassian Document Format; Jira
// Server / Data Center (REST v2) takes wiki markup STRINGS — sending ADF
// JSON to a v2 endpoint fails with HTTP 400. This is the Server-side
// sibling of tiptapToMarkdown.ts (same pure-visitor design: no DOM, no
// I/O, safe in API routes and workers).
//
// Two deliberate differences from tiptapToMarkdown:
//
// 1. It also accepts ADF-shaped documents. TipTap and ADF share the same
//    structural tree (`{ type, content, marks, text }`) and differ only in
//    a few names (bold/strong, italic/em, horizontalRule/rule), so one
//    visitor handles both vocabularies. JiraAdapter feeds it either the
//    raw TipTap doc or the output of its HTML→ADF converter.
//
// 2. It is lenient. tiptapToMarkdown throws on unknown nodes because its
//    only input is a machine-built body; this serializer receives
//    free-form editor content (emoji, images, mentions, video…), and a
//    node the serializer doesn't know must degrade to its text content —
//    not fail the whole create-issue flow. That matches how the existing
//    TipTap→ADF conversion behaves on the Cloud path.

interface WikiMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface WikiNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WikiNode[];
  marks?: WikiMark[];
  text?: string;
}

// ── Escaping ──────────────────────────────────────────────────────────
// Jira's text-formatting notation escapes special characters with a
// backslash. Escape the characters that OPEN inline structures (`*bold*`,
// `_em_`, `+ins+`, `^sup^`, `~sub~`, `{{mono}}`/`{macro}`, `[link]`,
// `!image!`, `|table`) so adversarial text cannot inject markup. `-`
// (strike) and `#`/`*` (list markers) are only structural at word/line
// boundaries and escaping them globally mangles ordinary prose, so they
// are handled positionally below.

const WIKI_ESCAPE_RE = /([*_+^~{\[!|])/g;

function escapeWiki(text: string): string {
  // Backslash goes first, and NOT as a backslash escape: Jira wiki renders
  // `\\` as a forced line break, so doubling would corrupt text like
  // `C:\path`. Emit it as an HTML entity instead (Jira's renderer resolves
  // entities — same trick as the table-cell pipes). Replacing it before
  // the general escape also guarantees an input backslash can never pair
  // with an escape backslash added below into an accidental `\\`.
  return text.replace(/\\/g, "&#92;").replace(WIKI_ESCAPE_RE, "\\$1");
}

// A line that STARTS with a list marker / heading / quote token would be
// parsed structurally by Jira; neutralize the leading token.
const LINE_START_TOKEN_RE = /^([#\-]+\s|h[1-6]\.\s|bq\.\s)/;

function escapeLineStart(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(LINE_START_TOKEN_RE, "\\$1"))
    .join("\n");
}

// Table cells collapse newlines (a raw newline ends the row) and encode
// pipes as an HTML entity — Jira's wiki renderer resolves entities, and a
// backslash-escaped pipe is not reliable inside table syntax. Pipes are
// replaced before the general escape so they don't pick up a backslash.
function escapeForTableCell(text: string): string {
  return escapeWiki(text.replace(/\|/g, "&#124;")).replace(/\n+/g, " ");
}

// ── Text + marks ──────────────────────────────────────────────────────
// Both TipTap mark names (bold/italic) and ADF mark names (strong/em) are
// accepted; unknown marks drop styling but keep the text.

function applyMark(text: string, mark: WikiMark): string {
  switch (mark.type) {
    case "link": {
      const rawHref = String(mark.attrs?.href ?? "");
      let href: string;
      try {
        href = encodeURI(rawHref);
      } catch {
        href = rawHref;
      }
      // `]` or `|` inside the href would close the link span early.
      href = href.replace(/\]/g, "%5D").replace(/\|/g, "%7C");
      return `[${text}|${href}]`;
    }
    case "code":
      return `{{${text}}}`;
    case "bold":
    case "strong":
      return `*${text}*`;
    case "italic":
    case "em":
      return `_${text}_`;
    case "underline":
      return `+${text}+`;
    case "strike":
      return `-${text}-`;
    default:
      return text;
  }
}

function serializeText(node: WikiNode, cellContext: boolean): string {
  const raw = node.text ?? "";
  let out = cellContext ? escapeForTableCell(raw) : escapeWiki(raw);
  for (const mark of node.marks ?? []) {
    out = applyMark(out, mark);
  }
  return out;
}

// ── Inline children ───────────────────────────────────────────────────

function serializeInline(
  nodes: WikiNode[] | undefined,
  cellContext: boolean
): string {
  if (!nodes || nodes.length === 0) return "";
  const parts: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        parts.push(serializeText(n, cellContext));
        break;
      case "hardBreak":
        parts.push(cellContext ? " " : "\n");
        break;
      case "image": {
        // Jira wiki embeds remote images as !url!. Inline base64 images
        // (the editor stores pasted images as data: URIs) cannot be
        // embedded in wiki markup — fall back to the alt text.
        const src = String(n.attrs?.src ?? "");
        const alt = String(n.attrs?.alt ?? n.attrs?.title ?? "image");
        parts.push(/^https?:\/\//i.test(src) ? `!${src}!` : escapeWiki(alt));
        break;
      }
      case "emoji":
        parts.push(
          escapeWiki(String(n.attrs?.shortName ?? n.attrs?.text ?? ""))
        );
        break;
      case "mention":
      case "parameterMention":
        parts.push(
          escapeWiki(
            String(
              n.attrs?.text ?? n.attrs?.label ?? n.attrs?.displayName ?? ""
            )
          )
        );
        break;
      default:
        // Unknown inline node — keep whatever text it carries.
        if (n.text)
          parts.push(
            cellContext ? escapeForTableCell(n.text) : escapeWiki(n.text)
          );
        else if (n.content) parts.push(serializeInline(n.content, cellContext));
        break;
    }
  }
  return parts.join("");
}

// ── Lists ─────────────────────────────────────────────────────────────
// Jira nests lists by repeating markers: `*` / `**` for bullets, `#` /
// `##` for numbered, and mixed paths like `*#` for a numbered list inside
// a bullet item. `prefix` accumulates the marker path.

function serializeListItems(list: WikiNode, prefix: string): string {
  const marker = list.type === "orderedList" ? "#" : "*";
  const itemPrefix = prefix + marker;
  const lines: string[] = [];
  for (const item of list.content ?? []) {
    const inlineParts: string[] = [];
    const nestedLines: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        nestedLines.push(serializeListItems(child, itemPrefix));
      } else if (child.type === "paragraph") {
        inlineParts.push(
          serializeInline(child.content, false).replace(/\n+/g, " ")
        );
      } else {
        // Any other block inside a list item flattens to its inline text.
        inlineParts.push(
          serializeInline(child.content, false).replace(/\n+/g, " ")
        );
      }
    }
    lines.push(`${itemPrefix} ${inlineParts.join(" ").trim()}`);
    if (nestedLines.length > 0) lines.push(nestedLines.join("\n"));
  }
  return lines.join("\n");
}

// ── Tables ────────────────────────────────────────────────────────────
// Header rows use `||h||h||`; body rows use `|c|c|`. A row renders as a
// header row when every cell is a tableHeader (the shape the editor and
// the generated issue bodies produce).

function serializeTableRow(row: WikiNode): string {
  const cells = row.content ?? [];
  if (cells.length === 0) return "";
  const isHeader = cells.every((c) => c.type === "tableHeader");
  const sep = isHeader ? "||" : "|";
  const rendered = cells.map((cell) => {
    const text = (cell.content ?? [])
      .map((child) =>
        child.type === "paragraph"
          ? serializeInline(child.content, true)
          : serializeInline(child.content ?? [], true)
      )
      .join(" ")
      .trim();
    // An empty cell collapses the `||`/`|` delimiters into a broken row.
    return text.length === 0 ? " " : text;
  });
  return `${sep}${rendered.join(sep)}${sep}`;
}

function serializeTable(node: WikiNode): string {
  return (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map(serializeTableRow)
    .filter((line) => line.length > 0)
    .join("\n");
}

// ── Blocks ────────────────────────────────────────────────────────────

function serializeBlock(node: WikiNode): string {
  switch (node.type) {
    case "paragraph":
      return escapeLineStart(serializeInline(node.content, false));
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      const clamped = Math.max(1, Math.min(6, Math.floor(level)));
      return `h${clamped}. ${serializeInline(node.content, false).replace(/\n+/g, " ")}`;
    }
    case "bulletList":
    case "orderedList":
      return serializeListItems(node, "");
    case "blockquote": {
      const inner = (node.content ?? [])
        .map(serializeBlock)
        .filter((p) => p.length > 0)
        .join("\n");
      return `{quote}\n${inner}\n{quote}`;
    }
    case "codeBlock": {
      const language = node.attrs?.language;
      const open = language ? `{code:${String(language)}}` : "{code}";
      // Code content is verbatim — Jira's {code} macro does not parse wiki
      // markup inside it, so no escaping.
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `${open}\n${text}\n{code}`;
    }
    case "horizontalRule": // TipTap
    case "rule": // ADF
      return "----";
    case "table":
      return serializeTable(node);
    case "hardBreak":
      return "\n";
    default:
      // Unknown block — degrade to its inline text instead of failing the
      // create/update flow.
      return escapeLineStart(serializeInline(node.content, false));
  }
}

/**
 * Serializes a TipTap document (or an ADF document — same tree shape) to
 * Jira wiki markup for Jira Server / Data Center REST v2 endpoints.
 *
 * Pure function — no DOM, no I/O.
 */
export function tiptapToJiraWiki(doc: unknown): string {
  if (
    !doc ||
    typeof doc !== "object" ||
    Array.isArray(doc) ||
    (doc as WikiNode).type !== "doc"
  ) {
    throw new Error(
      "tiptapToJiraWiki: input must be a TipTap/ADF document object with type === 'doc'"
    );
  }
  return ((doc as WikiNode).content ?? [])
    .map(serializeBlock)
    .filter((p) => p.length > 0)
    .join("\n\n");
}
