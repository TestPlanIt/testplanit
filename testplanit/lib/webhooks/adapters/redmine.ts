import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  MilestoneEventRef,
  ParsedWebhookPayload,
  VerifyOptions,
  VerifyResult,
  WebhookAdapter,
} from "./types";

/**
 * Inbound webhook adapter for Redmine. Two senders share it:
 *
 * - Redmine 7.0 and later send webhooks themselves. A hook that has a secret
 *   signs each delivery: `X-Redmine-Signature-256: sha256=<hex HMAC-SHA256 of
 *   the raw body>`.
 *     { type: "issue.updated", timestamp,
 *       data: { issue: { id, status: { name }, ... }, journal?: { ... } } }
 *     { type: "version.updated", timestamp,
 *       data: { version: { id, project: { id }, status, ... } } }
 *
 * - The `redmine_webhook` plugin, for Redmine 6 and older, cannot sign or
 *   send custom headers. The unguessable token in the receiver URL is then
 *   the only credential.
 *     { payload: { action: "opened" | "updated",
 *                  issue: { id, status: { name }, ... }, journal?, url } }
 *
 * A delivery that carries a signature is always verified. One without is
 * accepted only when the config allows unsigned deliveries.
 *
 * issueKey is `#<id>` to match RedmineAdapter.mapIssue's `key`, which is what
 * gets stored as Issue.externalKey and what applyInboundIssueUpdate matches on.
 */

const SIGNATURE_HEADER = "x-redmine-signature-256";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

// Sentinel issue id for self-test pings — real Redmine issue ids are >= 1.
const SYNTHETIC_ISSUE_ID = 0;

interface RedmineIssueBody {
  id?: number;
  status?: { name?: string };
}

interface RedmineVersionBody {
  id?: number;
  status?: string;
  project?: { id?: number };
}

interface RedmineWebhookBody {
  /** redmine_webhook plugin. */
  payload?: {
    action?: string;
    issue?: RedmineIssueBody;
    url?: string;
  };
  /** Redmine 7.0 and later: "<object>.<created|updated|deleted>". */
  type?: string;
  data?: {
    issue?: RedmineIssueBody;
    version?: RedmineVersionBody;
  };
}

const ISSUE_STATUS_EVENTS = new Set([
  "redmine:issue_opened",
  "redmine:issue_created",
  "redmine:issue_updated",
]);

