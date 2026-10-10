-- More system alerts (#651 follow-up): AI error rate and provider rate
-- limiting, repository cache failures, integrations needing re-authorization,
-- queue failures and backlog, audit backlog, account lockouts, and a silent
-- automated-results feed.

ALTER TYPE "AlertMetric" ADD VALUE 'LLM_ERROR_RATE';
ALTER TYPE "AlertMetric" ADD VALUE 'LLM_RATE_LIMITED';
ALTER TYPE "AlertMetric" ADD VALUE 'CODE_REPOSITORY_CACHE_FAILING';
ALTER TYPE "AlertMetric" ADD VALUE 'INTEGRATION_REAUTH_NEEDED';
ALTER TYPE "AlertMetric" ADD VALUE 'QUEUE_FAILED_JOBS';
ALTER TYPE "AlertMetric" ADD VALUE 'QUEUE_BACKLOG';
ALTER TYPE "AlertMetric" ADD VALUE 'AUDIT_BACKLOG';
ALTER TYPE "AlertMetric" ADD VALUE 'ACCOUNT_LOCKOUTS';
ALTER TYPE "AlertMetric" ADD VALUE 'NO_AUTOMATED_RESULTS';

ALTER TYPE "AlertScopeType" ADD VALUE 'CODE_REPOSITORY';
ALTER TYPE "AlertScopeType" ADD VALUE 'INTEGRATION';
ALTER TYPE "AlertScopeType" ADD VALUE 'QUEUE';

ALTER TYPE "AlertSubjectType" ADD VALUE 'CODE_REPOSITORY';
ALTER TYPE "AlertSubjectType" ADD VALUE 'INTEGRATION';
ALTER TYPE "AlertSubjectType" ADD VALUE 'QUEUE';
ALTER TYPE "AlertSubjectType" ADD VALUE 'SYSTEM';
