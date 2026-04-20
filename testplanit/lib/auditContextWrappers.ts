import { headers as nextHeaders } from "next/headers";
import type { NextRequest } from "next/server";
import type { Job, JobsOptions, Queue } from "bullmq";
import {
  type AuditContext,
  SYSTEM_ACTOR_ID,
  extractAuditContextFromHeaders,
  getAuditContext,
  runWithAuditContext,
  updateAuditContext,
} from "~/lib/auditContext";

/**
 * HOF that wraps an API route handler in an AsyncLocalStorage frame
 * seeded with ipAddress/userAgent/requestId extracted from the request.
 *
 * Identity enrichment (userId/userEmail/userName) happens later via
 * the NextAuth `session` callback calling `updateAuditContext` — no
 * per-route change is needed for identity. Bearer-token routes must
 * call `enrichFromApiAuth(apiAuth)` after token validation (Plan 02 B1).
 *
 * Per Phase 64 D-01.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withAuditContext<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends (req: NextRequest, ...rest: any[]) => Promise<Response>,
>(handler: H): H {
  const wrapped = (async (req: NextRequest, ...rest: unknown[]) => {
    const ctx: AuditContext = extractAuditContextFromHeaders(req.headers);
    return runWithAuditContext(ctx, () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler(req, ...(rest as any)),
    );
  }) as H;
  return wrapped;
}

/**
 * HOF that wraps a Next.js server action in an AsyncLocalStorage frame.
 *
 * Uses `await headers()` from next/headers (Next.js 16 server-action-safe)
 * and generates a fresh requestId per action invocation (per D-07 —
 * server actions are their own POSTs from the client and do not share
 * a requestId with the page render that triggered them).
 *
 * Per Phase 64 D-05.
 */
export function withActionAuditContext<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const headersList = await nextHeaders();
    // next/headers returns ReadonlyHeaders which is structurally compatible
    // with Headers for the extractor's purposes.
    const ctx: AuditContext = extractAuditContextFromHeaders(
      headersList as unknown as Headers,
    );
    return runWithAuditContext(ctx, () => fn(...args));
  };
}

/**
 * Enrich the current ALS frame with identity fields from a Bearer-token
 * (`tpi_...`) API-auth result. This is a tiny wrapper around
 * `updateAuditContext` that exists so all Bearer-authed routes use a
 * single, greppable export name.
 *
 * Per Phase 64 B1: called from the 6 Bearer-token-authed audit-emitting
 * routes after `authenticateApiToken` resolves. No-op when ALS is empty
 * (updateAuditContext itself is a no-op in that case).
 */
export function enrichFromApiAuth(apiAuth: {
  userId: string;
  userEmail?: string;
  userName?: string;
}): void {
  updateAuditContext({
    userId: apiAuth.userId,
    userEmail: apiAuth.userEmail,
    userName: apiAuth.userName,
  });
}

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
export function enqueueWithAuditContext<T extends Record<string, unknown>>(
  queue: Queue,
  name: string,
  data: T,
  opts?: JobsOptions,
): Promise<Job<ActorContextJobData<T>>>;
export function enqueueWithAuditContext<T extends Record<string, unknown>>(
  queue: Queue,
  name: string,
  data: T,
  systemOpts: EnqueueSystemOptions,
  opts?: JobsOptions,
): Promise<Job<ActorContextJobData<T>>>;
export async function enqueueWithAuditContext<
  T extends Record<string, unknown>,
>(
  queue: Queue,
  name: string,
  data: T,
  optsOrSystem?: JobsOptions | EnqueueSystemOptions,
  maybeOpts?: JobsOptions,
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
  const hasAlsIdentity = Boolean(
    alsContext &&
      (alsContext.userId ||
        alsContext.userEmail ||
        alsContext.userName ||
        alsContext.ipAddress ||
        alsContext.userAgent ||
        alsContext.requestId),
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
      "enqueueWithAuditContext: no audit context present; pass { systemReason } to stamp __system__",
    );
  }

  return queue.add(
    name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload as any,
    jobOpts,
  ) as Promise<Job<ActorContextJobData<T>>>;
}
