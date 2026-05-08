/**
 * Audit-context constants that are safe to import from anywhere — including
 * client components and edge runtimes. Anything that pulls in `async_hooks`
 * (the AsyncLocalStorage frame) lives in `auditContext.ts` and must not be
 * imported from a browser bundle. The constants here are pure values, so
 * client code (e.g. the audit-log table renderer) can import them without
 * dragging Node-only deps into the client chunk.
 */

/**
 * Sentinel userId for audit events that have no originating human actor
 * (scheduled jobs, worker-to-worker fan-outs, infrastructure tasks).
 *
 * Per Phase 64 D-12 / D-13: no schema migration is introduced — this
 * string literal lives in the existing userId column. Queries that
 * exclude system-initiated events use `WHERE "userId" <> '__system__'`.
 */
export const SYSTEM_ACTOR_ID = "__system__" as const;

/** Type-level alias for code that must branch on system-vs-human actors. */
export type SystemActor = typeof SYSTEM_ACTOR_ID;
