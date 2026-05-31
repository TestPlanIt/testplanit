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
