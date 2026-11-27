import { timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
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
  /** On milestone events: create, close, reopen or delete. */
  action?: string;
  object_attributes?: {
    /** The milestone's id on a milestone event; the issue's on an issue event. */
    id?: number;
    iid?: number;
    state?: string;
    title?: string;
    action?: string;
  };
  changes?: Record<string, { previous?: unknown; current?: unknown }>;
  project?: {
    path_with_namespace?: string;
  };
}

const MILESTONE_EVENT = "Milestone Hook";
const ISSUE_EVENT = "Issue Hook";

const MILESTONE_ACTIONS: Record<string, string> = {
  create: "milestone_created",
  close: "milestone_closed",
  reopen: "milestone_opened",
  delete: "milestone_deleted",
};

/** Fields GitLab stamps on every issue update, whatever was edited. */
const BOOKKEEPING_CHANGES = new Set(["updated_at", "updated_by_id"]);

/**
 * The milestone an issue update moved the issue into or out of, when that
 * is all the update did, and the one it left when it moved between two. An
 * update that also edits the issue stays an issue event so the edit is
 * applied.
 */
function milestoneMembershipChange(
  parsed: GitLabIssuePayload
): { eventType: string; milestoneId: number; leftMilestoneId?: number } | null {
  const change = parsed.changes?.milestone_id;
  if (!change) return null;
  const edited = Object.keys(parsed.changes ?? {}).filter(
    (key) => key !== "milestone_id" && !BOOKKEEPING_CHANGES.has(key)
  );
  if (edited.length > 0) return null;
  if (typeof change.current === "number") {
    return {
      eventType: "milestone_milestoned",
      milestoneId: change.current,
      ...(typeof change.previous === "number"
        ? { leftMilestoneId: change.previous }
        : {}),
    };
  }
  if (typeof change.previous === "number") {
    return {
      eventType: "milestone_demilestoned",
      milestoneId: change.previous,
    };
  }
  return null;
}

/**
 * GitLab's milestone event (create, close, reopen, delete) and an issue
 * update that only changes the issue's milestone become a
 * `milestone_<action>` event type, the shape the receiver route dispatches
 * to milestone sync. Everything else keeps the raw header value.
 */
function milestoneEventType(
  headerEvent: string,
  parsed: GitLabIssuePayload
): string | null {
  if (headerEvent === MILESTONE_EVENT) {
    return MILESTONE_ACTIONS[parsed.action ?? ""] ?? null;
  }
  if (headerEvent === ISSUE_EVENT) {
    return milestoneMembershipChange(parsed)?.eventType ?? null;
  }
  return null;
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

    const headerEvent = headers.get(EVENT_HEADER);
    if (!headerEvent) return { valid: false, reason: "missing-required-field" };

    let parsed: GitLabIssuePayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as GitLabIssuePayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const eventType = milestoneEventType(headerEvent, parsed) ?? headerEvent;

    const namespace = parsed.project?.path_with_namespace;
    const iid =
      headerEvent === MILESTONE_EVENT
        ? undefined
        : parsed.object_attributes?.iid;
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
      externalId: String(iid),
    };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== ISSUE_EVENT) return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GitLabIssuePayload;
    const state = p.object_attributes?.state;
    return typeof state === "string" ? state : null;
  },

  extractMilestoneEventRef(payload, eventType) {
    if (!eventType.startsWith("milestone_")) return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GitLabIssuePayload;
    const namespace = p.project?.path_with_namespace;
    const membership =
      p.object_kind === "milestone" ? null : milestoneMembershipChange(p);
    const milestoneId =
      p.object_kind === "milestone"
        ? p.object_attributes?.id
        : membership?.milestoneId;
    if (typeof namespace !== "string" || typeof milestoneId !== "number") {
      return null;
    }
    return {
      kind: "RELEASE",
      externalId: `${namespace}#${milestoneId}`,
      externalProjectId: namespace,
      merge: false,
      ...(membership?.leftMilestoneId !== undefined
        ? { movedFromExternalId: `${namespace}#${membership.leftMilestoneId}` }
        : {}),
    };
  },
};
