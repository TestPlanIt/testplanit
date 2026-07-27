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

/**
 * Events that carry a LIFECYCLE TRANSITION rather than a field edit. These
 * bypass the coalescing window above and always refetch.
 *
 * The window exists to absorb edit storms, and for `updated`/`moved` that is
 * exactly right. But a transition is the one thing the window must not
 * swallow, because the whole point of the event is that the artifact's state
 * changed — and the gate does not check whether the cached row already
 * reflects it, it just returns `cached: true` on age alone.
 *
 * Observed in production: a passive sync at 17:48:13 opened the window, then
 * a release fired `jira:version_updated` and `jira:version_released` 7.5s
 * later. Both landed inside the 15s window, both no-opped, and the milestone
 * sat at `externalState: "active"` / `isCompleted: false` with an unmoved
 * `lastSyncedAt` while Jira had the version released. Delivery rows logged
 * 200 with no error the whole time, because the event WAS accepted and
 * dispatched — only the refresh underneath was skipped.
 *
 * Note that Jira emits `version_updated` alongside `version_released` within
 * the same second, so even without a preceding sync the first event would
 * open a window that swallows the second.
 */
const STATE_TRANSITION_EVENTS = new Set([
  "jira:version_released",
  "jira:version_unreleased",
  "sprint_started",
  "sprint_closed",
]);

/**
 * Coalescing window for this event: none for a lifecycle transition, the
 * shared 15s otherwise.
 */
function freshnessWindowFor(eventType: string): number {
  return STATE_TRANSITION_EVENTS.has(eventType)
    ? 0
    : WEBHOOK_SYNC_FRESHNESS_SECONDS;
}

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
 * Every dispatch target an inbound milestone event fans out to. External
 * identity is per-project ([externalId, integrationId, projectId]): the
 * same tracker artifact may be tracked independently by several TestPlanIt
 * projects, so one upstream event can affect many rows.
 */
interface ResolvedMilestoneTargets {
  /** Every Milestones row tracking this artifact, across all projects —
   *  refresh/convert events apply to each of these rows. */
  tracked: Array<{
    milestoneId: number;
    projectId: number;
    integrationId: number;
  }>;
  /** Every active mapping matching the artifact's external project/board —
   *  the candidate projects a created event may auto-track into. */
  mappedProjects: Array<{ projectId: number; integrationId: number }>;
  /** The tracker-side project the artifact belongs to (version events carry
   *  it directly; sprint events resolve it via the origin board). Created
   *  events check it against each target's
   *  `autoTrackExcludedExternalProjectIds` opt-out. */
  externalProjectId: string;
}

