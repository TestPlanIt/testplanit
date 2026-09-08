// DataSetRow lease emitters — 999.12 implementation.
//
// Fire the `dataset.row.acquired` / `dataset.row.released` outbound webhook
// events from inside the caller's transaction so the outbox row commits
// atomically with the lease write (mirrors `emitIterationResultRecorded`).
//
// Callers:
//  - app/api/datasets/[dataSetId]/rows/acquire/route.ts  → acquired
//  - app/api/datasets/[dataSetId]/rows/[rowId]/release/route.ts → released ("released")
//  - workers/datasetLeaseSweepWorker.ts → released ("expired")
//
// SECURITY (mirrors the iterationEvents redaction boundary): the lease
// payload carries IDENTIFIERS ONLY. A DataSetRow's `valuesJson` can hold
// secrets (test-account credentials, API keys the fixture provisions), so it
// is NEVER placed on the broadcast webhook. The acquire HTTP *response* still
// returns `valuesJson` to the holder that authenticated for it; the fan-out
// to every subscriber does not.

import type { TxClient } from "~/lib/zenstack";

import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Identifier-only payload for both lease events. Deliberately omits
 * `valuesJson` (see file-level security note).
 */
export interface DatasetRowLeasePayload {
  dataSetId: number;
  rowId: number;
  rowIndex: number;
  label: string | null;
  projectId: number;
  /** Actor that held/holds the lease. Null for sweep-reaped expiries with no recorded holder. */
  leasedById: string | null;
  /** ISO string of the lease deadline at emit time (acquired: new deadline; released: the deadline being cleared). */
  leaseExpiresAt: string | null;
}

export interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

/**
 * Reason a lease was released. `released` = an explicit release call;
 * `expired` = the background sweep reaped a lease past its TTL.
 */
export type LeaseReleaseReason = "released" | "expired";

/**
 * Emit `dataset.row.acquired`. MUST be called inside the same
 * `$transaction` that writes the lease columns so the outbox row commits
 * atomically with the claim.
 */
export async function emitDatasetRowAcquired(
  payload: DatasetRowLeasePayload,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!tx) {
    throw new Error("emitDatasetRowAcquired requires a TxClient");
  }
  await webhookEvents.emit(
    "dataset.row.acquired",
    { ...payload },
    {
      projectId: opts.projectId ?? payload.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

/**
 * Emit `dataset.row.released` with the reason discriminator. MUST be called
 * inside the same `$transaction` that clears the lease columns.
 */
export async function emitDatasetRowReleased(
  payload: DatasetRowLeasePayload,
  reason: LeaseReleaseReason,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!tx) {
    throw new Error("emitDatasetRowReleased requires a TxClient");
  }
  await webhookEvents.emit(
    "dataset.row.released",
    { ...payload, reason },
    {
      projectId: opts.projectId ?? payload.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
