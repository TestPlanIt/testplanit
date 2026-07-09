import type { AdapterType } from "~/zenstack/models";

import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { baseDb } from "~/lib/db";
import { integrationManager } from "~/lib/integrations/IntegrationManager";
import { milestoneSyncService } from "~/lib/integrations/services/MilestoneSyncService";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getAdapter } from "~/lib/webhooks/adapters";
import type { MilestoneEventRef } from "~/lib/webhooks/adapters/types";

import type {
  ApplyInboundMilestoneEventInput,
  ApplyInboundMilestoneEventResult,
} from "./types";

/**
 * Webhook-triggered freshness window — same 15s coalescing window as
 * `applyInboundIssueUpdate.ts` (D-01: "one mental model" for issue and
 * milestone webhook-triggered refreshes). Reused verbatim, not redefined,
 * since both constants must stay in lockstep if the value ever changes.
 */
const WEBHOOK_SYNC_FRESHNESS_SECONDS = 15;

const REASON_MAX_LEN = 500;

function truncate(s: string): string {
  return s.length > REASON_MAX_LEN ? s.slice(0, REASON_MAX_LEN) : s;
}

/**
 * Refresh-vs-convert event classification, per the verified Jira event
 * catalog (RESEARCH.md):
 *   refresh: created(auto-track only)/updated/moved/released/unreleased/started/closed
 *   convert: version_deleted (mergedTo present => merge, absent => delete), sprint_deleted
 */
function classifyMilestoneEvent(
  eventType: string,
  ref: MilestoneEventRef
): "refresh" | "convert" {
  if (ref.kind === "RELEASE") {
    if (eventType === "jira:version_deleted" || ref.merge) return "convert";
    return "refresh";
  }
  // ITERATION (sprint)
  if (eventType === "sprint_deleted") return "convert";
  return "refresh";
}

function isCreatedEvent(eventType: string): boolean {
  return eventType === "jira:version_created" || eventType === "sprint_created";
}

/**
 * Resolve the event's OWN project — NEVER the receiving WebhookConfig's
 * project (Pitfall 6 / T-19-04-01). Version events carry `project.id`
 * directly; sprint events carry only `originBoardId`, resolved via
 * `JiraAdapter.resolveBoardProject` (cached).
 *
 * Returns `null` when unmatched — the D-03 ack-and-drop path. Never throws;
 * a resolution failure (missing mapping, adapter error) is indistinguishable
 * from "this project isn't tracked by TestPlanIt" from the caller's
 * perspective, and both are legitimate non-error states for a site-wide
 * admin webhook.
 */
