// Iteration result emitter — implementation lands with INT-04.

import type { Prisma } from "@prisma/client";

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
 */
export async function emitIterationResultRecorded(
  payload: IterationResultRecordedPayload,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Silence unused-param lints while the stub remains pre-implementation.
  void payload;
  void tx;
  void opts;
  throw new Error(
    "emitIterationResultRecorded: not implemented yet (lands with INT-04)"
  );
}
