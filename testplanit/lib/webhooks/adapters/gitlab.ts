import { timingSafeEqual } from "node:crypto";
import type { AdapterType } from "@prisma/client";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

// GitLab project webhooks authenticate via X-Gitlab-Token — a raw secret
// token (not HMAC). The admin pastes the same value into both the GitLab
// webhook settings and TestPlanIt. We compare with constant-time equality.
const TOKEN_HEADER = "x-gitlab-token";
const EVENT_HEADER = "x-gitlab-event";

// Synthetic binding sentinels. GitLab issue iid values are positive integers ≥ 1,
// so iid === 0 is non-forgeable by a real GitLab instance.
const SYNTHETIC_NAMESPACE = "__synthetic__/__synthetic__";
const SYNTHETIC_IID = 0;

interface GitLabIssuePayload {
  object_kind?: string;
  object_attributes?: {
    iid?: number;
    state?: string;
    title?: string;
  };
  project?: {
    path_with_namespace?: string;
  };
}

function safeEqualUtf8(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const gitlabAdapter: WebhookAdapter = {
  adapterType: "GITLAB" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const token = headers.get(TOKEN_HEADER);
    if (!token) return { valid: false, reason: "missing-signature" };
    if (!safeEqualUtf8(token, secret)) {
      return { valid: false, reason: "signature-mismatch" };
    }

    const eventType = headers.get(EVENT_HEADER);
    if (!eventType) return { valid: false, reason: "missing-required-field" };

    let parsed: GitLabIssuePayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as GitLabIssuePayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const namespace = parsed.project?.path_with_namespace;
    const iid = parsed.object_attributes?.iid;
    const issueKey =
      typeof namespace === "string" && typeof iid === "number"
        ? `${namespace}#${iid}`
        : "";
    const externalStatus =
      typeof parsed.object_attributes?.state === "string"
        ? parsed.object_attributes.state
        : "";
    const synthetic =
      namespace === SYNTHETIC_NAMESPACE && iid === SYNTHETIC_IID;

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
    const p = raw as GitLabIssuePayload;
    const namespace = p.project?.path_with_namespace;
    const iid = p.object_attributes?.iid;
    if (typeof namespace !== "string" || typeof iid !== "number") return null;
    return {
      externalKey: `${namespace}#${iid}`,
      externalSystem: "GITLAB" satisfies AdapterType,
    };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== "Issue Hook") return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GitLabIssuePayload;
    const state = p.object_attributes?.state;
    return typeof state === "string" ? state : null;
  },
};
