import { Buffer } from "node:buffer";

/**
 * Jira deployment flavors supported by the adapter.
 *
 * - `cloud` — Atlassian Cloud. REST API v3 (`/rest/api/3`), users addressed
 *   by `accountId`, API-key auth is `Basic email:apiToken`, OAuth routes
 *   through the `api.atlassian.com/ex/jira/{cloudId}` gateway.
 * - `server` — Jira Server / Data Center. REST API v2 (`/rest/api/2`), users
 *   addressed by `name`/`key`, Personal Access Tokens authenticate via
 *   `Bearer`, and Basic auth uses `username:password`.
 */
export type JiraDeploymentType = "cloud" | "server";
export type JiraApiVersion = "3" | "2";

export interface JiraDeploymentInfo {
  type: JiraDeploymentType;
  apiVersion: JiraApiVersion;
}

export interface JiraAuthCredentials {
  email?: string;
  username?: string;
  apiToken?: string;
  password?: string;
}

export type JiraAuthScheme = "basic" | "bearer";

const SERVER_INFO_TIMEOUT_MS = 10000;

/**
 * Detect the Jira deployment flavor by probing `/rest/api/2/serverInfo`,
 * which exists on both Cloud and Server/Data Center. The response's
 * `deploymentType` field is `"Cloud"` for Cloud and `"Server"` (or
 * `"Data Center"`) for self-hosted instances.
 *
 * When the probe fails (network error, auth rejected, non-JSON body), fall
 * back to a hostname heuristic: `*.atlassian.net` → Cloud, anything else →
 * Server. This keeps Cloud installations working when the probe is blocked
 * and lets a Data Center instance be identified even if `serverInfo` is
 * temporarily unreachable.
 */
export async function detectJiraDeployment(
  baseUrl: string,
  authHeaders: Record<string, string> = {}
): Promise<JiraDeploymentInfo> {
  const normalizedBase = (baseUrl || "").replace(/\/$/, "");

  try {
    const signal = AbortSignal.timeout(SERVER_INFO_TIMEOUT_MS);
    const response = await fetch(
      `${normalizedBase}/rest/api/2/serverInfo`,
      {
        headers: { Accept: "application/json", ...authHeaders },
        signal,
      }
    );
    if (response.ok) {
      const body = await response.json();
      const deploymentType = String(
        body?.deploymentType ?? ""
      ).toLowerCase();
      if (deploymentType === "cloud") {
        return { type: "cloud", apiVersion: "3" };
      }
      if (
        deploymentType === "server" ||
        deploymentType === "data center" ||
        deploymentType === "datacenter"
      ) {
        return { type: "server", apiVersion: "2" };
      }
    }
  } catch {
    // fall through to the hostname heuristic
  }

  try {
    const host = new URL(normalizedBase).hostname.toLowerCase();
    if (host.endsWith(".atlassian.net") || host.endsWith(".jiracloud.com")) {
      return { type: "cloud", apiVersion: "3" };
    }
  } catch {
    /* malformed baseUrl — default to server below */
  }

  return { type: "server", apiVersion: "2" };
}

/**
 * Resolve the authentication scheme for a Jira credential set.
 *
 * - On **Server / Data Center** a Personal Access Token is *always* sent as
 *   `Bearer`, even when an email happens to be supplied — Jira DC does not
 *   accept a PAT as the password half of Basic auth. A username + password
 *   pair uses `Basic`.
 * - On **Cloud** an API token is paired with an email as `Basic`.
 * - When the deployment is unknown (before detection), a bare token with no
 *   email/username is treated as a PAT (`Bearer`); anything paired is
 *   `Basic`. Once the deployment is known, callers should re-resolve with
 *   the `deployment` argument so an email + PAT combo is handled correctly
 *   on Data Center.
 *
 * An explicit `override` (from `settings.authScheme`) wins over everything
 * so admins can force a scheme when the heuristic is wrong.
 */
