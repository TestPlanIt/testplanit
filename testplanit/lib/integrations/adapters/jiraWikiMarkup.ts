/**
 * Jira Wiki Markup serialization.
 *
 * Jira Server / Data Center's REST API v2 stores and renders rich text as
 * Jira Wiki Markup, not Atlassian Document Format (that's Cloud) and not
 * unformatted plain text. This module converts an ADF document — the shape
 * the adapter already produces for Cloud, and the shape a TipTap editor
 * doc normalizes to — into wiki markup, so formatting survives a write to
 * any Server/DC rich-text field.
 *
 * It is field-agnostic: issue descriptions and comment bodies use the same
 * wiki-markup grammar, so the same serializer serves both. It lives in its
 * own module (rather than in jiraDeployment.ts, which decides Cloud-vs-DC
 * dialect concerns) because it is a self-contained markup concern with no
 * dependency on deployment detection or auth.
 *
 * The serializer is the write-side counterpart to the adapter's ADF→HTML
 * reader, covering the same block and inline set so content round-trips:
 * bold/italic/underline/strike/code/link marks, headings, nested and mixed
 * bullet/ordered lists, block quotes, code blocks (with language),
 * horizontal rules, hard breaks, and tables.
 *
 * Renderer assumption: this presumes the target field uses Jira's
 * **Wiki Style Renderer**, which is the default for Description and Comment
 * on Server/DC. An admin can instead assign the **Default Text Renderer**
 * (Admin → Issues → Field Configurations → Renderers) to a field, in which
 * case the field stores literal plain text and this markup would show
 * verbatim (e.g. "*bold*") rather than rendered. Jira exposes no field
 * renderer in createmeta/editmeta, so it can't be detected before a write;
 * the plain-text-renderer configuration is uncommon and the failure mode is
 * cosmetic and admin-fixable, so we assume the wiki renderer. (Note: this is
 * distinct from the per-user "Rich Text Editing" preference, which only
 * toggles the WYSIWYG editor vs. a raw wiki-markup textarea — the field is
 * wiki-rendered either way, so that preference does not affect this output.)
 */

/**
 * Serialize an Atlassian Document Format (ADF) document to Jira Wiki Markup.
 *
 * Literal text is emitted as-is, not escaped: ADF separates a text node's
 * content from its marks, so "*star*" only renders bold if it actually
 * carries a `strong` mark. Text that itself contains wiki metacharacters is
 * a rare edge Jira will interpret — accepted as a known limitation rather
 * than risking mangled output from aggressive escaping.
 */
export function adfToWikiMarkup(doc: unknown): string {
  const content = (doc as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return "";
  // Blocks self-terminate with a blank line; collapse the runs that produces
  // (and any empty paragraphs) down to a single blank-line separator.
  return serializeWikiBlocks(content)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function serializeWikiBlocks(nodes: unknown[]): string {
  return nodes.map((n) => serializeWikiBlock(n)).join("");
}

function serializeWikiBlock(node: any): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "paragraph":
      return `${serializeWikiInline(node.content)}\n\n`;
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6);
      return `h${level}. ${serializeWikiInline(node.content)}\n\n`;
    }
    case "bulletList":
    case "orderedList":
      return `${serializeWikiList(node, "")}\n\n`;
    case "blockquote":
      return `{quote}\n${serializeWikiBlocks(node.content || []).trim()}\n{quote}\n\n`;
    case "codeBlock": {
      const language = node.attrs?.language;
      const code = (node.content || [])
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("");
      return `{code${language ? `:${language}` : ""}}\n${code}\n{code}\n\n`;
    }
    case "rule":
      return "----\n\n";
    case "table":
      return `${serializeWikiTable(node)}\n\n`;
    default:
      // Unknown block: recurse into block children, else treat as inline.
      if (Array.isArray(node.content)) return serializeWikiBlocks(node.content);
      return serializeWikiInline([node]);
  }
}

function serializeWikiInline(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((node: any) => {
      if (!node || typeof node !== "object") return "";
      if (node.type === "hardBreak") return "\n";
      if (node.type === "text") {
        return applyWikiMarks(node.text || "", node.marks);
      }
      if (Array.isArray(node.content)) return serializeWikiInline(node.content);
      return "";
    })
    .join("");
}

function applyWikiMarks(text: string, marks: unknown): string {
  if (!Array.isArray(marks) || marks.length === 0) return text;
  let out = text;
  // Tolerant of both ADF (strong/em) and raw TipTap (bold/italic) mark names
  // so the serializer works whether or not the doc was normalized first.
  for (const mark of marks) {
    switch ((mark as { type?: string })?.type) {
      case "strong":
      case "bold":
        out = `*${out}*`;
        break;
      case "em":
      case "italic":
        out = `_${out}_`;
        break;
      case "underline":
        out = `+${out}+`;
        break;
      case "strike":
      case "strikethrough":
        out = `-${out}-`;
        break;
      case "code":
        out = `{{${out}}}`;
        break;
      case "link": {
        const href = (mark as { attrs?: { href?: string } })?.attrs?.href;
        out = href ? `[${out}|${href}]` : out;
        break;
      }
    }
  }
  return out;
}

/**
 * Serialize a bullet/ordered list to wiki markup. `prefix` accumulates the
 * ancestor markers so nested and mixed lists render correctly — a bullet
 * under an ordered item becomes `#*`, matching Jira's own nesting syntax,
 * rather than being flattened to a single level.
 */
function serializeWikiList(listNode: any, prefix: string): string {
  const marker = listNode.type === "orderedList" ? "#" : "*";
  const myPrefix = prefix + marker;
  const lines: string[] = [];
  for (const item of listNode.content || []) {
    if (!item || item.type !== "listItem") continue;
    let line = "";
    const nested: string[] = [];
    for (const child of item.content || []) {
      if (!child || typeof child !== "object") continue;
      if (child.type === "bulletList" || child.type === "orderedList") {
        nested.push(serializeWikiList(child, myPrefix));
      } else if (child.type === "paragraph") {
        line += serializeWikiInline(child.content);
      } else {
        line += serializeWikiInline(child.content || [child]);
      }
    }
    lines.push(`${myPrefix} ${line}`.trimEnd());
    for (const n of nested) if (n) lines.push(n);
  }
  return lines.join("\n");
}

function serializeWikiTable(node: any): string {
  const rows: string[] = [];
  for (const row of node.content || []) {
    if (!row || row.type !== "tableRow") continue;
    const cells = (row.content || []).filter(Boolean);
    const allHeaders =
      cells.length > 0 && cells.every((c: any) => c.type === "tableHeader");
    const rendered = cells.map((c: any) =>
      serializeWikiBlocks(c.content || [])
        .replace(/\s+/g, " ")
        .trim()
    );
    rows.push(
      allHeaders ? `||${rendered.join("||")}||` : `|${rendered.join("|")}|`
    );
  }
  return rows.join("\n");
}
