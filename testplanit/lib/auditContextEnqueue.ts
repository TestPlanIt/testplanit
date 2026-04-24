import type { Job, JobsOptions, Queue } from "bullmq";
import {
  type AuditContext,
  SYSTEM_ACTOR_ID,
  getAuditContext,
} from "~/lib/auditContext";

/**
 * Runtime-agnostic BullMQ audit-context helpers.
 *
 * This module is intentionally free of any `next/*` imports so that it can
 * be loaded by BullMQ workers, which run against a Docker image that
 * strips Next.js from node_modules to save ~900MB. The Next.js-specific
 * HOFs (withAuditContext, withActionAuditContext, enrichFromApiAuth) live
 * in `./auditContextWrappers.ts` and MUST NOT be imported from here.
 */

/**
 * System-actor stamping options. Callers that legitimately enqueue jobs
 * from outside any user request (scheduled jobs, worker-to-worker where
 * no upstream context exists, infrastructure tasks) MUST pass a
 * `systemReason` so the audit log records WHY the event has no actor.
 *
 * Convention: `scope:identifier` e.g. `"scheduled:daily-report-rollup"`,
 * `"scheduled:budget-alert-check"`, `"fixture:test-fixture"`. Free-form
 * is acceptable — it is stored as-is on the ALS frame and merged into
 * event.metadata by captureAuditEvent.
 *
 * Per Phase 64 D-14 / D-15 / W5.
 */
export interface EnqueueSystemOptions {
  systemReason: string;
}

export type ActorContextJobData<T> = T & {
  actorContext: AuditContext;
  /** Mirror of actorContext.systemReason for consumers that read job root directly. */
  systemReason?: string;
};

/**
 * Enqueue a job with actor context stamped from the current ALS frame,
 * OR explicitly stamp as `__system__` when no ALS context is available
 * and a `systemReason` is provided.
 *
 * Throws at enqueue-time when no ALS context is present AND no
 * systemReason is provided — this is intentional: callers must decide
 * consciously whether a job is user-attributed or system-initiated.
 *
 * When stamping `__system__`, the systemReason is embedded INSIDE
 * actorContext (so `runWithAuditContext(job.data.actorContext, ...)` in
 * the worker re-populates ALS with systemReason, and captureAuditEvent
 * merges it into event.metadata — see W5 Option A). A root-level mirror
 * of systemReason is preserved for consumers that read the job data
 * directly.
 *
 * Per Phase 64 D-08 / D-14 / W5.
 */
export function enqueueWithAuditContext<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  opts?: JobsOptions
): Promise<Job<ActorContextJobData<T>>>;
export function enqueueWithAuditContext<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  systemOpts: EnqueueSystemOptions,
  opts?: JobsOptions
): Promise<Job<ActorContextJobData<T>>>;
export async function enqueueWithAuditContext<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  optsOrSystem?: JobsOptions | EnqueueSystemOptions,
  maybeOpts?: JobsOptions
): Promise<Job<ActorContextJobData<T>>> {
  const isSystemOpts =
    typeof optsOrSystem === "object" &&
    optsOrSystem !== null &&
    "systemReason" in optsOrSystem &&
    typeof (optsOrSystem as EnqueueSystemOptions).systemReason === "string";

  const jobOpts: JobsOptions | undefined = isSystemOpts
    ? maybeOpts
    : (optsOrSystem as JobsOptions | undefined);

  const alsContext = getAuditContext();
  // WR-01: empty strings are "present but empty", which is just as
  // invalid as absent. Compare explicitly against null/undefined AND ""
  // so a future refactor that defaults a field to "" does not silently
  // flip a user-attributed event into the system branch.
  const isPresent = (value: unknown): boolean =>
    typeof value === "string" && value.length > 0;
  const hasAlsIdentity = Boolean(
    alsContext &&
    (isPresent(alsContext.userId) ||
      isPresent(alsContext.userEmail) ||
      isPresent(alsContext.userName) ||
      isPresent(alsContext.ipAddress) ||
      isPresent(alsContext.userAgent) ||
      isPresent(alsContext.requestId))
  );

  let payload: ActorContextJobData<T>;

  if (hasAlsIdentity && alsContext) {
    payload = {
      ...data,
      actorContext: { ...alsContext },
    };
  } else if (isSystemOpts) {
    const systemReason = (optsOrSystem as EnqueueSystemOptions).systemReason;
    payload = {
      ...data,
      actorContext: { userId: SYSTEM_ACTOR_ID, systemReason },
      systemReason,
    };
  } else {
    throw new Error(
      "enqueueWithAuditContext: no audit context present; pass { systemReason } to stamp __system__"
    );
  }

  return queue.add(name, payload as any, jobOpts) as Promise<
    Job<ActorContextJobData<T>>
  >;
}
