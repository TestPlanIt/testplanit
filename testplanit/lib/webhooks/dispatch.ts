import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { decrypt } from "~/utils/encryption";

import { getOutboundAdapter } from "./adapters";
import type {
  OutboundEnvelope,
  OutboundWebhookAdapter,
} from "./adapters/types";
import { matchesSubscription } from "./subscription-matching";

/**
 * v0.23.0 Phase 2 (OUT-10) — outbound webhook dispatch service.
 *
 * Single async entry point that the dispatch worker (Task 4.4) calls per job.
 * Loads outbox event + WebhookConfig + active/retiring secrets, picks the
 * adapter via getOutboundAdapter, formats body, signs (if applicable), HTTPs
 * out with a 10s AbortSignal timeout, writes a WebhookDelivery row carrying
 * attempt + statusCode + latencyMs + payloadDigest + error sentinel, and
 * emits a WEBHOOK_DISPATCHED audit event on every attempt (D-25).
 *
 * Error mapping (RESEARCH Pattern 5):
 *   - HTTP 2xx           → outcome="success"; no throw
 *   - non-2xx            → error="<status>_<truncated_body>"; THROWS so BullMQ retries
 *   - AbortSignal timeout (DOMException name="TimeoutError") → "TIMEOUT"; THROWS
 *   - cause.code === "ECONNREFUSED"      → "CONNECTION_REFUSED"; THROWS
 *   - cause.code === "ENOTFOUND"         → "DNS_FAILURE"; THROWS
 *   - cause.code starts with "ERR_TLS_"  → "TLS_ERROR"; THROWS
 *   - other Error         → truncated err.message; THROWS
 *
 * Subscription gate (Blocker 6 / D-28): the dispatcher is the single policy
 * enforcement point for "should this event reach this destination". For all
 * real events, matchesSubscription decides. For the synthetic diagnostic
 * event "webhook.test" (fired by Plan 02-06's sendTestOutboundWebhook server
 * action), the bypass forces dispatch regardless of subscriptions.
 *
 * Attempt threading: jobData.attempt is treated as authoritative. The Worker
 * processor (Task 4.4) is responsible for setting attempt = job.attemptsMade + 1
 * before invoking this function so each WebhookDelivery row carries the
 * correct 1-indexed attempt number per OUT-03 (Blocker 2 fix).
 */

export interface DispatchJobData {
  outboxEventId: string;
  webhookConfigId: string;
  attempt: number;
  // Aligned with MultiTenantJobData (lib/multiTenantPrisma.ts) and the
  // withTenantContext shape (lib/tenantContext.ts) — both expect
  // `tenantId?: string`. Single-tenant deployments simply omit this.
  tenantId?: string;
  // Plan 04-05 / ADMIN-02 — when this dispatch is a replay of an older
  // WebhookDelivery row, the replay service (lib/webhooks/replay.ts) sets
  // this to the original delivery's id. Threaded onto the new
  // WebhookDelivery row so admins can chain replay history in the UI.
  replayedFromDeliveryId?: string | null;
}

export type DispatchOutcome =
  | { outcome: "success"; statusCode: number; deliveryId: string }
  | {
      outcome: "failure";
      statusCode: number | null;
      error: string;
      deliveryId: string;
    }
  | { outcome: "skipped_unsubscribed" }
  | { outcome: "skipped_inactive" };

const HTTP_TIMEOUT_MS = 10_000; // OUT-04
const MAX_ERROR_LEN = 1024;

/** D-28 / Blocker 6 — synthetic event from sendTestOutboundWebhook bypasses subscription matching. */
const DIAGNOSTIC_EVENT_NAME = "webhook.test" as const;

