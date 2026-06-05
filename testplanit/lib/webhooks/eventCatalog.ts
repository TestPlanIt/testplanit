/**
 * Published catalog of outbound webhook event names.
 *
 * This file is the single source of truth for "what events does TestPlanIt
 * emit?" — referenced by:
 *   - /api/webhooks/events           (the public catalog endpoint)
 *   - the user-guide docs page       (Data Lake & Webhooks)
 *   - the OpenAPI spec               (events enum)
 *
 * To add an event:
 *   1. Wire the emitter in lib/webhooks/event-emitters/<area>Events.ts
 *   2. Add a row here with a one-line description and an example payload
 *      shape (just the top-level keys are enough for the catalog; the full
 *      schema lives in the docs).
 *   3. If the event applies to a new entity family, group it under a new
 *      `category` value.
 *
 * The catalog is intentionally hand-curated rather than auto-discovered
 * because we want the descriptions to be human-friendly answers to the BBVA
 * §7.1.4 "list of internal triggers" question, not raw symbol dumps.
 */

export interface WebhookEventDefinition {
  /** Dot-namespaced event name (`<entity>.<verb>`). */
  name: string;
  /** Conceptual grouping shown in the docs and the catalog response. */
  category:
    | "test-case"
    | "test-run"
    | "iteration"
    | "session"
    | "issue"
    | "review"
    | "system";
  /** One-sentence human-readable description. */
  description: string;
  /** Top-level keys present in every payload of this type. */
  payloadKeys: string[];
}