async function resolveMilestoneEventProject(
  ref: MilestoneEventRef
): Promise<{ projectId: number; integrationId: number } | null> {
  if (ref.kind === "RELEASE") {
    const integrationProject = await baseDb.integrationProject.findFirst({
      where: {
        externalProjectId: ref.externalProjectId,
        isActive: true,
        projectIntegration: {
          isActive: true,
          integration: { provider: "JIRA", isDeleted: false },
        },
      },
      select: {
        projectIntegration: {
          select: { projectId: true, integrationId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    if (!integrationProject) return null;
    return {
      projectId: integrationProject.projectIntegration.projectId,
      integrationId: integrationProject.projectIntegration.integrationId,
    };
  }

  // ITERATION (sprint): resolve originBoardId -> project via the Jira
  // adapter's cached single-board lookup. A sprint's board could in theory
  // belong to any integration configured in this deployment — probe each
  // active Jira integration's mapped IntegrationProjects for a matching
  // externalProjectId once the board lookup returns one, rather than trying
  // every integration's adapter (which would mean an upstream call per
  // integration per event). Instead: since `resolveBoardProject` is called
  // per-integration, and the receiver only knows the RECEIVING
  // webhookConfig's provider (JIRA) — not which specific integration owns
  // the board — probe active JIRA integrations that have at least one
  // IntegrationProject mapping, resolving the board against each until one
  // yields a match. In the common single-Jira-integration deployment this
  // is exactly one call.
  const candidateIntegrations = await baseDb.integrationProject.findMany({
    where: {
      isActive: true,
      projectIntegration: {
        isActive: true,
        integration: { provider: "JIRA", isDeleted: false },
      },
    },
    select: {
      externalProjectId: true,
      projectIntegration: {
        select: { projectId: true, integrationId: true },
      },
    },
    distinct: ["projectIntegrationId"],
  });

  const seenIntegrationIds = new Set<number>();
  for (const candidate of candidateIntegrations) {
    const integrationId = candidate.projectIntegration.integrationId;
    if (seenIntegrationIds.has(integrationId)) continue;
    seenIntegrationIds.add(integrationId);

    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      baseDb
    );
    if (!adapter?.resolveBoardProject) continue;

    const boardProject = await adapter.resolveBoardProject(ref.originBoardId);
    if (!boardProject) continue;

    const match = candidateIntegrations.find(
      (c) =>
        c.projectIntegration.integrationId === integrationId &&
        c.externalProjectId === boardProject.projectId
    );
    if (match) {
      return {
        projectId: match.projectIntegration.projectId,
        integrationId,
      };
    }
  }

  return null;
}

/**
 * Domain entry point for jira:version_* / sprint_* inbound webhook events —
 * sibling to `applyInboundIssueUpdate.ts`, sharing the exact same delivery
 * LOG + dedup + shared-tail + audit transaction shape, but dispatching to
 * `MilestoneSyncService.performMilestoneRefresh` / `.convertMilestoneToLocal`
 * instead of Issue field updates.
 *
 * Critical divergence from the issue-update sibling: this service resolves
 * the event's OWN project from the payload (Pitfall 6), NEVER the receiving
 * WebhookConfig's projectId — a site-wide admin webhook delivers version/
 * sprint events for Jira projects that have nothing to do with the
 * receiving webhookConfig.projectId, since these event types support no
 * JQL/project filtering at the Jira admin level.
 *
 * Flow:
 *   1. Resolve adapter once via getAdapter(input.adapterType) BEFORE the tx.
 *   2. Extract the milestone ref via adapter.extractMilestoneEventRef.
 *   3. ALWAYS INSERT a WebhookDelivery row.
 *   4. ref === null -> no-ref skip: finalize delivery error='no-ref', bump
 *      lastReceivedAt, return 'no-ref'. Dedup never touched.
 *   5. SELECT WebhookEventDedup (pre-INSERT, same idiom as
 *      applyInboundIssueUpdate — never wrap create in try/catch inside tx).
 *   6. Duplicate -> finalize delivery error='duplicate', return 'duplicate'.
 *   7. Otherwise INSERT dedup + finalize delivery + return the outcome; the
 *      actual sync/convert dispatch runs AFTER commit (mirrors the issue
 *      sibling's post-commit `triggerSystemSyncForInboundEvent`).
 *
 * Project resolution + dispatch happen POST-commit (not inside the tx) —
 * `performMilestoneRefresh`/`convertMilestoneToLocal` do their own DB work
 * (including their own transactions) and must not be nested inside this
 * service's delivery-log transaction. A resolution/dispatch failure here
 * does NOT roll back the dedup row, mirroring the issue sibling's posture:
 * the upstream is the source of truth, and the next webhook event (or a
 * manual sync) reconciles.
 */
export async function applyInboundMilestoneEvent(
  input: ApplyInboundMilestoneEventInput
): Promise<ApplyInboundMilestoneEventResult> {
  const {
    webhookConfigId,
    adapterType,
    eventType,
    payload,
    payloadDigest,
    receivedAt,
    latencyMs,
    statusCode,
  } = input;

  const adapter = getAdapter(adapterType);
  const ref = adapter.extractMilestoneEventRef
    ? adapter.extractMilestoneEventRef(payload, eventType)
    : null;

  type TxOutcome =
    | { outcome: "applied"; deliveryId: string }
    | { outcome: "no-ref"; deliveryId: string }
    | { outcome: "duplicate"; deliveryId: string };

  let txResult: TxOutcome;

  try {
    txResult = await baseDb.$transaction(async (tx): Promise<TxOutcome> => {
      // Step 1: ALWAYS insert a delivery log row first.
      const delivery = await tx.webhookDelivery.create({
        data: {
          webhookConfigId,
          direction: "INBOUND",
          adapterType,
          eventType,
          statusCode: null,
          latencyMs: null,
          payloadDigest,
          error: null,
          attempt: 1,
          receivedAt,
        },
      });

      // Step 2: no-ref skip — adapter could not extract a milestone ref
      // (e.g. a version/sprint eventType with a malformed/incomplete
      // payload). Delivery row written, no dedup, no dispatch.
      if (ref === null) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "no-ref" },
        });
        await tx.webhookConfig.update({
          where: { id: webhookConfigId },
          data: { lastReceivedAt: receivedAt },
        });
        return { outcome: "no-ref", deliveryId: delivery.id };
      }

      // Step 3: Pre-INSERT SELECT for prior application of this payload —
      // same TOCTOU-safe idiom as applyInboundIssueUpdate (never wrap
      // tx.webhookEventDedup.create in try/catch inside the tx; Postgres
      // aborts the whole tx on P2002).
      const priorDedup = await tx.webhookEventDedup.findFirst({
        where: { webhookConfigId, payloadDigest },
        select: { id: true },
      });

      let outcome: TxOutcome;
      let deliveryError: string | null = null;

      if (priorDedup) {
        deliveryError = "duplicate";
        outcome = { outcome: "duplicate", deliveryId: delivery.id };
      } else {
        await tx.webhookEventDedup.create({
          data: {
            webhookConfigId,
            payloadDigest,
            processedAt: receivedAt,
          },
        });
        deliveryError = null;
        outcome = { outcome: "applied", deliveryId: delivery.id };
      }

      // Shared tail: finalize delivery row + bump lastReceivedAt for ALL
      // outcomes, including duplicates.
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { statusCode, latencyMs, error: deliveryError },
      });
      await tx.webhookConfig.update({
        where: { id: webhookConfigId },
        data: { lastReceivedAt: receivedAt },
      });
      return outcome;
    });
  } catch (err) {
    return {
      outcome: "error",
      reason: truncate(err instanceof Error ? err.message : String(err)),
    };
  }

  if (txResult.outcome !== "applied" || ref === null) {
    await captureAuditEvent({
      action: "WEBHOOK_RECEIVED",
      entityType: "WebhookDelivery",
      entityId: txResult.deliveryId,
      userId: SYSTEM_ACTOR_ID,
      metadata: {
        adapterType,
        eventType,
        payloadDigest,
        webhookConfigId,
        outcome: txResult.outcome,
      },
    });
    return {
      outcome: txResult.outcome === "no-ref" ? "no-ref" : "duplicate",
      deliveryId: txResult.deliveryId,
      reason: txResult.outcome,
    };
  }

  // Post-commit: resolve the event's OWN project (Pitfall 6) and dispatch
  // refresh vs convert. Wrapped so a throw here never surfaces as a 500 —
  // the dedup row is already committed, and the next webhook event (or a
  // manual sync) reconciles.
  let finalOutcome: "refreshed" | "converted" | "unmatched" | "error" =
    "unmatched";
  let milestoneId: number | undefined;
  try {
    const resolved = await resolveMilestoneEventProject(ref);
    if (!resolved) {
      // D-03: unmatched project/board — silent ack, debug log, no write.
      console.debug(
        `[applyInboundMilestoneEvent] unmatched project/board for ${ref.kind} externalId=${ref.externalId} — no active integration mapping`
      );
      finalOutcome = "unmatched";
    } else {
      const classification = classifyMilestoneEvent(eventType, ref);

      if (classification === "convert") {
        const existing = await baseDb.milestones.findFirst({
          where: {
            externalId: ref.externalId,
            integrationId: resolved.integrationId,
          },
          select: { id: true },
        });
        if (!existing) {
          console.debug(
            `[applyInboundMilestoneEvent] convert event for untracked milestone externalId=${ref.externalId} integration=${resolved.integrationId} — no local row, dropping`
          );
          finalOutcome = "unmatched";
        } else {
          const reason =
            ref.kind === "RELEASE" && ref.merge ? "merged" : "deleted";
          const mergedToExternalId =
            ref.kind === "RELEASE" ? ref.mergedToExternalId : undefined;
          await milestoneSyncService.convertMilestoneToLocal(
            baseDb,
            existing.id,
            reason,
            mergedToExternalId
          );
          milestoneId = existing.id;
          finalOutcome = "converted";
        }
      } else {
        // Refresh path. version_created/sprint_created only refresh when
        // auto-track is ON for the resolved project (D-02) — an unlinked
        // milestone with auto-track OFF is a clean no-op ack.
        if (isCreatedEvent(eventType)) {
          const projectIntegration = await baseDb.projectIntegration.findUnique(
            {
              where: {
                projectId_integrationId: {
                  projectId: resolved.projectId,
                  integrationId: resolved.integrationId,
                },
              },
              select: { config: true },
            }
          );
          const autoTrack =
            (projectIntegration?.config as any)?.milestoneSync?.autoTrack ===
            true;
          if (!autoTrack) {
            console.debug(
              `[applyInboundMilestoneEvent] ${eventType} for project ${resolved.projectId} — auto-track is OFF, no-op (D-02)`
            );
            finalOutcome = "unmatched";
            // Skip refresh entirely — fall through to the finally-style
            // return below.
            await captureAuditEvent({
              action: "WEBHOOK_RECEIVED",
              entityType: "WebhookDelivery",
              entityId: txResult.deliveryId,
              projectId: resolved.projectId,
              userId: SYSTEM_ACTOR_ID,
              metadata: {
                adapterType,
                eventType,
                payloadDigest,
                webhookConfigId,
                outcome: "unmatched",
                reason: "auto-track-off",
              },
            });
            return {
              outcome: "unmatched",
              deliveryId: txResult.deliveryId,
              reason: "auto-track-off",
            };
          }
        }

        const refreshResult =
          await milestoneSyncService.performMilestoneRefresh(
            SYSTEM_ACTOR_ID,
            resolved.integrationId,
            ref.externalId,
            {
              minFreshnessSeconds: WEBHOOK_SYNC_FRESHNESS_SECONDS,
              projectId: resolved.projectId,
            }
          );
        if (!refreshResult.success && !refreshResult.notFound) {
          console.error(
            `[applyInboundMilestoneEvent] performMilestoneRefresh failed for externalId=${ref.externalId} integration=${resolved.integrationId}: ${refreshResult.error ?? "unknown"}`
          );
        }
        finalOutcome = "refreshed";
      }
    }
  } catch (err) {
    console.error(
      `[applyInboundMilestoneEvent] post-commit dispatch threw for ${ref.kind} externalId=${ref.externalId}:`,
      err
    );
    finalOutcome = "error";
  }

  await captureAuditEvent({
    action: "WEBHOOK_RECEIVED",
    entityType: "WebhookDelivery",
    entityId: txResult.deliveryId,
    userId: SYSTEM_ACTOR_ID,
    metadata: {
      adapterType,
      eventType,
      payloadDigest,
      webhookConfigId,
      outcome: finalOutcome,
      ...(milestoneId !== undefined ? { milestoneId } : {}),
    },
  });

  // A post-commit dispatch failure still returns a 200-mappable outcome —
  // the dedup row is already committed and the delivery log reflects the
  // attempt; only a pre-commit tx failure maps to "error"/500 (handled
  // above via the catch around baseDb.$transaction).
  return {
    outcome: finalOutcome === "error" ? "unmatched" : finalOutcome,
    deliveryId: txResult.deliveryId,
    ...(milestoneId !== undefined ? { milestoneId } : {}),
  };
}

// Re-exported for callers that only need the AdapterType import shape.
export type { AdapterType };
