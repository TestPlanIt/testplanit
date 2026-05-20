// TipTap-doc → GitHub-flavored markdown serializer for INT-05.
//
// Hand-rolled per W5 investigation (06-03-PLAN.md interfaces block):
// `@tiptap/markdown` is a TipTap *Extension*, not a server-safe serializer —
// using it on the API path would require pulling a headless editor + DOM
// polyfills into Node. This module is intentionally a pure visitor that
// runs in Edge / Node API routes without any DOM.

// ── Type shape ────────────────────────────────────────────────────────
// We accept the structural TipTap doc shape (`{ type, content?, attrs?,
// marks?, text? }`) and dispatch by `type`. The input is `unknown` so
// callers can pass `Prisma.JsonValue` results directly without import
// gymnastics; the serializer narrows internally and throws on shapes it
// does not understand.

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

// ── escapeMarkdown ────────────────────────────────────────────────────
// Escape the full GitHub-flavored set so adversarial text in case names,
// labels, and parameter values cannot inject markdown structure
// (T-06-03-03). The set follows the GitHub-flavored markdown spec's
// "characters that may need escaping" list.

const MARKDOWN_ESCAPE_RE = /([\\`*_{}\[\]()#+\-.!|])/g;

export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPE_RE, "\\$1");
}

// Table-cell extra pass: strip newlines (collapsed to spaces) so a cell
// value with embedded `\n` cannot break out and forge an adjacent row
// (T-06-03-04). Pipes are already escaped by escapeMarkdown above.

function escapeForTableCell(text: string): string {
  return escapeMarkdown(text).replace(/\n+/g, " ");
}

// ── Text + marks ──────────────────────────────────────────────────────
// Marks are applied innermost-out so `**[label](href)**` renders correctly
// when both `bold` and `link` are present on the same text node.

function applyMark(text: string, mark: TiptapMark): string {
  switch (mark.type) {
    case "link": {
      const rawHref = String(
        (mark.attrs as Record<string, unknown> | undefined)?.href ?? ""
      );
      // WR-02: defend the markdown URL syntax against hrefs that
      // contain `(`, `)`, whitespace, or other structural characters
      // that would let the URL escape the `[label](url)` boundary.
      // `encodeURI` preserves legal URL delimiters
      // (`;,/?:@&=+$-_.!~*'#`) but does NOT encode parentheses, so
      // they get a second pass with explicit percent encoding.
      // Server-controlled hrefs (the only intended caller today)
      // remain unchanged; adversarial input cannot forge link spans.
      let href: string;
      try {
        href = encodeURI(rawHref);
      } catch {
        // Malformed input (e.g. lone surrogate) — fall back to the
        // raw string; the explicit char replace below still runs.
        href = rawHref;
      }
      href = href.replace(/\(/g, "%28").replace(/\)/g, "%29");
      return `[${text}](${href})`;
    }
    case "code":
      return "`" + text + "`";
    case "bold":
    case "strong":
      return `**${text}**`;
    case "italic":
    case "em":
      return `*${text}*`;
    default:
      // Unknown marks are dropped silently (text content is preserved).
      // Unlike unknown node types, unknown marks have no structural impact
      // — we lose styling, not content.
      return text;
  }
}

function serializeText(node: TiptapNode, cellContext: boolean): string {
  const raw = node.text ?? "";
  let out = cellContext ? escapeForTableCell(raw) : escapeMarkdown(raw);
  for (const mark of node.marks ?? []) {
    out = applyMark(out, mark);
  }
  return out;
}

// ── Inline children (paragraph contents) ──────────────────────────────

function serializeInline(
  nodes: TiptapNode[] | undefined,
  cellContext: boolean
): string {
  if (!nodes || nodes.length === 0) return "";
  const parts: string[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      parts.push(serializeText(n, cellContext));
    } else if (n.type === "hardBreak") {
      parts.push(cellContext ? " " : "  \n");
    } else {
      // Inline children should be text nodes or hardBreaks. Anything else
      // is a structural error.
      throw new Error(
        `tiptapToMarkdown: unsupported node type in inline context: ${n.type}`
      );
    }
  }
  return parts.join("");
}

// ── Block-level serialization ─────────────────────────────────────────

function serializeListItem(node: TiptapNode, marker: string): string {
  // A listItem contains paragraph(s); we flatten to a single line per item.
  const inline = (node.content ?? [])
    .map((child) => {
      if (child.type === "paragraph") {
        return serializeInline(child.content, false);
      }
      // Nested lists inside a listItem render with indentation, but for
      // INT-05 the issue body never produces nested lists. Fail loud.
      throw new Error(
        `tiptapToMarkdown: unsupported node type in listItem: ${child.type}`
      );
    })
    .join(" ");
  return `${marker} ${inline}`;
}

