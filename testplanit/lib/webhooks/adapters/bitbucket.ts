import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

/**
 * Bitbucket Cloud inbound adapter. Bitbucket signs each delivery with
 * HMAC-SHA256 over the raw body in `X-Hub-Signature` (`sha256=<hex>`) when a
 * secret is set on the webhook, and names the event in `X-Event-Key`
 * (`repo:push`, `pullrequest:created`, ...). Bitbucket has no issue-tracker
 * events TestPlanIt consumes, so this adapter exists for the repository
 * events that start Impact analyses; the issue hooks return nothing.
 */
const SIGNATURE_HEADER = "x-hub-signature";
const EVENT_HEADER = "x-event-key";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const bitbucketAdapter: WebhookAdapter = {
  adapterType: "BITBUCKET" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = headers.get(SIGNATURE_HEADER);
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

    const eventType = headers.get(EVENT_HEADER);
    if (!eventType) return { valid: false, reason: "missing-required-field" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const payload: ParsedWebhookPayload = {
      eventType,
      issueKey: "",
      externalStatus: "",
      synthetic: false,
      data: parsed,
    };
    return { valid: true, payload };
  },

  extractLinkedIssueRef() {
    return null;
  },

  extractExternalStatus() {
    return null;
  },
};
