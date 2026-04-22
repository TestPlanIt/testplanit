---
title: Audit Log Reliability
description: How TestPlanIt's audit log queue retries, handles failures, and compares to other critical workers.
sidebar_position: 20
---

# Audit Log Reliability

TestPlanIt's audit log pipeline is designed so that administrative and
security-relevant actions are captured reliably without blocking the
primary operation. This page documents the queue's retry/backoff policy,
its failure behavior, and how ops engineers can verify events are
reaching the queue.

## Retry and backoff policy

The audit log queue (`audit-log-queue`) uses BullMQ's `defaultJobOptions`
with the following configuration:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `attempts` | `3` | A transient Valkey or database hiccup should auto-recover; three tries is the conventional BullMQ default for background jobs where per-job idempotency makes retries safe. |
| `backoff.type` | `exponential` | Spreads retry load when Valkey or the database is under pressure. |
| `backoff.delay` | `5000ms` | First retry at 5s, second at 10s, third at 20s. Keeps total retry window under a minute while giving transient infrastructure issues time to clear. |
| `removeOnComplete.age` | `1 year` (`3600 * 24 * 365`) | Long retention for successful jobs. Audit history is the forensic artifact; we accept the queue storage cost for operational visibility. |
| `removeOnComplete.count` | `100000` | Upper bound on completed-job storage. Prevents the queue from growing unbounded under sustained heavy audit load. |
| `removeOnFail.age` | `90 days` | Failed jobs kept for investigation. Operators can inspect the payload that couldn't be written. |

The configuration lives in `testplanit/lib/queues.ts` (lines 297-320 —
look for `_auditLogQueue = new Queue(...)`). In source, the config
block reads (verbatim):

```typescript
defaultJobOptions: {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  // Long retention for audit logs - keep completed jobs for 1 year
  removeOnComplete: {
    age: 3600 * 24 * 365, // 1 year
    count: 100000,
  },
  // Keep failed jobs for investigation
  removeOnFail: {
    age: 3600 * 24 * 90, // 90 days
  },
},
```

The worker that drains this queue is
`testplanit/workers/auditLogWorker.ts`. The worker re-throws any
database write error to trigger BullMQ's retry machinery — see the
`processor` function around lines 99-102.

## Failure behavior

Audit logging is **logged-and-swallowed** — it never blocks the primary
mutation. There are two failure paths:

1. **Enqueue failure (caller-side)**: If `captureAuditEvent` cannot add
   the job to Valkey (connection down, BullMQ rejects the payload, etc.),
   it logs a structured payload to `console.error` with the prefix
   `[AuditLog] Failed to queue audit event:` and continues. The prefix
   string is stable — log aggregators can filter on it.

   The structured payload contains: `action`, `entityType`, `entityId`,
   `userId`, `requestId`, `errorName`, and a sensitive-value-redacted
   `errorMessage`. Redaction is implemented by the
   `redactSensitiveInString` helper (co-located with `SENSITIVE_FIELDS`
   in `testplanit/lib/services/auditLog.ts`): it replaces any field
   listed in `SENSITIVE_FIELDS` (passwords, tokens, 2FA secrets, etc.)
   embedded in the error message with `[REDACTED]` before logging. This
   is defense-in-depth against upstream libraries that serialize job
   payloads into error strings.

   Stack traces are NOT included — `errorName` (e.g., `Error`,
   `QueueError`) plus the redacted message is the diagnostic surface.
   Operators needing stack traces can reproduce the failure locally.

2. **Worker failure (consumer-side)**: If the worker fails to write the
   audit row to the database (e.g., a transient Postgres outage), BullMQ
   automatically retries per the policy above. After all 3 attempts
   fail, the job is moved to the failed state and retained for 90 days
   for operator investigation.

In either case, the primary mutation that triggered the audit event has
already committed to the database — audit pipeline failures never
rollback or delay user-visible operations.

## Verifying an event reached the queue

Ops engineers can verify event delivery three ways:

1. **Real-time**: Watch worker logs. Successful processing emits
   `[AuditLogWorker] Successfully logged: <action> <entityType>:<entityId>`
   (see `auditLogWorker.ts` lines 96-98).

2. **Queue inspection**: Open the admin queue-management page (if
   `/admin/queues` is enabled in your deployment) and inspect the
   `audit-log-queue` job counts: `active`, `completed`, `failed`,
   `delayed`. Completed jobs are retained for 1 year — recent audit
   activity is queryable without hitting the database.

3. **Database**: Query the `AuditLog` table directly by
   `(entityType, entityId, timestamp DESC)` — the
   `[entityType, entityId]` compound index makes entity-scoped lookups
   fast.

If enqueue failures are observed in production logs (filter on the
prefix above), the payload's `requestId` can be cross-referenced
against request-level tracing to identify which user action was
affected.

## Architectural note

Callers `await` audit helpers (e.g., `await auditCreate(...)`). The
helpers guarantee non-throwing behavior: every internal failure mode is
caught and surfaced via the structured `console.error` described above.
This means awaiting an audit helper can never reject a user request — it
can only delay it by the time it takes to enqueue (typically low
milliseconds on a healthy system).

The repo's ESLint configuration includes
`@typescript-eslint/no-floating-promises` (in
`testplanit/eslint.config.mjs`) to flag unawaited audit helpers at lint
time. The rule is currently configured at `warn` level while an
incidental-findings sweep completes across non-audit files; it will be
tightened to `error` in a follow-up phase, at which point any new
floating audit promise will block CI. Audit-scope callsites
(`lib/services/auditLog.ts`, `lib/prisma.ts`,
`app/api/model/[...path]/route.ts`) are already clean today — the
regression gate is advisory-only for non-audit code, not for the audit
pipeline itself.

## Comparison with other critical workers

The audit queue's configuration is deliberately kept explicit and
reviewable, rather than shared across every critical queue. Other
critical workers in `testplanit/lib/queues.ts` use intentionally
different configs — for example:

| Queue | `attempts` | `backoff` | `delay` | `removeOnComplete.age` | Rationale |
|-------|-----------|-----------|---------|------------------------|-----------|
| `audit-log-queue` | 3 | exponential | 5000ms | 1 year | This queue — forensic retention, auto-retry on transient issues |
| `notification-queue` | 3 | exponential | 5000ms | 7 days | Analogous critical worker — notifications are transient so retention is shorter |
| `testmo-import-queue` | 1 | n/a | n/a | 30 days | Single attempt by design — imports should not silently retry; users trigger them manually |
| `email-queue` | 5 | exponential | 10000ms | 30 days | Delivery reliability matters more than latency; backoff spread over longer horizon |

`notificationQueue` (at `testplanit/lib/queues.ts` lines 111-113) is
the most directly comparable: same `attempts`, same `backoff` type
and delay, but shorter retention because notifications are transient
whereas audit rows are forensic artifacts.

"Alignment with other critical workers" in this codebase means
**documented and reviewable** — every queue's config is explicit at its
definition site and rationale is captured in docs or adjacent comments.
It does NOT mean identical configs; the retry/backoff parameters are
tuned per-queue to match the operational characteristics of each job
type. The cross-link to `notificationQueue` above is a reference point
for the most analogous config, not a constraint that future changes
must preserve identical values.

A future refactor to extract shared defaults (e.g.,
`CRITICAL_QUEUE_DEFAULTS`) is tracked in the backlog but is not a
prerequisite for audit log reliability — the current config already
satisfies the "explicit and documented" bar.