function serializeTableCellLike(node: TiptapNode): string {
  // A tableCell/tableHeader contains paragraph(s). Render each paragraph's
  // inline content with the table-cell escape, joined by a space (newlines
  // collapse to spaces inside a cell).
  const text = (node.content ?? [])
    .map((child) => {
      if (child.type === "paragraph") {
        return serializeInline(child.content, true);
      }
      throw new Error(
        `tiptapToMarkdown: unsupported node type in table cell: ${child.type}`
      );
    })
    .join(" ")
    .trim();
  // Empty cells render as a single space — some markdown renderers parse
  // `||` (empty between pipes) as a malformed row.
  return text.length === 0 ? " " : text;
}

function serializeTable(node: TiptapNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const renderedRows: string[][] = rows.map((row) => {
    if (row.type !== "tableRow") {
      throw new Error(
        `tiptapToMarkdown: unsupported node type in table: ${row.type}`
      );
    }
    return (row.content ?? []).map((cell) => {
      if (cell.type !== "tableCell" && cell.type !== "tableHeader") {
        throw new Error(
          `tiptapToMarkdown: unsupported node type in tableRow: ${cell.type}`
        );
      }
      return serializeTableCellLike(cell);
    });
  });
  // GitHub markdown requires the first row to be a header row. If the
  // first row's cells are all tableHeader nodes we use them as-is; if not,
  // we still emit the first row as the header (callers building INT-05
  // bodies always use a header row).
  const headerCells = renderedRows[0];
  const widestRowLen = renderedRows.reduce(
    (max, r) => Math.max(max, r.length),
    0
  );
  // Pad short rows with empty single-space cells so the table is square
  for (const r of renderedRows) {
    while (r.length < widestRowLen) r.push(" ");
  }
  const lines: string[] = [];
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
  for (let i = 1; i < renderedRows.length; i++) {
    lines.push(`| ${renderedRows[i].join(" | ")} |`);
  }
  return lines.join("\n");
}

function serializeNode(node: TiptapNode): string {
  switch (node.type) {
    case "doc": {
      const parts = (node.content ?? []).map(serializeNode);
      // Blocks are separated by a blank line for legibility in the rendered
      // markdown body.
      return parts.filter((p) => p.length > 0).join("\n\n");
    }
    case "paragraph":
      return serializeInline(node.content, false);
    case "heading": {
      const level = Number(
        (node.attrs as Record<string, unknown> | undefined)?.level ?? 1
      );
      const clampedLevel = Math.max(1, Math.min(6, Math.floor(level)));
      const prefix = "#".repeat(clampedLevel);
      return `${prefix} ${serializeInline(node.content, false)}`;
    }
    case "bulletList": {
      const items = (node.content ?? []).map((child) => {
        if (child.type !== "listItem") {
          throw new Error(
            `tiptapToMarkdown: unsupported node type in bulletList: ${child.type}`
          );
        }
        return serializeListItem(child, "-");
      });
      return items.join("\n");
    }
    case "orderedList": {
      const items = (node.content ?? []).map((child, i) => {
        if (child.type !== "listItem") {
          throw new Error(
            `tiptapToMarkdown: unsupported node type in orderedList: ${child.type}`
          );
        }
        return serializeListItem(child, `${i + 1}.`);
      });
      return items.join("\n");
    }
    case "table":
      return serializeTable(node);
    case "hardBreak":
      return "  \n";
    default:
      throw new Error(`tiptapToMarkdown: unsupported node type: ${node.type}`);
  }
}

/**
 * Serializes a TipTap document to GitHub-flavored markdown.
 *
 * Pure function — no DOM, no I/O. Safe to call from API routes, workers,
 * and Edge runtime.
 *
 * Throws if the document contains a node type the serializer does not
 * understand; this is deliberate (T-06-03-06) — silently emitting raw HTML
 * or partial markdown is worse than failing the issue-create flow.
 */
export function tiptapToMarkdown(doc: unknown): string {
  if (
    !doc ||
    typeof doc !== "object" ||
    Array.isArray(doc) ||
    (doc as TiptapNode).type !== "doc"
  ) {
    throw new Error(
      "tiptapToMarkdown: input must be a TipTap document object with type === 'doc'"
    );
  }
  return serializeNode(doc as TiptapNode);
}
