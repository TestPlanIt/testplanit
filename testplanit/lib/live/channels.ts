/**
 * Live-update SSE channels — the ONLY module permitted to construct
 * channel-key strings for non-notification live streams (test runs first;
 * sessions/etc. can extend this without touching consumers).
 *
 * Pattern mirrors `lib/notifications/channels.ts`. Channel keys are
 * tenant-scoped so multi-tenant deployments isolate cleanly, and the
 * key format is the only contract between publishers (server-side
 * event emitters) and subscribers (the SSE route).
 *
 * Payload shape on the wire is `{ id, event, ...minimalFields }` JSON.
 * Consumers treat the message as a wake-up signal and refetch from REST
 * — the pub/sub layer is untrusted plumbing, the data fetch is the
 * security boundary (same model as the notifications stream).
 */

export function testRunChannel(tenantId: string, testRunId: number): string {
  if (!tenantId) {
    throw new Error("live/channels.testRunChannel: tenantId is required");
  }
  if (!Number.isInteger(testRunId) || testRunId <= 0) {
    throw new Error(
      "live/channels.testRunChannel: testRunId must be a positive integer"
    );
  }
  return `live:tenant:${tenantId}:testrun:${testRunId}`;
}

/**
 * Project-level wake-up channel. The runs list page subscribes here so
 * one EventSource covers every in-progress run in the project rather
 * than opening one connection per run — the HTTP/1.1 6-connection-per-
 * origin cap was making projects with many active runs unusable.
 * The publisher fans out each wake-up to both this channel and the
 * per-run channel, so detail-page consumers continue to work unchanged.
 */
export function testRunProjectChannel(
  tenantId: string,
  projectId: number
): string {
  if (!tenantId) {
    throw new Error(
      "live/channels.testRunProjectChannel: tenantId is required"
    );
  }
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error(
      "live/channels.testRunProjectChannel: projectId must be a positive integer"
    );
  }
  return `live:tenant:${tenantId}:project:${projectId}:testruns`;
}

/**
 * Per-milestone wake-up channel (D-13/D-14). Mirrors `testRunChannel`
 * exactly — the milestone detail page subscribes here.
 */
export function milestoneChannel(tenantId: string, milestoneId: number): string {
  if (!tenantId) {
    throw new Error("live/channels.milestoneChannel: tenantId is required");
  }
  if (!Number.isInteger(milestoneId) || milestoneId <= 0) {
    throw new Error(
      "live/channels.milestoneChannel: milestoneId must be a positive integer"
    );
  }
  return `live:tenant:${tenantId}:milestone:${milestoneId}`;
}

/**
 * Project-level milestone wake-up channel. Mirrors `testRunProjectChannel`
 * — list pages and the import picker subscribe here so a project holds
 * ONE EventSource regardless of how many milestones it has, avoiding the
 * same HTTP/1.1 6-connection-per-origin cap that motivated the Test Runs
 * per-project channel (D-14/D-15).
 */
export function milestoneProjectChannel(
  tenantId: string,
  projectId: number
): string {
  if (!tenantId) {
    throw new Error(
      "live/channels.milestoneProjectChannel: tenantId is required"
    );
  }
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error(
      "live/channels.milestoneProjectChannel: projectId must be a positive integer"
    );
  }
  return `live:tenant:${tenantId}:project:${projectId}:milestones`;
}