function issueKeyFor(id: number): string {
  return `#${id}`;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * A version event as a milestone event type. Closing is the one lifecycle
 * change the payload identifies; a reopened version reads like any other edit.
 */
function versionEventType(
  action: string,
  version: RedmineVersionBody
): string | null {
  switch (action) {
    case "created":
      return "milestone_created";
    case "updated":
      return version.status === "closed"
        ? "milestone_closed"
        : "milestone_edited";
    case "deleted":
      return "milestone_deleted";
    default:
      return null;
  }
}

/**
 * The delivery body, whether handed over raw or inside a parsed payload. A
 * Redmine 7 body has a `data` key of its own, so only a parsed payload (the
 * one with an `eventType`) is unwrapped.
 */
function bodyOf(payload: unknown): RedmineWebhookBody {
  const parsed = payload as ParsedWebhookPayload | null;
  const body =
    typeof parsed?.eventType === "string" && parsed.data
      ? parsed.data
      : payload;
  return (body ?? {}) as RedmineWebhookBody;
}

function issueOf(body: RedmineWebhookBody): RedmineIssueBody | undefined {
  return body.data?.issue ?? body.payload?.issue;
}

function parseNative(body: RedmineWebhookBody): VerifyResult {
  const [object, action] = (body.type ?? "").split(".");
  if (!object || !action) {
    return { valid: false, reason: "missing-required-field" };
  }

  if (object === "version") {
    const version = body.data?.version;
    const eventType = version ? versionEventType(action, version) : null;
    if (!eventType || typeof version?.id !== "number") {
      return { valid: false, reason: "missing-required-field" };
    }
    return {
      valid: true,
      payload: {
        eventType,
        issueKey: "",
        externalStatus: "",
        synthetic: false,
        data: body,
      },
    };
  }

  if (object === "issue") {
    const issue = body.data?.issue;
    if (typeof issue?.id !== "number") {
      return { valid: false, reason: "missing-required-field" };
    }
    const status = issue.status?.name;
    return {
      valid: true,
      payload: {
        eventType: `redmine:issue_${action}`,
        issueKey: issueKeyFor(issue.id),
        externalStatus: typeof status === "string" ? status : "",
        synthetic: issue.id === SYNTHETIC_ISSUE_ID,
        data: body,
      },
    };
  }

  // Wiki page, time entry and news events carry nothing TestPlanIt tracks.
  return {
    valid: true,
    payload: {
      eventType: `redmine:${object}_${action}`,
      issueKey: "",
      externalStatus: "",
      synthetic: false,
      data: body,
    },
  };
}

function parsePlugin(body: RedmineWebhookBody): VerifyResult {
  const p = body.payload;
  const id = p?.issue?.id;
  const action = p?.action;
  if (typeof id !== "number" || typeof action !== "string" || !action) {
    return { valid: false, reason: "missing-required-field" };
  }

  const status = p?.issue?.status?.name;
  return {
    valid: true,
    payload: {
      eventType: `redmine:issue_${action}`,
      issueKey: issueKeyFor(id),
      externalStatus: typeof status === "string" ? status : "",
      synthetic: id === SYNTHETIC_ISSUE_ID,
      data: body,
    },
  };
}

export const redmineAdapter: WebhookAdapter = {
  adapterType: "REDMINE" satisfies AdapterType,

  verify(
    rawBody: Buffer,
    headers: Headers,
    secret: string,
    options?: VerifyOptions
  ): VerifyResult {
    const sig = headers.get(SIGNATURE_HEADER);
    if (!sig) {
      if (!options?.allowUnsigned) {
        return { valid: false, reason: "missing-signature" };
      }
    } else {
      if (!sig.startsWith(SIGNATURE_PREFIX)) {
        return { valid: false, reason: "malformed-signature" };
      }
      const provided = sig.slice(SIGNATURE_PREFIX.length).toLowerCase();
      if (!HEX_64_RE.test(provided)) {
        return { valid: false, reason: "malformed-signature" };
      }
      const expected = createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");
      if (!constantTimeEqualHex(provided, expected)) {
        return { valid: false, reason: "signature-mismatch" };
      }
    }

    let parsed: RedmineWebhookBody;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as RedmineWebhookBody;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }
    if (!parsed || typeof parsed !== "object") {
      return { valid: false, reason: "missing-required-field" };
    }

    return typeof parsed.type === "string"
      ? parseNative(parsed)
      : parsePlugin(parsed);
  },

  extractLinkedIssueRef(payload) {
    const id = issueOf(bodyOf(payload))?.id;
    if (typeof id !== "number") return null;
    return {
      externalKey: issueKeyFor(id),
      externalSystem: "REDMINE" satisfies AdapterType,
      externalId: String(id),
    };
  },

  extractExternalStatus(payload, eventType) {
    if (!ISSUE_STATUS_EVENTS.has(eventType)) return null;
    const name = issueOf(bodyOf(payload))?.status?.name;
    return typeof name === "string" ? name : null;
  },

  extractMilestoneEventRef(payload, eventType): MilestoneEventRef | null {
    if (!eventType.startsWith("milestone_")) return null;
    const version = bodyOf(payload).data?.version;
    const projectId = version?.project?.id;
    if (typeof version?.id !== "number" || typeof projectId !== "number") {
      return null;
    }
    return {
      kind: "RELEASE",
      externalId: String(version.id),
      externalProjectId: String(projectId),
      merge: false,
    };
  },
};
