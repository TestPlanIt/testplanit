/**
 * Live-update wake-up publisher.
 *
 * The contract: server-side event emitters (lib/webhooks/event-emitters/*.ts)
 * call `publishTestRunWakeUp(...)` after `webhookEvents.emit()` to nudge
 * SSE consumers that something changed. The published payload is JSON
 * over a Valkey pub/sub channel; consumers receive it on their SSE
 * connection and refetch the truth from REST (the pub/sub layer is
 * untrusted plumbing — Architectural Directive 2, mirrored from
 * notifications).
 *
 * Timing matters: emitters run INSIDE the caller's db.$transaction
 * (webhookEvents.emit requires a tx). If we published synchronously, a
 * consumer's refetch would race the not-yet-committed write. We defer
 * via setImmediate so the publish fires after the tx settles. On
 * rollback the consumer's refetch is a cheap no-op (data unchanged).
 *
 * Failures are swallowed: SSE is a wake-up signal, the DB row is the
 * source of truth. A missing wake-up just means the user sees the
 * update on next manual refresh or the next event.
 */

import { getCurrentTenantId } from "~/lib/multiTenantDb";
import valkeyConnection from "~/lib/valkey";
import {
  milestoneChannel,
  milestoneProjectChannel,
  testRunChannel,
  testRunProjectChannel,
} from "./channels";

/** Wake-up event names — narrower than the webhook event names because
 *  the client only cares about "something on this run changed" + a hint
 *  to decide which queries to invalidate. */
export type TestRunWakeUpEvent =
  | "test_run.created"
  | "test_run.result_added"
  | "test_run.state_changed"
  | "test_run.completed"
  | "test_run.case.status_changed";

interface TestRunWakeUp {
  event: TestRunWakeUpEvent;
  runId: number;
  /** Project the run belongs to. Required so the publisher can fan the
   *  same wake-up out to both the per-run channel (detail page consumer)
   *  and the per-project channel (list page consumer — one EventSource
   *  for the whole project, avoiding the HTTP/1.1 6-connection cap). */
  projectId: number;
  /** Sub-resource id when the event targets one (a resultId, caseId,
   *  etc.) — included so clients can invalidate finely. Optional. */
  targetId?: number;
}

export function publishTestRunWakeUp(payload: TestRunWakeUp): void {
  if (!valkeyConnection) return; // single-pod dev / SKIP_VALKEY_CONNECTION
  const tenantId = getCurrentTenantId() ?? "default";
  const runChan = testRunChannel(tenantId, payload.runId);
  const projChan = testRunProjectChannel(tenantId, payload.projectId);
  const body = JSON.stringify(payload);
  // Defer past the surrounding tx commit boundary so consumers' refetches
  // observe the committed write.
  setImmediate(() => {
    const conn = valkeyConnection;
    if (!conn) return;
    conn.publish(runChan, body).catch((err: unknown) =>
      console.warn(`[live/publish] testRun wake-up failed (per-run)`, {
        channel: runChan,
        event: payload.event,
        runId: payload.runId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    conn.publish(projChan, body).catch((err: unknown) =>
      console.warn(`[live/publish] testRun wake-up failed (per-project)`, {
        channel: projChan,
        event: payload.event,
        runId: payload.runId,
        projectId: payload.projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  });
}

/** Wake-up event names for milestone sync/lifecycle changes (HOOK-01/02/03,
 *  D-13/D-14). The client only cares about "something on this milestone
 *  changed" + a hint to decide which queries to invalidate — never data. */
export type MilestoneWakeUpEvent =
  | "milestone.created"
  | "milestone.updated"
  | "milestone.converted"
  | "milestone.membership_changed";

/** Thin wake-up payload — NEVER milestone data. Consumers refetch truth
 *  from REST (the pub/sub layer is untrusted plumbing, same model as
 *  Test Runs and notifications). */
export interface MilestoneWakeUp {
  event: MilestoneWakeUpEvent;
  milestoneId: number;
  /** Project the milestone belongs to. Required so the publisher can fan
   *  the same wake-up out to both the per-milestone channel (detail page
   *  consumer) and the per-project channel (list/import-picker consumer —
   *  one EventSource for the whole project, avoiding the HTTP/1.1
   *  6-connection cap). */
  projectId: number;
  /** Sub-resource id when the event targets one (e.g. a member issueId
   *  for membership_changed) — included so clients can invalidate finely.
   *  Optional. */
  targetId?: number;
}

export function publishMilestoneWakeUp(payload: MilestoneWakeUp): void {
  if (!valkeyConnection) return; // single-pod dev / SKIP_VALKEY_CONNECTION
  const tenantId = getCurrentTenantId() ?? "default";
  const milestoneChan = milestoneChannel(tenantId, payload.milestoneId);
  const projChan = milestoneProjectChannel(tenantId, payload.projectId);
  const body = JSON.stringify(payload);
  // Defer past the surrounding tx commit boundary so consumers' refetches
  // observe the committed write.
  setImmediate(() => {
    const conn = valkeyConnection;
    if (!conn) return;
    conn.publish(milestoneChan, body).catch((err: unknown) =>
      console.warn(`[live/publish] milestone wake-up failed (per-milestone)`, {
        channel: milestoneChan,
        event: payload.event,
        milestoneId: payload.milestoneId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    conn.publish(projChan, body).catch((err: unknown) =>
      console.warn(`[live/publish] milestone wake-up failed (per-project)`, {
        channel: projChan,
        event: payload.event,
        milestoneId: payload.milestoneId,
        projectId: payload.projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  });
}