export function resolveAuthScheme(
  creds: JiraAuthCredentials,
  override?: string,
  deployment?: JiraDeploymentType
): JiraAuthScheme {
  if (override === "bearer") return "bearer";
  if (override === "basic") return "basic";
  if (deployment === "server") {
    // DC: a PAT (apiToken without a password) is Bearer; username+password
    // is Basic. An email is ignored for scheme selection on DC.
    if (creds.apiToken && !creds.password) return "bearer";
    return "basic";
  }
  if (deployment === "cloud") {
    // Cloud: API token + email is Basic. A bare token (no email) is treated
    // as a PAT-style Bearer, though Cloud normally doesn't use PATs.
    if (creds.apiToken && !creds.email && !creds.username) return "bearer";
    return "basic";
  }
  // Deployment unknown: a PAT is a bare token with no email/username pairing.
  if (creds.apiToken && !creds.email && !creds.username) return "bearer";
  return "basic";
}

/**
 * Build the `Authorization` header value for a Jira credential set.
 *
 * - `bearer` → `Bearer <apiToken>` (Data Center Personal Access Token).
 * - `basic`  → `Basic base64(email|username : apiToken|password)`. Cloud
 *   pairs an email with an API token; Data Center pairs a username with a
 *   password. We prefer `email` then `username` for the user half, and
 *   `apiToken` then `password` for the secret half.
 */
export function buildAuthHeader(
  creds: JiraAuthCredentials,
  scheme: JiraAuthScheme
): string {
  if (scheme === "bearer") {
    return `Bearer ${creds.apiToken ?? creds.password ?? ""}`;
  }
  const user = creds.email ?? creds.username ?? "";
  const pass = creds.apiToken ?? creds.password ?? "";
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/**
 * Pick the user identifier Jira expects for the deployment. Cloud uses
 * `accountId`; Server/Data Center uses `name` (falling back to `key`).
 */
export function pickUserId(
  user:
    | { accountId?: string; name?: string; key?: string }
    | null
    | undefined,
  deployment: JiraDeploymentType
): string | undefined {
  if (!user) return undefined;
  if (deployment === "server") {
    return user.name ?? user.key ?? user.accountId;
  }
  return user.accountId ?? user.name ?? user.key;
}

/**
 * Build the user-reference object for reporter/assignee fields. Cloud
 * accepts `{ accountId }`; Server/Data Center accepts `{ name }`.
 */
export function userRefField(
  user:
    | { accountId?: string; name?: string; key?: string }
    | null
    | undefined,
  deployment: JiraDeploymentType
): { accountId: string } | { name: string } | undefined {
  const id = pickUserId(user, deployment);
  if (!id) return undefined;
  if (deployment === "server") return { name: id };
  return { accountId: id };
}

function isUserRefValue(
  value: unknown
): value is { accountId?: string; name?: string; key?: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { accountId?: unknown }).accountId === "string"
  );
}

/**
 * Remap custom-field values shaped like a user reference through
 * `userRefField`. The create-issue form (and the reporter lookup in the
 * create-issue route) always emit a user-picker value as `{ accountId }` —
 * Jira's own Cloud convention — regardless of deployment. On Cloud that
 * shape is already correct and passes through untouched; on Server/Data
 * Center it must become `{ name }`, or Jira rejects the write. Every other
 * custom-field value (option/priority/version/component refs, plain
 * strings, arrays) is passed through unchanged.
 */
export function mapCustomFieldUserRefs(
  customFields: Record<string, unknown> | undefined,
  deployment: JiraDeploymentType
): Record<string, unknown> {
  if (!customFields) return {};
  if (deployment !== "server") return customFields;
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(customFields)) {
    mapped[key] = isUserRefValue(value)
      ? userRefField(value, deployment)
      : value;
  }
  return mapped;
}

/**
 * Serialize an Atlassian Document Format (ADF) document to Jira Wiki Markup —
 * the markup language Jira Server / Data Center's REST API v2 stores and
 * renders in rich-text fields (issue descriptions). Cloud takes ADF
 * directly; only Server/DC needs this. It is the write-side counterpart to
 * the adapter's ADF→HTML reader, covering the same block and inline set so
 * content round-trips: bold/italic/underline/strike/code/link marks,
 * headings, nested bullet/ordered lists, block quotes, code blocks (with
 * language), horizontal rules, hard breaks, and tables.
 *
 * DC v2 previously received descriptions stripped to bare plain text, which
 * silently discarded every bit of formatting a user entered. It is NOT
 * plain text: a plain string handed to Jira is itself interpreted as wiki
 * markup (`*x*` renders bold), which is exactly why the adapter emits wiki
 * markup here rather than raw text or ADF.
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
      cells.length > 0 &&
      cells.every((c: any) => c.type === "tableHeader");
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