/**
 * Resolve the event's OWN project(s) — NEVER the receiving WebhookConfig's
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
async function resolveMilestoneEventTargets(
  ref: MilestoneEventRef
): Promise<ResolvedMilestoneTargets | null> {
  // Already-tracked artifacts resolve to their OWN Milestones rows — one per
  // tracking project — so refresh/convert dispatch reaches every project
  // independently (WR-07: picking a mapping's project for a milestone that
  // lives in another project makes its refresh/convert silently miss).
  // Mapping-based resolution feeds the created-event auto-track path.
  const findTrackedRows = async (
    integrationIds: number[]
  ): Promise<ResolvedMilestoneTargets["tracked"]> => {
    if (integrationIds.length === 0) return [];
    const rows = await baseDb.milestones.findMany({
      where: {
        externalId: ref.externalId,
        integrationId: { in: integrationIds },
      },
      select: { id: true, projectId: true, integrationId: true },
      orderBy: { id: "asc" },
    });
    return rows
      .filter(
        (row: { integrationId: number | null }) => row.integrationId != null
      )
      .map(
        (row: {
          id: number;
          projectId: number;
          integrationId: number | null;
        }) => ({
          milestoneId: row.id,
          projectId: row.projectId,
          integrationId: row.integrationId as number,
        })
      );
  };

  const dedupProjects = (
    entries: Array<{ projectId: number; integrationId: number }>
  ): Array<{ projectId: number; integrationId: number }> => {
    const seen = new Set<string>();
    const result: Array<{ projectId: number; integrationId: number }> = [];
    for (const entry of entries) {
      const key = `${entry.projectId}:${entry.integrationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  };

  if (ref.kind === "RELEASE") {
    // ALL active mappings for this external project — NEVER findFirst/
    // distinct: every mapping row must be matchable (CR-02 class).
    const mappings = await baseDb.integrationProject.findMany({
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
    if (mappings.length === 0) return null;

    const integrationIds = [
      ...new Set(
        mappings.map(
          (m: {
            projectIntegration: { projectId: number; integrationId: number };
          }) => m.projectIntegration.integrationId
        )
      ),
    ] as number[];
    const tracked = await findTrackedRows(integrationIds);
    const mappedProjects = dedupProjects(
      mappings.map(
        (m: {
          projectIntegration: { projectId: number; integrationId: number };
        }) => m.projectIntegration
      )
    );
    return {
      tracked,
      mappedProjects,
      externalProjectId: ref.externalProjectId,
    };
  }

  // ITERATION (sprint): resolve originBoardId -> project via the Jira
  // adapter's cached single-board lookup. A sprint's board could in theory
  // belong to any integration configured in this deployment — the receiver
  // only knows the RECEIVING webhookConfig's provider (JIRA), not which
  // specific integration owns the board — so probe active JIRA integrations
  // that have at least one IntegrationProject mapping, resolving the board
  // against each until one yields a match. In the common
  // single-Jira-integration deployment this is exactly one call.
  //
  // The FULL mapping list is kept for the match — no `distinct`, which
  // ZenStack v3 executes as Postgres DISTINCT ON and therefore collapses a
  // ProjectIntegration mapped to multiple Jira projects down to ONE
  // arbitrary externalProjectId row, making boards owned by any
  // non-retained mapping permanently unmatchable (CR-02). Integrations are
  // deduped only for the board-lookup loop.
  const mappings = await baseDb.integrationProject.findMany({
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
  });

  const integrationIds = [
    ...new Set(
      mappings.map(
        (m: {
          projectIntegration: { projectId: number; integrationId: number };
        }) => m.projectIntegration.integrationId
      )
    ),
  ] as number[];

  for (const integrationId of integrationIds) {
    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      baseDb
    );
    if (!adapter?.resolveBoardProject) continue;

    const boardProject = await adapter.resolveBoardProject(ref.originBoardId);
    if (!boardProject) continue;

    // Board confirmed to exist on this integration's Jira — collect every
    // tracking row (WR-07 parity for sprints, per-project fan-out) plus
    // every mapping for the board's own project (created-event candidates).
    const tracked = await findTrackedRows([integrationId]);
    const mappedProjects = dedupProjects(
      mappings
        .filter(
          (m: {
            externalProjectId: string;
            projectIntegration: { projectId: number; integrationId: number };
          }) =>
            m.projectIntegration.integrationId === integrationId &&
            m.externalProjectId === boardProject.projectId
        )
        .map(
          (m: {
            projectIntegration: { projectId: number; integrationId: number };
          }) => m.projectIntegration
        )
    );
    if (tracked.length > 0 || mappedProjects.length > 0) {
      return {
        tracked,
        mappedProjects,
        externalProjectId: boardProject.projectId,
      };
    }
  }

  return null;
}

/**
 * Domain entry point for jira:version_* / sprint_* inbound webhook events —
 * sibling to `applyInboundIssueUpdate.ts`, sharing the exact same delivery
 * LOG + dedup + shared-tail + audit transaction shape, but dispatching to
 * `MilestoneSyncService.performMilestoneRefresh` / `.performMilestoneImport`
 * (created events, D-02) / `.convertMilestoneToLocal` instead of Issue field
 * updates.
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
  let finalOutcome:
    "refreshed" | "imported" | "converted" | "unmatched" | "error" =
    "unmatched";
  let milestoneId: number | undefined;
  try {
    const resolved = await resolveMilestoneEventTargets(ref);
    if (
      !resolved ||
      (resolved.tracked.length === 0 && resolved.mappedProjects.length === 0)
    ) {
      // D-03: unmatched project/board — silent ack, debug log, no write.
      console.debug(
        `[applyInboundMilestoneEvent] unmatched project/board for ${ref.kind} externalId=${ref.externalId} — no active integration mapping`
      );
      finalOutcome = "unmatched";
    } else {
      const classification = classifyMilestoneEvent(eventType, ref);

      if (classification === "convert") {
        if (resolved.tracked.length === 0) {
          console.debug(
            `[applyInboundMilestoneEvent] convert event for untracked milestone externalId=${ref.externalId} — no local row, dropping`
          );
          finalOutcome = "unmatched";
        } else {
          const reason =
            ref.kind === "RELEASE" && ref.merge ? "merged" : "deleted";
          const mergedToExternalId =
            ref.kind === "RELEASE" ? ref.mergedToExternalId : undefined;
          // One upstream artifact may be tracked by several projects
          // (per-project identity) — the upstream deletion/merge converts
          // EVERY tracking row, each in its own transaction.
          for (const row of resolved.tracked) {
            await milestoneSyncService.convertMilestoneToLocal(
              baseDb,
              row.milestoneId,
              reason,
              mergedToExternalId
            );
          }
          milestoneId = resolved.tracked[0].milestoneId;
          finalOutcome = "converted";
        }
      } else if (isCreatedEvent(eventType)) {
        // Created path (D-02): version_created/sprint_created only act on
        // mapped projects with auto-track ON — for every other mapped
        // project the new artifact is a clean no-op ack. With per-project
        // identity, EVERY mapped project with auto-track ON imports its
        // own independent row.
        let importedProjects = 0;
        let skipReason:
          | "auto-track-off"
          | "auto-track-admin-missing"
          | "auto-track-project-excluded"
          | null = null;
        for (const target of resolved.mappedProjects) {
          const projectIntegration = await baseDb.projectIntegration.findUnique(
            {
              where: {
                projectId_integrationId: {
                  projectId: target.projectId,
                  integrationId: target.integrationId,
                },
              },
              select: { config: true },
            }
          );
          const milestoneSyncConfig =
            (projectIntegration?.config as any)?.milestoneSync ?? {};
          if (milestoneSyncConfig.autoTrack !== true) {
            console.debug(
              `[applyInboundMilestoneEvent] ${eventType} for project ${target.projectId} — auto-track is OFF, no-op (D-02)`
            );
            skipReason = skipReason ?? "auto-track-off";
            continue;
          }

          // Per-mapping opt-out: the admin can exclude specific tracker
          // projects from new-milestone scanning — mirror the sync pass's
          // discovery filter so a webhook can't sneak in what the scheduled
          // pass would skip.
          const excludedExternalProjectIds: unknown =
            milestoneSyncConfig.autoTrackExcludedExternalProjectIds;
          if (
            Array.isArray(excludedExternalProjectIds) &&
            excludedExternalProjectIds
              .map(String)
              .includes(String(resolved.externalProjectId))
          ) {
            console.debug(
              `[applyInboundMilestoneEvent] ${eventType} for project ${target.projectId} — tracker project ${resolved.externalProjectId} is excluded from auto-track, no-op`
            );
            skipReason = skipReason ?? "auto-track-project-excluded";
            continue;
          }

          // A created event means no linked row exists for this project
          // yet, so `performMilestoneRefresh` would return `notFound`
          // without writing anything — the new artifact must be IMPORTED
          // instead. Attribution matches `performProjectMilestoneSync`'s
          // auto-track pass: the imported row is credited to
          // `autoTrackAdminId` (the admin who enabled sync), never a
          // system placeholder, and a missing admin id is a configuration
          // error, not an import-as-somebody-else.
          const autoTrackAdminId: string | undefined =
            milestoneSyncConfig.autoTrackAdminId;
          if (!autoTrackAdminId) {
            console.error(
              `[applyInboundMilestoneEvent] ${eventType} for project ${target.projectId} — auto-track is ON but milestoneSync.autoTrackAdminId is not configured; cannot import`
            );
            skipReason = skipReason ?? "auto-track-admin-missing";
            continue;
          }

          const importResult =
            await milestoneSyncService.performMilestoneImport(
              SYSTEM_ACTOR_ID,
              target.integrationId,
              target.projectId,
              { externalIds: [ref.externalId], kinds: [ref.kind] },
              autoTrackAdminId
            );
          if (!importResult.success) {
            console.error(
              `[applyInboundMilestoneEvent] performMilestoneImport failed for externalId=${ref.externalId} project=${target.projectId} integration=${target.integrationId}: ${importResult.errors.join("; ") || "unknown"}`
            );
          }
          importedProjects++;
        }

        if (importedProjects > 0) {
          finalOutcome = "imported";
        } else {
          // Every mapped project skipped — preserve the pre-fan-out
          // observability: ack as unmatched with the (first) skip reason.
          finalOutcome = "unmatched";
          await captureAuditEvent({
            action: "WEBHOOK_RECEIVED",
            entityType: "WebhookDelivery",
            entityId: txResult.deliveryId,
            projectId: resolved.mappedProjects[0]?.projectId,
            userId: SYSTEM_ACTOR_ID,
            metadata: {
              adapterType,
              eventType,
              payloadDigest,
              webhookConfigId,
              outcome: "unmatched",
              reason: skipReason ?? "auto-track-off",
            },
          });
          return {
            outcome: "unmatched",
            deliveryId: txResult.deliveryId,
            reason: skipReason ?? "auto-track-off",
          };
        }
      } else {
        if (resolved.tracked.length === 0) {
          // Update-class event for an artifact no project tracks — nothing
          // to refresh (only created events import, D-02). Clean ack.
          console.debug(
            `[applyInboundMilestoneEvent] ${eventType} for untracked milestone externalId=${ref.externalId} — no local row, dropping`
          );
          finalOutcome = "unmatched";
        } else {
          // Refresh EVERY tracking row — each project's row gates on its
          // own per-project freshness window and sync lock.
          for (const row of resolved.tracked) {
            const refreshResult =
              await milestoneSyncService.performMilestoneRefresh(
                SYSTEM_ACTOR_ID,
                row.integrationId,
                ref.externalId,
                {
                  minFreshnessSeconds: freshnessWindowFor(eventType),
                  projectId: row.projectId,
                }
              );
            if (!refreshResult.success && !refreshResult.notFound) {
              console.error(
                `[applyInboundMilestoneEvent] performMilestoneRefresh failed for externalId=${ref.externalId} project=${row.projectId} integration=${row.integrationId}: ${refreshResult.error ?? "unknown"}`
              );
            }
          }
          milestoneId = resolved.tracked[0].milestoneId;
          finalOutcome = "refreshed";
        }
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
