import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

const SIGNATURE_HEADER_PRIMARY = "x-hub-signature-256";
// Atlassian's legacy webhook setup form labels its signature header
// `x-hub-signature` — same name GitHub uses for SHA-1, but Jira sends
// SHA-256 under it. We accept both header names; the strict
// `sha256=` prefix + 64-hex-char regex below prevents a real GitHub
// SHA-1 signature (`sha1=...`) from passing verification.
const SIGNATURE_HEADER_FALLBACK = "x-hub-signature";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

function readSignature(headers: Headers): string | null {
  // Headers API is case-insensitive — `headers.get` handles casing.
  const raw =
    headers.get(SIGNATURE_HEADER_PRIMARY) ??
    headers.get(SIGNATURE_HEADER_FALLBACK);
  return raw ? raw.trim() : null;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    key?: string;
    fields?: { status?: { name?: string } };
  };
  // Version/sprint payloads (jira:version_* / sprint_*) — no `issue` field
  // at all. `project.id` is only present on version events; sprint events
  // carry no project reference (Pitfall 2), only `originBoardId`.
  project?: { id?: string | number };
  version?: { id?: string | number };
  sprint?: { id?: string | number; originBoardId?: string | number };
  // Present on `jira:version_deleted` ONLY when the version was merged into
  // another rather than truly deleted — Atlassian's docs confirm merges are
  // NOT a distinct wire event (RESEARCH.md A2).
  mergedTo?: string | number;
  // NOTE: `metadata.synthetic` is intentionally NOT modeled here. Any
  // caller with a valid HMAC could otherwise set `metadata.synthetic` to
  // `true` and silently suppress production Issue updates.
}

/**
 * Synthetic sentinel: the self-loop server action emits this exact issue.key
 * in its synthetic Jira-shaped payload. The receiver detects this key and
 * short-circuits the linked-Issue step. A real Jira instance — or anyone
 * with the secret — cannot trigger the synthetic path because it would
 * have to send `__synthetic__` as the actual Jira issue key, which Jira
 * itself does not produce. Server-side intent is bound to a value an
 * external caller cannot legitimately forge.
 */
export const SYNTHETIC_ISSUE_KEY = "__synthetic__";

function parsePayload(rawBody: Buffer): JiraWebhookPayload | null {
  try {
    return JSON.parse(rawBody.toString("utf8")) as JiraWebhookPayload;
  } catch {
    return null;
  }
}

/**
 * jira:version_* / sprint_* payloads carry no `issue` object at all — the
 * pre-existing issue-shaped extraction (`issue.key` + `issue.fields.status`)
 * always returns null for these, which is exactly Pitfall 1 (the current
 * silent-drop bug). This builder produces a milestone-shaped
 * `ParsedWebhookPayload` instead: `issueKey`/`externalStatus` are left as
 * empty-string placeholders (never read by the milestone apply path — only
 * `extractMilestoneEventRef` reads `payload.data`), and `data: p` carries
 * the raw payload through for the extractor.
 */
function buildMilestoneEventPayload(
  p: JiraWebhookPayload,
  eventType: string
): ParsedWebhookPayload {
  return {
    eventType,
    // Not applicable to version/sprint events — applyInboundMilestoneEvent
    // never reads these two denormalized fields, only `data`.
    issueKey: "",
    externalStatus: "",
    synthetic: false,
    data: p,
  };
}

function buildPayload(p: JiraWebhookPayload): ParsedWebhookPayload | null {
  const eventType = p.webhookEvent ?? "jira:unknown";

  // Branch BEFORE the issue-shaped extraction (Pattern 1) — version/sprint
  // payloads have no `issue` object and would otherwise always fail the
  // `!issueKey || !externalStatus` check below and silently no-op (Pitfall 1).
  if (
    eventType.startsWith("jira:version_") ||
    eventType.startsWith("sprint_")
  ) {
    return buildMilestoneEventPayload(p, eventType);
  }

  const issueKey = p.issue?.key;
  const externalStatus = p.issue?.fields?.status?.name;
  if (!issueKey || !externalStatus) return null;
  return {
    eventType,
    issueKey,
    externalStatus,
    // `synthetic` is bound to the sentinel issue.key, NOT to any
    // wire-controllable metadata field. This is the only way for the
    // receiver to learn "this came from the self-loop" without trusting
    // attacker-supplied JSON.
    synthetic: issueKey === SYNTHETIC_ISSUE_KEY,
    // Raw parsed body for extractors that read original Jira shape.
    data: p,
  };
}

