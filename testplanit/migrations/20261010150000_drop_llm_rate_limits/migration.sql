-- The in-app AI rate limiter was never enforced (its check had no callers),
-- so the per-user counters and the per-minute/per-day request settings go.
-- Provider-side throttling is surfaced by the "AI provider rate limiting"
-- alert instead.

DROP TABLE IF EXISTS "LlmRateLimit";

ALTER TABLE "LlmProviderConfig" DROP COLUMN "maxRequestsPerMinute";
ALTER TABLE "LlmProviderConfig" DROP COLUMN "maxRequestsPerDay";
