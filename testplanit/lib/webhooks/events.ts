import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { getAuditContext, SYSTEM_ACTOR_ID } from "~/lib/auditContext";

/**
 * D-35 / D-01 / OUT-05 / OUT-20 — outbox emit seam.
 *
 * Called from:
 *  - lib/prisma.ts $extends middleware hooks (Plan 02-05) for testRuns,
 *    sessions, issue, repositoryCases, testRunResult, sessionResults —
 *    every emission site is alongside an existing auditCreate/Update/Delete
 *    call. Plan 02-05's middleware constructs an explicit
 *    `prisma.$transaction(async (tx) => ...)` that wraps the entity
 *    mutation AND this emit() call so both writes commit-or-rollback
 *    atomically (D-01 crash safety).
 *  - app/actions/webhook-config.ts sendTestOutboundWebhook (Plan 02-06)
 *    for the synthetic `webhook.test` event — also wrapped in
 *    prisma.$transaction.
 *
 * Crash safety: writes are MANDATORILY inside the caller's tx. The
 * outbox row commits with the entity change in the same DB transaction;
 * the worker (webhookOutboxWorker) picks it up async via SKIP LOCKED.
 *
 * **Why tx is required (not optional with singleton fallback):** Prisma
 * does NOT auto-route singleton-client calls into an active $transaction
 * via AsyncLocalStorage in v5/v6. The existing audit/ES sync hooks in
 * lib/prisma.ts work despite calling the singleton because they enqueue
 * to BullMQ (audit) or fire-and-forget promises (ES sync) — neither is
 * transactionally bound to the producing entity write. Phase 2's outbox
 * row MUST commit in the same tx as the entity (D-01); therefore the
 * caller MUST construct the tx explicitly and thread it here.
 *
 * Suppression: callers who don't want emission (backfill scripts,
 * migrations) call inside `runWithAuditContext({ suppressWebhooks: true }, ...)`.
 *
 * Actor resolution (matches captureAuditEvent at lib/services/auditLog.ts):
 *   const actorUserId = opts.actorUserId ?? ctx?.userId ?? null;
 * SYSTEM_ACTOR_ID, when passed explicitly, maps to NULL in the DB column
 * (no User row exists for the literal "__system__" value).
 */

export interface WebhookEventEmitOptions {
  /** Required: which project this event belongs to (Postgres FK on WebhookOutboxEvent.projectId). */
  projectId: number;
  /**
   * REQUIRED: the `Prisma.TransactionClient` returned by
   * `prisma.$transaction(async (tx) => ...)`. There is NO fallback to
   * the singleton client (Prisma does not route singleton calls into
   * an active tx via ALS — see file-level docs). Typed narrowly so the
   * type system rejects calls outside a transaction; runtime guard below
   * catches `as any` bypasses.
   */
  tx: Prisma.TransactionClient;
  /**
   * Optional explicit actor; when omitted, falls back to
   * `getAuditContext().userId`, then `null`. SYSTEM_ACTOR_ID, when passed
   * explicitly, maps to NULL in the DB column.
   */
  actorUserId?: string | null;
  /** Optional explicit timestamp (used by tests; production callers omit). */
  eventTimestamp?: Date;
}

export interface EmitResult {
  /** The `evt_<uuid-v4>` identifier persisted on this row. Stable across all WebhookDelivery retries (OUT-05). */
  eventId: string;
  /** The DB row id (cuid) — useful for correlating in tests. */
  outboxRowId: string;
}

export const webhookEvents = {
  /**
   * Write one WebhookOutboxEvent row inside the caller's transaction.
   * Returns the eventId so the caller can correlate downstream deliveries.
   * Returns null when emission is suppressed via auditContext.suppressWebhooks.
   */
  async emit(
    eventName: string,
    data: unknown,
    opts: WebhookEventEmitOptions
  ): Promise<EmitResult | null> {
    // Runtime guard — catches `as any` bypasses of the TypeScript contract.
    if (!opts || !opts.tx) {
      throw new Error(
        "webhookEvents.emit requires a Prisma.TransactionClient — see Plan 02-05 for transactional wiring"
      );
    }
    const ctx = getAuditContext();
    if (ctx?.suppressWebhooks === true) {
      // D-01a — suppression hatch
      return null;
    }
    const resolvedActorUserId =
      opts.actorUserId === SYSTEM_ACTOR_ID
        ? null
        : opts.actorUserId !== undefined
          ? opts.actorUserId
          : (ctx?.userId ?? null);
    const eventId = `evt_${randomUUID()}`;
    const eventTimestamp = opts.eventTimestamp ?? new Date();
    const row = await opts.tx.webhookOutboxEvent.create({
      data: {
        eventName,
        eventId,
        eventTimestamp,
        projectId: opts.projectId,
        actorUserId: resolvedActorUserId,
        payload: data as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { eventId, outboxRowId: row.id };
  },
};
