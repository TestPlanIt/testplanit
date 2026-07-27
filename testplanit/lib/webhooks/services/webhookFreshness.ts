import valkeyConnection from "~/lib/valkey";

/**
 * Shared freshness/coalescing policy for webhook-triggered syncs.
 *
 * Both inbound apply paths — `applyInboundIssueUpdate` and
 * `applyInboundMilestoneEvent` — dispatch a post-commit sync that pulls full
 * upstream state. Each previously carried its own copy of the window constant
 * with a comment saying the two must stay in lockstep; they now share this
 * module so that is structural rather than aspirational.
 */

/**
 * Coalescing window applied once a subject is genuinely storming. Also the
 * lifetime of the burst counter below.
 */
export const WEBHOOK_SYNC_FRESHNESS_SECONDS = 15;

/**
 * How many webhook-driven syncs of the SAME subject refetch before coalescing
 * begins, per rolling window.
 *
 * A bare time window is too blunt to be storm protection: it suppresses the
 * SECOND event, which is the normal shape of ordinary tracker activity rather
 * than a storm. Releasing a Jira version emits `version_updated` and
 * `version_released` in the same second; editing an issue commonly fires
 * several events at once. Worse, the underlying gate gets its age from the
 * subject's `lastSyncedAt`, so ANY unrelated sync landing in the preceding
 * window silently eats the next real event.
 *
 * Observed in production: a passive sync at 17:48:13 opened a window, a
 * release fired 7.5s later, both of its events no-opped, and the milestone
 * sat at `externalState: "active"` while Jira had the version released — with
 * the deliveries all logged 200/no-error, because only the sync underneath
 * was skipped.
 *
 * So let a small burst through and reserve coalescing for sustained volume.
 */
export const WEBHOOK_BURST_ALLOWANCE = 5;

function burstCounterKey(subjectKey: string): string {
  return `sync-burst:${subjectKey}`;
}

/**
 * Freshness window to pass to the sync for this event. Zero means "always
 * refetch"; `WEBHOOK_SYNC_FRESHNESS_SECONDS` re-enables coalescing.
 *
 * `subjectKey` identifies the thing being synced and must be stable and
 * unique per row — e.g. `milestone:{integrationId}:{projectId}:{externalId}`
 * or `issue:{integrationId}:{projectId}:{externalKey}`. Counting per subject
 * (not per webhook config or per project) means a storm against one artifact
 * cannot suppress a first-time event for a quiet neighbour.
 *
 * Fails open — without Valkey, or on any Valkey error, every event refetches.
 * This mirrors the sync locks' fail-open stance: freshness is a cost
 * optimization, not correctness, so a cache outage should cost extra upstream
 * calls rather than silently drop state changes. A real storm remains bounded
 * by the per-subject sync lock, which serializes concurrent refreshes, and by
 * payload-digest dedup, which drops repeats of an identical event before any
 * of this is reached.
 */
export async function webhookFreshnessWindow(
  subjectKey: string
): Promise<number> {
  if (!valkeyConnection) return 0;
  const key = burstCounterKey(subjectKey);
  try {
    const count = await valkeyConnection.incr(key);
    // Start the window on the first event of a burst; later INCRs ride the
    // same TTL, so the allowance is per-window rather than per-event.
    if (count === 1) {
      await valkeyConnection.expire(key, WEBHOOK_SYNC_FRESHNESS_SECONDS);
    }
    return count <= WEBHOOK_BURST_ALLOWANCE
      ? 0
      : WEBHOOK_SYNC_FRESHNESS_SECONDS;
  } catch {
    return 0;
  }
}
