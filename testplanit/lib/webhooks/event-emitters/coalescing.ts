import { createHash } from "crypto";

import { ORMError } from "@zenstackhq/orm";
import type { TxClient } from "~/lib/zenstack";

import {
  SCIM_COALESCING_THRESHOLD,
  SCIM_COALESCING_WINDOW_MS,
} from "~/lib/scim/constants";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Outbound webhook coalescing helper.
 *
 * Folds a per-event emit into a single summary event when the rolling
 * 5-minute count for a given webhook config exceeds the threshold. This
 * keeps first-sync floods (e.g. an Okta bulk-assign of 500 group members)
 * from generating 500 outbound deliveries per subscribed config.
 *
 * Flow per call (executed once per matching, active WebhookConfig):
 *   1. Resolve matching configs (isActive + subscribedEvents has eventName).
 *   2. For each config, count dedup rows whose processedAt is inside the
 *      sliding 5-minute window.
 *   3. If count >= threshold: compute a deterministic summary digest from
 *      (eventName, windowStart-bucketed timestamp, configId). Attempt the
 *      dedup-row INSERT first; on P2002 (a concurrent emitter already wrote
 *      the same digest), skip silently. On success, emit the .summary event.
 *   4. Otherwise: write a per-event dedup row keyed by sha256 of the payload
 *      and emit the per-event payload to the outbox.
 *
 * Crash safety: every read and write threads the caller's
 * TxClient so the dedup row, the outbox row, and the
 * triggering business mutation all commit-or-rollback atomically.
 *
 * Why threshold-trip, not a timer:
 *   - No new BullMQ worker / scheduler dependency.
 *   - Deterministic in tests (no clock-dependent flake).
 *   - Race-safe via Postgres unique index on (webhookConfigId, payloadDigest).
 */

interface CoalescingOpts {
  projectId?: number;
  actorUserId?: string | null;
}

interface SummarablePayload {
  id?: unknown;
  members?: Array<{ value: string }>;
}

/**
 * Deterministic bigint key derived from the webhook config id, suitable as
 * a `pg_advisory_xact_lock` argument so two concurrent transactions that
 * touch the same config serialize their count-then-write sequence.
 *
 * Hashing strategy: take the first 8 bytes of sha256(configId) and read as
 * a signed BigInt (Postgres bigint is signed 64-bit). Collision probability
 * is negligible at any realistic config-count.
 */
function lockKeyFromConfigId(configId: string): bigint {
  const hash = createHash("sha256").update(configId).digest();
  return hash.readBigInt64BE(0);
}

function extractSampleIds(payload: unknown): string[] {
  const p = payload as SummarablePayload;
  if (Array.isArray(p.members) && p.members.length > 0) {
    return p.members.slice(0, 5).map((m) => m.value);
  }
  if (p.id !== undefined && p.id !== null) {
    return [String(p.id)];
  }
  return [];
}

function isUniqueConstraint(err: unknown): boolean {
  return err instanceof ORMError && err.dbErrorCode === "23505";
}

export async function emitWithCoalescing(
  eventName: string,
  payload: object,
  tx: TxClient,
  opts: CoalescingOpts
): Promise<void> {
  const perEventDigest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  const now = Date.now();
  const windowAgo = new Date(now - SCIM_COALESCING_WINDOW_MS);
  const windowStart = new Date(
    Math.floor(now / SCIM_COALESCING_WINDOW_MS) * SCIM_COALESCING_WINDOW_MS
  );

  const configs = await tx.webhookConfig.findMany({
    where: {
      isActive: true,
      subscribedEvents: { has: eventName },
    },
    select: { id: true },
  });

  for (const config of configs) {
    // Acquire a per-config advisory lock so the count → threshold check →
    // dedup row write below serializes across concurrent transactions that
    // target the same config. Without this, every parallel emitter sees a
    // pre-threshold count (READ COMMITTED snapshot) and bypasses
    // coalescing — exactly the flood scenario this helper is meant to
    // absorb. The lock is transaction-scoped and auto-released on
    // commit/rollback. Two emitters for DIFFERENT configs still proceed
    // in parallel because the lock key is config-specific.
    const lockKey = lockKeyFromConfigId(config.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey.toString()}::bigint)`;

    const windowCount = await tx.webhookEventDedup.count({
      where: {
        webhookConfigId: config.id,
        processedAt: { gt: windowAgo },
      },
    });

    if (windowCount >= SCIM_COALESCING_THRESHOLD) {
      const summaryDigest = createHash("sha256")
        .update(
          `${eventName}.summary:${windowStart.toISOString()}:${config.id}`
        )
        .digest("hex");

      try {
        await tx.webhookEventDedup.create({
          data: {
            webhookConfigId: config.id,
            payloadDigest: summaryDigest,
            processedAt: new Date(),
          },
        });
      } catch (err) {
        if (isUniqueConstraint(err)) {
          continue;
        }
        throw err;
      }

      // Compute the actual first-event time from the per-event dedup rows
      // already in the window. windowAgo is the *outer bound* of the window,
      // not when the burst started — using it as firstAt makes a sub-second
      // flood report as "over 5 minutes". The 10 per-event rows we wrote
      // before crossing the threshold give us the real start.
      const firstAggregate = await tx.webhookEventDedup.aggregate({
        where: {
          webhookConfigId: config.id,
          processedAt: { gt: windowAgo },
        },
        _min: { processedAt: true },
      });
      const firstAt = firstAggregate._min.processedAt ?? new Date();

      await webhookEvents.emit(
        `${eventName}.summary`,
        {
          count: windowCount + 1,
          firstAt,
          lastAt: new Date(),
          windowStart,
          sampleIds: extractSampleIds(payload),
        },
        {
          tx,
          projectId: opts.projectId ?? -1,
          actorUserId: opts.actorUserId ?? null,
        }
      );
    } else {
      await tx.webhookEventDedup.create({
        data: {
          webhookConfigId: config.id,
          payloadDigest: perEventDigest,
          processedAt: new Date(),
        },
      });

      await webhookEvents.emit(eventName, payload, {
        tx,
        projectId: opts.projectId ?? -1,
        actorUserId: opts.actorUserId ?? null,
      });
    }
  }
}
