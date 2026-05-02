import type { EndpointHealth, Prisma, PrismaClient } from "@prisma/client";

import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { prisma as defaultPrisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";

/**
 * Endpoint health state machine.
 *
 * Called by the BullMQ dispatch worker hook on terminal failure and on
 * completed; the consecutiveFailureCount counter increments only at the
 * event-level (BullMQ "failed" after retries exhausted). Per-attempt
 * timestamps (lastDispatchedAt) are updated by dispatch.ts; this helper
 * owns lastFailureAt + lastSuccessAt + the state-counter seam.
 *
 * State table (locked by health.test.ts):
 *
 *   | Current health        | Outcome | Next health | Next counter | Audit |
 *   | --------------------- | ------- | ----------- | ------------ | ----- |
 *   | HEALTHY (counter < 4) | failure | HEALTHY     | counter+1    | no    |
 *   | HEALTHY (counter ==4) | failure | DEGRADED    | 5            | yes   |
 *   | DEGRADED (counter <9) | failure | DEGRADED    | counter+1    | no    |
 *   | DEGRADED (counter==9) | failure | DISABLED    | 10           | yes   |
 *   | DISABLED (any)        | failure | DISABLED    | counter+1    | no    |
 *   | HEALTHY               | success | HEALTHY     | 0            | no    |
 *   | DEGRADED              | success | HEALTHY     | 0            | yes   |
 *   | DISABLED              | success | HEALTHY     | 0            | yes   |
 *
 * Audit reason for ALL transitions emitted by this helper is "auto_threshold".
 * The "manual_reenable" reason is reserved for the reEnableWebhookConfig
 * action (passes actorUserId, not SYSTEM_ACTOR_ID).
 */

const DEGRADED_THRESHOLD = 5;
const DISABLED_THRESHOLD = 10;

export type HealthTransitionOutcome = "success" | "failure";

export interface HealthTransitionResult {
  from: EndpointHealth;
  to: EndpointHealth;
  counter: number;
}

export async function transition(
  webhookConfigId: string,
  outcome: HealthTransitionOutcome,
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<HealthTransitionResult> {
  const now = new Date();

  const config = await prisma.webhookConfig.findUnique({
    where: { id: webhookConfigId },
    select: {
      projectId: true,
      endpointHealth: true,
      consecutiveFailureCount: true,
    },
  });

  if (!config) {
    throw new Error(
      `[health.transition] WebhookConfig not found: ${webhookConfigId}`
    );
  }

  const from: EndpointHealth = config.endpointHealth;
  const currentCounter = config.consecutiveFailureCount;

  let nextHealth: EndpointHealth;
  let nextCounter: number;
  const updateData: Prisma.WebhookConfigUncheckedUpdateInput = {};

  if (outcome === "success") {
    nextHealth = "HEALTHY";
    nextCounter = 0;
    updateData.endpointHealth = "HEALTHY";
    updateData.consecutiveFailureCount = 0;
    updateData.lastSuccessAt = now;
  } else {
    nextCounter = currentCounter + 1;
    if (from === "DISABLED") {
      // Counter still increments for observability ("still failing while
      // disabled"); state stays DISABLED — no audit (already there).
      nextHealth = "DISABLED";
    } else if (from === "HEALTHY" && nextCounter >= DEGRADED_THRESHOLD) {
      nextHealth = "DEGRADED";
    } else if (from === "DEGRADED" && nextCounter >= DISABLED_THRESHOLD) {
      nextHealth = "DISABLED";
    } else {
      nextHealth = from;
    }
    updateData.endpointHealth = nextHealth;
    updateData.consecutiveFailureCount = nextCounter;
    updateData.lastFailureAt = now;
  }

  await prisma.webhookConfig.update({
    where: { id: webhookConfigId },
    data: updateData,
  });

  if (from !== nextHealth) {
    await captureAuditEvent({
      action: "WEBHOOK_HEALTH_CHANGED",
      entityType: "WebhookConfig",
      entityId: webhookConfigId,
      projectId: config.projectId,
      userId: SYSTEM_ACTOR_ID,
      metadata: {
        webhookConfigId,
        from,
        to: nextHealth,
        reason: "auto_threshold",
        consecutiveFailureCount: nextCounter,
      },
    });
  }

  return { from, to: nextHealth, counter: nextCounter };
}
