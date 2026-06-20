// Iteration result emitter — INT-04 implementation.
//
// Fires the `iteration.result.recorded` outbound webhook event from inside
// the submit-result transaction so the outbox row commits atomically with
// the iteration write (mirrors `emitTestRunCreated` contract).
//
// D-13 / Threat T-06-02-01: the `redactedValues` payload is assembled by
// the CALLER and MUST already reflect `viewerCanReadSensitive=false`. This
// emitter does NOT re-derive redaction — the boundary is single-direction
// (route computes once, emitter forwards). See
// `app/api/test-runs/submit-result/route.ts` for the call site that
// computes `webhookRedactedValues` separately from the audit redaction.

import type { TxClient } from "~/lib/zenstack";

import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Per-value cap for parameter values emitted into webhook payloads
 * (Pitfall 5 / T-06-02-02). Matches the cap in `testRunEvents.ts` so the
 * INT-03 and INT-04 surfaces share one ceiling.
 */
const WEBHOOK_VALUE_MAX_BYTES = 4 * 1024;

/**
 * Defense-in-depth: even though the caller in submit-result/route.ts already
 * redacts with `viewerCanReadSensitive=false`, a future caller might forget
 * to truncate large blob values. Cap any entry whose serialized UTF-8 byte
 * length exceeds 4 KB to `<value truncated: N bytes>` so the outbox row
 * never carries a 200-KB single value.
 *
 * WR-05: non-string values (nested objects, arrays) are JSON-serialized
 * before the byte check so a parameter value of `{"blob": "<200KB>"}`
 * is bounded just like a top-level string. The previous implementation
 * only checked `typeof v === "string"`, so a single non-string entry
 * could escape the cap entirely — defeating the Pitfall 5 / T-06-02-02
 * mitigation. The serialized cap is conservative (it includes JSON
 * structural overhead) but that is the wire-format intent.
 */
function capValueBytes(
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") {
      const bytes = Buffer.byteLength(v, "utf8");
      if (bytes > WEBHOOK_VALUE_MAX_BYTES) {
        out[k] = `<value truncated: ${bytes} bytes>`;
        continue;
      }
    } else if (v !== null && typeof v === "object") {
      let serialized: string;
      try {
        serialized = JSON.stringify(v);
      } catch {
        // Unserializable (cycle, BigInt) — drop to sentinel rather
        // than emit raw, which would break the subscriber's parser.
        out[k] = "<value truncated: unserializable>";
        continue;
      }
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > WEBHOOK_VALUE_MAX_BYTES) {
        out[k] = `<value truncated: ${bytes} bytes>`;
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Payload assembled at the iteration-result write site (submit-result tx).
 * `redactedValues` is the post-`redactValues()` map — sensitive params are
 * already replaced with `[REDACTED]` by the caller (D-13 boundary).
 */
export interface IterationResultRecordedPayload {
  iterationId: number;
  testRunCaseId: number;
  testRunId: number;
  statusId: number;
  projectId: number;
  rowIndex: number;
  redactedValues: Record<string, unknown>;
}

export interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

/**
 * Emit the `iteration.result.recorded` outbound webhook event. Must be
 * called inside the same `prisma.$transaction` that writes the iteration
 * result so the outbox row commits atomically with the result write
 * (mirrors `emitTestRunCreated` contract).
 *
 * Subscription matching uses the existing matcher unchanged:
 *
 *   1. Configs with an explicit non-empty `subscribedEvents` array will
 *      NOT receive this new event unless the admin opts in (D-06).
 *   2. Configs with an EMPTY `subscribedEvents` array WILL receive this
 *      event automatically — empty is interpreted as "all events" by
 *      the existing matcher (Pitfall 4 in 06-CONTEXT.md). WR-08:
 *      customers who picked "subscribe to everything" via the empty
 *      default will see a sudden event-storm on parameterized runs the
 *      moment INT-04 ships. This is a documented deviation from D-06's
 *      strict opt-in intent — surface it in the release notes for
 *      v0.25.0 so admins can either prune to a specific event list or
 *      acknowledge the extra deliveries.
 */
export async function emitIterationResultRecorded(
  payload: IterationResultRecordedPayload,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // The runtime guard in webhookEvents.emit also enforces this, but a
  // local check produces a more actionable error message for misuse.
  if (!tx) {
    throw new Error(
      "emitIterationResultRecorded requires a TxClient"
    );
  }
  const safePayload: IterationResultRecordedPayload = {
    ...payload,
    redactedValues: capValueBytes(payload.redactedValues),
  };
  // Resolve display names so the Slack formatter renders "Status — Run title"
  // instead of raw ids (read-only lookups; redaction boundary untouched).
  const [status, run] = await Promise.all([
    payload.statusId != null
      ? tx.status.findUnique({
          where: { id: payload.statusId },
          select: { name: true },
        })
      : Promise.resolve(null),
    tx.testRuns.findUnique({
      where: { id: payload.testRunId },
      select: { name: true },
    }),
  ]);
  await webhookEvents.emit(
    "iteration.result.recorded",
    {
      ...safePayload,
      statusName: status?.name ?? null,
      runTitle: run?.name ?? null,
    },
    {
      projectId: opts.projectId ?? payload.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
