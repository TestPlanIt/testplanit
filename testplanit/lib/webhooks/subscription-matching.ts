/**
 * D-33 / OUT-19 — outbound subscription filter.
 *
 * Both the outbox poller (workers/webhookOutboxWorker.ts) and the dispatch
 * service (lib/webhooks/dispatch.ts) use this helper to decide whether
 * a given (eventName, WebhookConfig.subscribedEvents) pair should produce
 * a delivery. Empty array = subscribe-all (back-compat with Phase 1's
 * implicit "all events" — though Phase 1 had no events to subscribe to);
 * any non-empty array filters by exact string match.
 *
 * NO wildcards in Phase 2 (D-33). Defer until user demand emerges.
 *
 * The poller does most of the filtering at SQL level via the Postgres
 * `text[]` `has` operator — see RESEARCH §Pattern 4. This helper is the
 * in-memory fallback / re-check at dispatch time + the unit-tested
 * decision rule for cases where the dispatch service loads a config and
 * needs to re-validate before HTTPing.
 */
export function matchesSubscription(
  eventName: string,
  subscribedEvents: readonly string[] | null | undefined
): boolean {
  if (!subscribedEvents || subscribedEvents.length === 0) return true;
  return subscribedEvents.includes(eventName);
}
