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
 * Timing matters: emitters run INSIDE the caller's prisma.$transaction
 * (webhookEvents.emit requires a tx). If we published synchronously, a
 * consumer's refetch would race the not-yet-committed write. We defer
 * via setImmediate so the publish fires after the tx settles. On
 * rollback the consumer's refetch is a cheap no-op (data unchanged).
 *
 * Failures are swallowed: SSE is a wake-up signal, the DB row is the
 * source of truth. A missing wake-up just means the user sees the
 * update on next manual refresh or the next event.
 */

import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import valkeyConnection from "~/lib/valkey";
import { testRunChannel } from "./channels";

/** Wake-up event names — narrower than the webhook event names because
 *  the client only cares about "something on this run changed" + a hint
 *  to decide which queries to invalidate. */
export type TestRunWakeUpEvent =
  | "test_run.result_added"
  | "test_run.state_changed"
  | "test_run.completed"
  | "test_run.case.status_changed";

interface TestRunWakeUp {
  event: TestRunWakeUpEvent;
  runId: number;
  /** Sub-resource id when the event targets one (a resultId, caseId,
   *  etc.) — included so clients can invalidate finely. Optional. */
  targetId?: number;
}

export function publishTestRunWakeUp(payload: TestRunWakeUp): void {
  if (!valkeyConnection) return; // single-pod dev / SKIP_VALKEY_CONNECTION
  const tenantId = getCurrentTenantId() ?? "default";
  const channel = testRunChannel(tenantId, payload.runId);
  const body = JSON.stringify(payload);
  // Defer past the surrounding tx commit boundary so consumers' refetches
  // observe the committed write.
  setImmediate(() => {
    valkeyConnection
      ?.publish(channel, body)
      .catch((err: unknown) =>
        console.warn(`[live/publish] testRun wake-up failed`, {
          channel,
          event: payload.event,
          runId: payload.runId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
  });
}
