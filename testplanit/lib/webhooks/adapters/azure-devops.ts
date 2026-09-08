import { createHash, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

const AUTH_HEADER = "authorization";
const BASIC_PREFIX = "Basic ";

/**
 * Synthetic binding sentinel for ADO: the self-loop server action emits
 * resource.id === 0 in its synthetic workitem.updated payload. Real Azure
 * DevOps work-item IDs are positive integers (≥ 1), so a resource.id of 0
 * cannot be legitimately produced by ADO — even by a caller holding valid
 * Basic Auth credentials, the synthetic flag is non-forgeable from the wire.
 */
const SYNTHETIC_RESOURCE_ID = 0;

interface AdoCredentials {
  username: string;
  password: string;
}

interface AdoWorkItemPayload {
  eventType?: string;
  resource?: {
    id?: number;
    fields?: { "System.State"?: string };
  };
}

/**
 * Constant-time UTF-8 string equality. Hashes both halves to fixed-length
 * 32-byte sha256 buffers BEFORE timingSafeEqual — sidesteps the throw-on-
 * unequal-length behavior of timingSafeEqual and prevents length-leak side
 * channels. Pattern source: simonwillison.net TIL on constant-time string
 * compare.
 */
function safeEqualUtf8(a: string, b: string): boolean {
  const ab = createHash("sha256").update(a, "utf8").digest();
  const bb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ab, bb);
}

function parseCredentials(secret: string): AdoCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    return null;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as AdoCredentials).username === "string" &&
    typeof (parsed as AdoCredentials).password === "string"
  ) {
    return parsed as AdoCredentials;
  }
  return null;
}

export const azureDevopsAdapter: WebhookAdapter = {
  adapterType: "AZURE_DEVOPS" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const authHeader = headers.get(AUTH_HEADER);
    if (!authHeader || !authHeader.startsWith(BASIC_PREFIX)) {
      return { valid: false, reason: "missing-auth" };
    }

    const encoded = authHeader.slice(BASIC_PREFIX.length);
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return { valid: false, reason: "auth-mismatch" };
    }

    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) return { valid: false, reason: "auth-mismatch" };
    const providedUser = decoded.slice(0, colonIdx);
    const providedPass = decoded.slice(colonIdx + 1);

    const creds = parseCredentials(secret);
    if (creds === null) return { valid: false, reason: "auth-mismatch" };

    // Both halves run unconditionally; do NOT short-circuit between user and
    // pass — short-circuit leaks which half is wrong via timing.
    const userOk = safeEqualUtf8(providedUser, creds.username);
    const passOk = safeEqualUtf8(providedPass, creds.password);
    if (!userOk || !passOk) {
      return { valid: false, reason: "auth-mismatch" };
    }

    let parsed: AdoWorkItemPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as AdoWorkItemPayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const eventType = parsed.eventType;
    if (typeof eventType !== "string" || eventType.length === 0) {
      return { valid: false, reason: "missing-required-field" };
    }

    const id = parsed.resource?.id;
    const issueKey = typeof id === "number" ? String(id) : "";
    const state = parsed.resource?.fields?.["System.State"];
    const externalStatus = typeof state === "string" ? state : "";
    const synthetic = id === SYNTHETIC_RESOURCE_ID;

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
    const p = raw as AdoWorkItemPayload;
    const id = p.resource?.id;
    if (typeof id !== "number") return null;
    return {
      externalKey: String(id),
      externalSystem: "AZURE_DEVOPS" satisfies AdapterType,
    };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== "workitem.updated") return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as AdoWorkItemPayload;
    const state = p.resource?.fields?.["System.State"];
    return typeof state === "string" ? state : null;
  },
};
