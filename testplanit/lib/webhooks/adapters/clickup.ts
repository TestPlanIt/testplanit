import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

/**
 * ClickUp signs every delivery with an HMAC-SHA256 of the raw body, keyed
 * by the secret it minted when the webhook was created, and sends the hex
 * digest bare (no `sha256=` prefix) in this header.
 */
const SIGNATURE_HEADER = "x-signature";
const HEX_64_RE = /^[0-9a-f]{64}$/;

/**
 * Synthetic sentinel: the self-loop server action emits this exact task_id
 * in its synthetic ClickUp-shaped payload. Real ClickUp task ids are short
 * lowercase alphanumerics and custom ids are "PREFIX-123", so no workspace
 * can produce a task whose id is this string — the synthetic path stays
 * reachable only from the server's own self-test, even for a caller
 * holding the secret.
 */
export const SYNTHETIC_TASK_ID = "__synthetic__";

interface ClickUpHistoryItem {
  field?: string;
  before?: { status?: string } | null;
  after?: { status?: string } | null;
}

interface ClickUpWebhookPayload {
  event?: string;
  task_id?: string;
  webhook_id?: string;
  history_items?: ClickUpHistoryItem[];
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * The status a task moved to, if this delivery says so. ClickUp sends the
 * change inside `history_items`: the `status` item's `after.status` is the
 * new status name (statuses are per-List free text, so it is used verbatim).
 */
function statusFromHistory(p: ClickUpWebhookPayload): string | null {
  const items = Array.isArray(p.history_items) ? p.history_items : [];
  for (const item of items) {
    if (item?.field !== "status") continue;
    const after = item.after?.status;
    if (typeof after === "string" && after.length > 0) return after;
  }
  return null;
}

export const clickupAdapter: WebhookAdapter = {
  adapterType: "CLICKUP" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = headers.get(SIGNATURE_HEADER);
    if (!sig) return { valid: false, reason: "missing-signature" };
    const provided = sig.trim().toLowerCase();
    if (!HEX_64_RE.test(provided)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!constantTimeEqualHex(provided, expected)) {
      return { valid: false, reason: "signature-mismatch" };
    }

    let parsed: ClickUpWebhookPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as ClickUpWebhookPayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const eventType = parsed.event;
    if (typeof eventType !== "string" || eventType.length === 0) {
      return { valid: false, reason: "missing-required-field" };
    }

    const taskId = parsed.task_id;
    const issueKey = typeof taskId === "string" ? taskId : "";
    const externalStatus = statusFromHistory(parsed) ?? "";
    const synthetic = taskId === SYNTHETIC_TASK_ID;

    const payload: ParsedWebhookPayload = {
      eventType,
      issueKey,
      externalStatus,
      synthetic,
      data: parsed,
    };
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as ClickUpWebhookPayload;
    const taskId = p.task_id;
    if (typeof taskId !== "string" || taskId.length === 0) return null;
    return {
      externalKey: taskId,
      externalSystem: "CLICKUP" satisfies AdapterType,
      externalId: taskId,
    };
  },

  extractExternalStatus(payload, eventType) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const status = statusFromHistory(raw as ClickUpWebhookPayload);
    // A new task's delivery carries its first status as a history item;
    // it is an issue event even when that item is missing.
    if (eventType === "taskCreated") return status ?? "";
    if (eventType !== "taskStatusUpdated") return null;
    return status;
  },
};
