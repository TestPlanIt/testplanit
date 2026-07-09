import { describe, it } from "vitest";

/**
 * Wave 0 RED scaffold (19-01) for `applyInboundMilestoneEvent` — the
 * not-yet-created sibling to `applyInboundIssueUpdate.ts` that routes
 * Jira `jira:version_*`/`sprint_*` webhook events to MilestoneSyncService
 * instead of the Issue-update path. Implemented in Plan 04 (HOOK-01).
 *
 * Every behavior below is enumerated with `it.todo(...)` rather than a
 * failing assertion so the Wave 0 suite runs green-on-todo (Nyquist
 * sampling stays clean while every required behavior is pinned for later
 * plans to fill in). Deliberately NO top-level import of the not-yet-
 * existing `./applyInboundMilestoneEvent` module — `it.todo` bodies never
 * execute, so a static import would only serve to crash the suite at
 * transform time for no verification benefit.
 *
 * See: .planning/phases/19-webhooks-lifecycle/19-VALIDATION.md
 *      (19-04-T3 fills these green), 19-PATTERNS.md (applyInboundIssueUpdate
 *      analog), 19-RESEARCH.md Pitfall 6 (webhook project resolution).
 */

describe("applyInboundMilestoneEvent", () => {
  // HOOK-01: a jira:version_updated event for a linked milestone triggers
  // performMilestoneRefresh with the webhook freshness window.
  it.todo(
    "HOOK-01: jira:version_updated for a linked milestone calls performMilestoneRefresh with minFreshnessSeconds:15"
  );

  it.todo(
    "HOOK-01: jira:version_created is a no-op when the project's auto-track setting is OFF (D-02)"
  );

  it.todo(
    "HOOK-01: sprint_updated resolves its project via board->project lookup, not payload.project (sprints carry no project field)"
  );

  // D-03: site-wide admin webhooks fire for projects/boards TestPlanIt
  // doesn't track — that is expected, not an error.
  it.todo(
    "HOOK-01/D-03: an event whose resolved project has no active integration mapping is silently acked (200) with NO write"
  );

  // Pitfall 6: the receiving WebhookConfig.projectId is NOT necessarily the
  // event's own project — must resolve project from the payload, never
  // assume it equals webhookConfig.projectId.
  it.todo(
    "Pitfall 6: resolves the milestone event's own project from the payload, never assumes webhookConfig.projectId"
  );

  // HOOK-02: delete/merge events convert the milestone to local instead of
  // refreshing it.
  it.todo(
    "HOOK-02: jira:version_deleted calls convertMilestoneToLocal with reason 'deleted'"
  );

  it.todo(
    "HOOK-02: a version merged into another (payload.mergedTo present) calls convertMilestoneToLocal with reason 'merged' and the merge target's external id"
  );

  it.todo(
    "HOOK-02: sprint_deleted calls convertMilestoneToLocal with reason 'deleted'"
  );

  // Route-level dispatch: version/sprint eventTypes route here; issue
  // eventTypes keep routing to applyInboundIssueUpdate unchanged.
  it.todo(
    "route dispatch: jira:version_* and sprint_* eventTypes route to applyInboundMilestoneEvent"
  );

  it.todo(
    "route dispatch: issue eventTypes (jira:issue_updated etc.) continue to route to applyInboundIssueUpdate, unaffected by this service's addition"
  );

  it.todo(
    "webhook delivery/dedup transaction shape mirrors applyInboundIssueUpdate: delivery row always inserted first, pre-INSERT SELECT dedup check, shared finalize tail for every outcome"
  );

  it.todo(
    "audit emission: WEBHOOK_RECEIVED on the WebhookDelivery row, awaited, after tx commit — separate from convertMilestoneToLocal's own audit event"
  );
});
