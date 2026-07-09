import type { AdapterType } from "~/zenstack/models";

/** A successfully parsed inbound webhook payload. */
export interface ParsedWebhookPayload {
  /** Event identifier, e.g. "jira:issue_updated". Used for delivery row eventType column. */
  eventType: string;
  /** External system's issue key (Jira: "DEMO-42"; GitHub: PR/issue number; ADO: work item id). */
  issueKey: string;
  /** Raw external status string, written verbatim into Issue.externalStatus. */
  externalStatus: string;
  /** True for self-test pings; receiver short-circuits AFTER dedup INSERT but BEFORE Issue lookup. */
  synthetic: boolean;
  /**
   * Raw parsed JSON body — adapter-specific shape. Carried through so
   * `extractLinkedIssueRef` and `extractExternalStatus` can read original payload
   * fields (e.g. Jira `issue.fields.status.name`, GitHub `repository.full_name`,
   * ADO `resource.fields["System.State"]`) without depending on `verify()`'s
   * denormalized flat fields. Optional for back-compat with tests that
   * construct `ParsedWebhookPayload` mocks; production `verify()` always sets it.
   */
  data?: unknown;
}

/** Verifier success branch. */
export interface VerifyOk {
  valid: true;
  payload: ParsedWebhookPayload;
}

/** Verifier failure branch — never throws; always returns this. */
export interface VerifyFail {
  valid: false;
  /** Stable, non-PII machine-readable code. Receiver maps this to HTTP status. */
  reason:
    | "missing-signature"
    | "malformed-signature"
    | "signature-mismatch"
    | "unparseable-body"
    | "missing-required-field"
    | "missing-auth"
    | "auth-mismatch";
}

export type VerifyResult = VerifyOk | VerifyFail;

/**
 * Discriminated ref extracted from a jira:version_* / sprint_* payload —
 * everything `applyInboundMilestoneEvent` needs to resolve the event's OWN
 * project (Pitfall 6) and dispatch refresh vs convert (Pattern 3).
 */
export type MilestoneEventRef =
  | {
      kind: "RELEASE";
      externalId: string;
      /** Present on version events; absent on sprint events (Pitfall 2). */
      externalProjectId: string;
      /** True on `jira:version_deleted` when `mergedTo` is present, or a
       *  literal `jira:version_merged` eventType alias (RESEARCH.md A2). */
      merge: boolean;
      /** The merge target's external version id, when `merge` is true. */
      mergedToExternalId?: string;
    }
  | {
      kind: "ITERATION";
      externalId: string;
      /** Sprints carry no project field — only the origin board id, which
       *  the caller resolves to a project via JiraAdapter.resolveBoardProject. */
      originBoardId: string;
    };

export interface WebhookAdapter {
  readonly adapterType: AdapterType;
  /**
   * Pure function: verify HMAC signature against rawBody+secret, then parse.
   * MUST NOT do I/O (no DB, no fetch, no fs). All I/O happens in the route handler.
   */
  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult;

  extractLinkedIssueRef(payload: unknown): {
    externalKey: string;
    externalSystem: AdapterType;
  } | null;

  extractExternalStatus(payload: unknown, eventType: string): string | null;

  /**
   * Extracts the milestone identity + project-resolution fields from a
   * jira:version_* / sprint_* payload. Optional — only adapters with
   * milestone-sync support (Jira today) implement this; the receiver route
   * dispatches to it only for eventTypes matching the version_/sprint_
   * prefix shape.
   */
  extractMilestoneEventRef?(
    payload: unknown,
    eventType: string
  ): MilestoneEventRef | null;
}

export interface OutboundEnvelope {
  /** Stable across retries. UUID v4 prefixed with "evt_". */
  eventId: string;
  /** "<entity>.<verb>" (e.g. "test_run.completed"). */
  eventName: string;
  /** ISO-8601 with Z suffix. */
  eventTimestamp: string;
  /** Tenant ID for multi-tenant deployments; matches `process.env.TENANT_ID` shape. */
  tenantId: string | null;
  projectId: number;
  projectName: string;
  /** null when actor is the system (e.g. backfill, scheduled job). */
  actorUserId: string | null;
  /** Event-specific data — shape varies per eventName. */
  data: Record<string, unknown>;
}

/** Output of an adapter's format() function — the HTTP body + content type. */
export interface FormattedHttpRequest {
  /** Pre-stringified JSON ready to send. The dispatcher does NOT re-stringify. */
  body: string;
  contentType: string;
}

/** Signing-secret set passed to sign(). */
export interface SigningSecretSet {
  /** Plaintext active secret (already decrypted by the dispatcher before calling sign). */
  active: string;
  /** Plaintext retiring secret during the 7-day overlap window. Null in steady state. */
  retiring?: string | null;
}

/** Headers returned by sign() — merged with the dispatcher's base headers (Content-Type, etc.). */
export type SignatureHeaders = Record<string, string>;

export interface OutboundWebhookAdapter {
  readonly adapterType: AdapterType;
  /**
   * Pure function: shape an envelope into the wire payload the destination expects.
   * Slack returns Block Kit JSON; generic-HMAC returns the envelope verbatim.
   * MUST NOT do I/O.
   */
  format(envelope: OutboundEnvelope): FormattedHttpRequest;
  /**
   * Optional signing function (Slack omits this since the URL is the
   * credential). When present, the dispatcher calls it after format() with
   * the produced body string and the active+retiring secret set, and merges
   * the returned headers into the outgoing request.
   */
  sign?(body: string, secrets: SigningSecretSet): SignatureHeaders;
}