export async function dispatchWebhook(
  jobData: DispatchJobData,
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<DispatchOutcome> {
  // 1. Load outbox event + webhook config + active/retiring secrets concurrently.
  const [outboxEvent, config] = await Promise.all([
    prisma.webhookOutboxEvent.findUnique({
      where: { id: jobData.outboxEventId },
    }),
    prisma.webhookConfig.findUnique({
      where: { id: jobData.webhookConfigId },
      include: {
        secrets: {
          where: { retiredAt: null },
          orderBy: { activatedAt: "desc" },
        },
        project: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!outboxEvent) {
    throw new Error(`outbox event ${jobData.outboxEventId} not found`);
  }
  if (!config) return { outcome: "skipped_inactive" };
  if (!config.isActive) return { outcome: "skipped_inactive" };
  if (!config.url) {
    // Defense: OUTBOUND configs must have a URL; INBOUND configs reach this
    // dispatcher only if the fan-out filter is bypassed somehow. Treat as
    // inactive rather than crash.
    return { outcome: "skipped_inactive" };
  }
  // Plan 04-05 / DEL-05 — DISABLED gate. When the health state machine has
  // auto-disabled the endpoint (DEL-06: 10 consecutive event-level
  // failures) we MUST NOT fire the HTTP request, but we still write a
  // delivery row with error="endpoint_disabled" + emit a WEBHOOK_DISPATCHED
  // failure audit so the admin's Deliveries tab surfaces the rejection
  // (D-16: rejection reasons inline on the new row, no parallel error
  // model). Replay-against-disabled paths land here too — jobData.
  // replayedFromDeliveryId still threads onto the stub row so the chain is
  // visible (Test R3).
  if (config.endpointHealth === "DISABLED") {
    const stubDigest = createHash("sha256")
      .update(JSON.stringify(outboxEvent.payload))
      .digest("hex");
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookConfigId: config.id,
        direction: "OUTBOUND",
        adapterType: config.adapterType,
        eventType: outboxEvent.eventName,
        eventId: outboxEvent.eventId,
        statusCode: null,
        latencyMs: 0,
        payloadDigest: stubDigest,
        error: "endpoint_disabled",
        attempt: jobData.attempt,
        replayedFromDeliveryId: jobData.replayedFromDeliveryId ?? null,
      },
    });
    await emitAudit({
      deliveryId: delivery.id,
      projectId: config.projectId,
      configId: config.id,
      eventId: outboxEvent.eventId,
      eventName: outboxEvent.eventName,
      attempt: jobData.attempt,
      statusCode: null,
      outcome: "failure",
      error: "endpoint_disabled",
    });
    return {
      outcome: "failure",
      statusCode: null,
      error: "endpoint_disabled",
      deliveryId: delivery.id,
    };
  }
  // Subscription gate (Blocker 6 — webhook.test bypasses the gate so admin
  // diagnostics always reach the destination regardless of subscription state).
  if (
    outboxEvent.eventName !== DIAGNOSTIC_EVENT_NAME &&
    !matchesSubscription(outboxEvent.eventName, config.subscribedEvents)
  ) {
    return { outcome: "skipped_unsubscribed" };
  }

  // 2. Build envelope (OUT-20 / D-14).
  const envelope: OutboundEnvelope = {
    eventId: outboxEvent.eventId,
    eventName: outboxEvent.eventName,
    eventTimestamp: outboxEvent.eventTimestamp.toISOString(),
    tenantId: jobData.tenantId ?? null,
    projectId: config.projectId,
    projectName: config.project.name,
    actorUserId: outboxEvent.actorUserId,
    data: outboxEvent.payload as Record<string, unknown>,
  };

  // 3. Pick adapter, format body.
  const adapter: OutboundWebhookAdapter = getOutboundAdapter(
    config.adapterType
  );
  const formatted = adapter.format(envelope);
  const body = formatted.body;
  const payloadDigest = createHash("sha256").update(body).digest("hex");

  // 4. Sign if applicable.
  let signedHeaders: Record<string, string> = {};
  if (adapter.sign) {
    const activeRow = config.secrets.find(
      (s: { autoRetireAt: Date | null }) => s.autoRetireAt === null
    );
    const retiringRow = config.secrets.find(
      (s: { autoRetireAt: Date | null; retiredAt: Date | null }) =>
        s.autoRetireAt !== null && s.retiredAt === null
    );
    if (!activeRow) {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookConfigId: config.id,
          direction: "OUTBOUND",
          adapterType: config.adapterType,
          eventType: outboxEvent.eventName,
          eventId: outboxEvent.eventId,
          statusCode: null,
          latencyMs: 0,
          payloadDigest,
          error: "NO_ACTIVE_SECRET",
          attempt: jobData.attempt,
          replayedFromDeliveryId: jobData.replayedFromDeliveryId ?? null,
        },
      });
      await emitAudit({
        deliveryId: delivery.id,
        projectId: config.projectId,
        configId: config.id,
        eventId: outboxEvent.eventId,
        eventName: outboxEvent.eventName,
        attempt: jobData.attempt,
        statusCode: null,
        outcome: "failure",
      });
      return {
        outcome: "failure",
        statusCode: null,
        error: "NO_ACTIVE_SECRET",
        deliveryId: delivery.id,
      };
    }
    const activeSecret = await decrypt(activeRow.secret);
    const retiringSecret = retiringRow
      ? await decrypt(retiringRow.secret)
      : null;
    signedHeaders = adapter.sign(body, {
      active: activeSecret,
      retiring: retiringSecret,
    });
  }

  // 5. HTTP attempt OUTSIDE any DB tx.
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let errorSentinel: string | null = null;
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": formatted.contentType, ...signedHeaders },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    statusCode = response.status;
    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      errorSentinel = `${response.status}_${truncate(
        responseText,
        MAX_ERROR_LEN - 32
      )}`;
    }
  } catch (err) {
    errorSentinel = mapFetchError(err);
  }
  const latencyMs = Date.now() - startedAt;

  // 6. Write delivery row. Plan 04-05 / DEL-01 — eventId is stamped on
  // every outbound delivery row so admins can group by event in the
  // Deliveries tab and Plan 04-03's outbound replay path can find the
  // source outbox row by `delivery.eventId`. Plan 04-05 / ADMIN-02 —
  // replayedFromDeliveryId threads from BullMQ job data when this dispatch
  // is itself a replay (lib/webhooks/replay.ts enqueues the field).
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookConfigId: config.id,
      direction: "OUTBOUND",
      adapterType: config.adapterType,
      eventType: outboxEvent.eventName,
      eventId: outboxEvent.eventId,
      statusCode,
      latencyMs,
      payloadDigest,
      error: errorSentinel,
      attempt: jobData.attempt,
      replayedFromDeliveryId: jobData.replayedFromDeliveryId ?? null,
    },
  });

  // 7. Per-attempt timestamps (Plan 04-05 / DEL-08). One bundled UPDATE
  // per attempt: lastDispatchedAt always; lastSuccessAt on 2xx;
  // lastFailureAt on non-2xx / network error. The dispatcher writes
  // ONLY these timestamps on WebhookConfig — the health-state seam
  // (failure-counter + endpointHealth flip) is owned by the BullMQ
  // worker hook (workers/webhookDispatchWorker.ts) which calls
  // health.transition() on terminal `failed` / `completed`. CONTEXT
  // D-10 locks the event-level (not per-attempt) counter contract.
  const now = new Date();
  const timestampUpdate: Prisma.WebhookConfigUncheckedUpdateInput = {
    lastDispatchedAt: now,
  };
  if (errorSentinel === null) {
    timestampUpdate.lastSuccessAt = now;
  } else {
    timestampUpdate.lastFailureAt = now;
  }
  await prisma.webhookConfig.update({
    where: { id: config.id },
    data: timestampUpdate,
  });

  // 8. Audit on every attempt (D-25).
  await emitAudit({
    deliveryId: delivery.id,
    projectId: config.projectId,
    configId: config.id,
    eventId: outboxEvent.eventId,
    eventName: outboxEvent.eventName,
    attempt: jobData.attempt,
    statusCode,
    outcome: errorSentinel ? "failure" : "success",
  });

  // 9. Throw on failure so BullMQ retries.
  if (errorSentinel !== null) {
    const err = new Error(errorSentinel);
    (err as Error & { deliveryId?: string }).deliveryId = delivery.id;
    throw err;
  }
  return {
    outcome: "success",
    statusCode: statusCode as number,
    deliveryId: delivery.id,
  };
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function mapFetchError(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "TIMEOUT";
  }
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    const code = cause?.code;
    if (code === "ECONNREFUSED") return "CONNECTION_REFUSED";
    if (code === "ENOTFOUND") return "DNS_FAILURE";
    if (
      typeof code === "string" &&
      (code === "EPROTO" || code.startsWith("ERR_TLS_"))
    ) {
      return "TLS_ERROR";
    }
    return truncate(err.message, MAX_ERROR_LEN);
  }
  return "UNKNOWN_ERROR";
}

async function emitAudit(args: {
  deliveryId: string;
  projectId: number;
  configId: string;
  eventId: string;
  eventName: string;
  attempt: number;
  statusCode: number | null;
  outcome: "success" | "failure";
  // Plan 04-05 / DEL-05 — optional error sentinel surfaced in audit
  // metadata. Currently used for the DISABLED gate ("endpoint_disabled");
  // future error-flavored audit metadata can flow through this same field.
  error?: string;
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    webhookConfigId: args.configId,
    eventId: args.eventId,
    eventName: args.eventName,
    attempt: args.attempt,
    statusCode: args.statusCode,
    outcome: args.outcome,
  };
  if (args.error !== undefined) {
    metadata.error = args.error;
  }
  await captureAuditEvent({
    action: "WEBHOOK_DISPATCHED",
    entityType: "WebhookDelivery",
    entityId: args.deliveryId,
    projectId: args.projectId,
    userId: SYSTEM_ACTOR_ID,
    metadata,
  });
}