export const jiraAdapter: WebhookAdapter = {
  adapterType: "JIRA" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = readSignature(headers);
    if (!sig) return { valid: false, reason: "missing-signature" };
    if (!sig.startsWith(SIGNATURE_PREFIX)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const provided = sig.slice(SIGNATURE_PREFIX.length).toLowerCase();
    if (!HEX_64_RE.test(provided)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!constantTimeEqualHex(provided, expected)) {
      return { valid: false, reason: "signature-mismatch" };
    }
    const parsed = parsePayload(rawBody);
    if (!parsed) {
      return { valid: false, reason: "unparseable-body" };
    }
    const payload = buildPayload(parsed);
    if (!payload) {
      return { valid: false, reason: "missing-required-field" };
    }
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as { issue?: { key?: unknown } };
    const key = p.issue?.key;
    if (typeof key !== "string" || key.length === 0) return null;
    return { externalKey: key, externalSystem: "JIRA" satisfies AdapterType };
  },

  extractExternalStatus(payload, eventType) {
    // `jira:issue_created` and `jira:issue_updated` both carry the full
    // issue object with `fields.status.name`. Auto-create relies on this
    // returning non-null on creation events so the inbound apply path
    // doesn't short-circuit as `no_handler`.
    //
    // `jira:issue_deleted` is intentionally excluded — even if Jira's
    // payload includes a status at deletion time, we don't want auto-
    // create or system sync firing for an issue Jira just removed.
    if (
      eventType !== "jira:issue_updated" &&
      eventType !== "jira:issue_created"
    ) {
      return null;
    }
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as {
      issue?: { fields?: { status?: { name?: unknown } } };
    };
    const name = p.issue?.fields?.status?.name;
    return typeof name === "string" ? name : null;
  },

  extractMilestoneEventRef(payload, eventType) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as JiraWebhookPayload;

    if (eventType.startsWith("sprint_")) {
      const externalId = p.sprint?.id;
      const originBoardId = p.sprint?.originBoardId;
      if (
        (typeof externalId !== "string" && typeof externalId !== "number") ||
        (typeof originBoardId !== "string" &&
          typeof originBoardId !== "number")
      ) {
        return null;
      }
      return {
        kind: "ITERATION",
        externalId: String(externalId),
        originBoardId: String(originBoardId),
      };
    }

    if (eventType.startsWith("jira:version_")) {
      const externalId = p.version?.id;
      const externalProjectId = p.project?.id;
      if (
        typeof externalId !== "string" &&
        typeof externalId !== "number"
      ) {
        return null;
      }
      if (
        typeof externalProjectId !== "string" &&
        typeof externalProjectId !== "number"
      ) {
        return null;
      }
      // Merge discriminator: `jira:version_deleted` with `mergedTo` present
      // is a merge, not a true delete (RESEARCH.md Code Examples — verified
      // Atlassian docs quote). Also accept a literal `jira:version_merged`
      // eventType as a defensive alias (A2) in case a live instance ever
      // sends that distinct string.
      const mergedTo = p.mergedTo;
      const hasMergedTo =
        typeof mergedTo === "string" || typeof mergedTo === "number";
      const merge = hasMergedTo || eventType === "jira:version_merged";
      return {
        kind: "RELEASE",
        externalId: String(externalId),
        externalProjectId: String(externalProjectId),
        merge,
        ...(hasMergedTo ? { mergedToExternalId: String(mergedTo) } : {}),
      };
    }

    return null;
  },
};