export const WEBHOOK_EVENT_CATALOG: WebhookEventDefinition[] = [
  // --- Test cases ---
  {
    name: "case.created",
    category: "test-case",
    description: "A test case was created (manual or via import).",
    payloadKeys: [
      "id",
      "projectId",
      "name",
      "source",
      "automated",
      "createdAt",
    ],
  },
  {
    name: "case.updated",
    category: "test-case",
    description: "A test case's metadata, steps, or field values changed.",
    payloadKeys: ["id", "projectId", "name", "diff", "version"],
  },
  {
    name: "case.deleted",
    category: "test-case",
    description: "A test case was soft-deleted.",
    payloadKeys: ["id", "projectId"],
  },
  {
    name: "case.review_requested",
    category: "review",
    description: "A review was requested on a test case.",
    payloadKeys: ["reviewId", "caseId", "projectId", "requesterId", "dueAt"],
  },
  {
    name: "case.review_completed",
    category: "review",
    description: "A test-case review was decided (approved or rejected).",
    payloadKeys: ["reviewId", "caseId", "projectId", "decision", "reviewerId"],
  },
  {
    name: "case.review_reminder",
    category: "review",
    description: "A pending case review crossed its reminder threshold.",
    payloadKeys: ["reviewId", "caseId", "projectId", "reminderCount"],
  },

  // --- Test runs ---
  {
    name: "test_run.created",
    category: "test-run",
    description: "A test run was created.",
    payloadKeys: ["id", "projectId", "name", "configId", "milestoneId"],
  },
  {
    name: "test_run.duplicated",
    category: "test-run",
    description: "A test run was duplicated from an existing run.",
    payloadKeys: ["id", "sourceRunId", "projectId"],
  },
  {
    name: "test_run.completed",
    category: "test-run",
    description:
      "A test run was marked complete (state moved into a terminal state).",
    payloadKeys: ["id", "projectId", "completedAt", "summary"],
  },
  {
    name: "test_run.state_changed",
    category: "test-run",
    description: "A test run's workflow state transitioned.",
    payloadKeys: ["id", "projectId", "fromStateId", "toStateId"],
  },
  {
    name: "test_run.result_added",
    category: "test-run",
    description:
      "A result was recorded against a case in this run (one row per submit).",
    payloadKeys: [
      "id",
      "testRunId",
      "testRunCaseId",
      "statusId",
      "isPass",
      "isFail",
      "executedAt",
    ],
  },
  {
    name: "test_run.review_requested",
    category: "review",
    description: "A review was requested on a test run.",
    payloadKeys: ["reviewId", "testRunId", "projectId", "requesterId", "dueAt"],
  },
  {
    name: "test_run.review_completed",
    category: "review",
    description: "A test-run review was decided.",
    payloadKeys: ["reviewId", "testRunId", "projectId", "decision"],
  },
  {
    name: "test_run.review_reminder",
    category: "review",
    description: "A pending run review crossed its reminder threshold.",
    payloadKeys: ["reviewId", "testRunId", "projectId", "reminderCount"],
  },

  // --- Iterations ---
  {
    name: "iteration.result.recorded",
    category: "iteration",
    description:
      "A result was recorded against a specific iteration of a parameterized case.",
    payloadKeys: [
      "iterationId",
      "testRunId",
      "testRunCaseId",
      "statusId",
      "rowLabel",
    ],
  },

  // --- Sessions ---
  {
    name: "session.created",
    category: "session",
    description: "An exploratory session was created.",
    payloadKeys: ["id", "projectId", "name"],
  },
  {
    name: "session.duplicated",
    category: "session",
    description: "A session was duplicated from an existing session.",
    payloadKeys: ["id", "sourceSessionId", "projectId"],
  },
  {
    name: "session.completed",
    category: "session",
    description: "A session was marked complete.",
    payloadKeys: ["id", "projectId", "completedAt"],
  },
  {
    name: "session.state_changed",
    category: "session",
    description: "A session's workflow state transitioned.",
    payloadKeys: ["id", "projectId", "fromStateId", "toStateId"],
  },
  {
    name: "session.result_added",
    category: "session",
    description: "A session item (note, charter, defect) was recorded.",
    payloadKeys: ["id", "sessionId", "projectId"],
  },
  {
    name: "session.review_requested",
    category: "review",
    description: "A review was requested on a session.",
    payloadKeys: ["reviewId", "sessionId", "projectId", "requesterId", "dueAt"],
  },
  {
    name: "session.review_completed",
    category: "review",
    description: "A session review was decided.",
    payloadKeys: ["reviewId", "sessionId", "projectId", "decision"],
  },
  {
    name: "session.review_reminder",
    category: "review",
    description: "A pending session review crossed its reminder threshold.",
    payloadKeys: ["reviewId", "sessionId", "projectId", "reminderCount"],
  },

  // --- Issues ---
  {
    name: "issue.created",
    category: "issue",
    description: "An issue (defect) was created or linked from an integration.",
    payloadKeys: ["id", "projectId", "externalId", "title"],
  },
  {
    name: "issue.updated",
    category: "issue",
    description:
      "An issue's metadata, status, or linked cases changed (locally or via sync).",
    payloadKeys: ["id", "projectId", "diff"],
  },
  {
    name: "issue.deleted",
    category: "issue",
    description: "An issue was soft-deleted (unlinked).",
    payloadKeys: ["id", "projectId"],
  },

  // --- System ---
  {
    name: "webhook.test",
    category: "system",
    description:
      "Synthetic test event emitted by the admin UI to verify a webhook subscription works.",
    payloadKeys: ["subscriptionId", "projectId", "actorUserId"],
  },

  // --- SCIM Users (IdP-driven lifecycle) ---
  {
    name: "scim.user.created",
    category: "system",
    description: "A user was provisioned via SCIM (new row or JIT-first bind).",
    payloadKeys: [
      "id",
      "scimExternalId",
      "userName",
      "email",
      "active",
      "name",
      "createdAt",
    ],
  },
  {
    name: "scim.user.updated",
    category: "system",
    description: "A SCIM-provisioned user's attributes changed (PUT/PATCH).",
    payloadKeys: ["id", "scimExternalId", "userName", "email", "after", "diff"],
  },
  {
    name: "scim.user.activated",
    category: "system",
    description:
      "A SCIM-provisioned user was reactivated (active flipped to true).",
    payloadKeys: ["id", "scimExternalId", "userName"],
  },
  {
    name: "scim.user.deactivated",
    category: "system",
    description:
      "A SCIM-provisioned user was deactivated (active flipped to false).",
    payloadKeys: ["id", "scimExternalId", "userName"],
  },
  {
    name: "scim.user.deleted",
    category: "system",
    description: "A SCIM-provisioned user was tombstoned (DELETE).",
    payloadKeys: ["id", "scimExternalId"],
  },
];

/** Convenience accessor used by the catalog endpoint. */
export function listEventCatalog(): WebhookEventDefinition[] {
  return WEBHOOK_EVENT_CATALOG;
}
