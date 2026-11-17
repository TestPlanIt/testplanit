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

/** A work item field as a resource carries it: the value itself, or, on an
 *  update's list of changed fields, the value before and after. */
type AdoFieldValue = string | { oldValue?: string; newValue?: string };

interface AdoWorkItemPayload {
  eventType?: string;
  resource?: {
    /** The work item's id on workitem.created; on workitem.updated, the
     *  update's own number, with the work item's id in `workItemId`. */
    id?: number;
    workItemId?: number;
    fields?: { "System.State"?: AdoFieldValue };
    /** On workitem.updated, the work item as it stands after the update. */
    revision?: { id?: number; fields?: { "System.State"?: string } };
  };
}

/** The work item events that are about one work item's own fields. */
const ISSUE_EVENTS = new Set(["workitem.created", "workitem.updated"]);

function workItemIdOf(p: AdoWorkItemPayload): number | undefined {
  const r = p.resource;
  for (const id of [r?.workItemId, r?.revision?.id, r?.id]) {
    if (typeof id === "number") return id;
  }
  return undefined;
}

function stateOf(p: AdoWorkItemPayload): string | null {
  const current = p.resource?.revision?.fields?.["System.State"];
  if (typeof current === "string") return current;
  const state = p.resource?.fields?.["System.State"];
  if (typeof state === "string") return state;
  if (typeof state?.newValue === "string") return state.newValue;
  return null;
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

    const id = workItemIdOf(parsed);
    const issueKey = typeof id === "number" ? String(id) : "";
    const externalStatus = stateOf(parsed) ?? "";
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
    const id = workItemIdOf(raw as AdoWorkItemPayload);
    if (typeof id !== "number") return null;
    return {
      externalKey: String(id),
      externalSystem: "AZURE_DEVOPS" satisfies AdapterType,
      externalId: String(id),
    };
  },

  extractExternalStatus(payload, eventType) {
    if (!ISSUE_EVENTS.has(eventType)) return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    // An update that leaves the state alone is still an event about the
    // work item; the sync reads its current state from Azure DevOps.
    return stateOf(raw as AdoWorkItemPayload) ?? "";
  },
};
