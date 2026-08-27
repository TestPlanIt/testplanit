/**
 * The single source of truth for values written to `IntegrationProject.syncStatus`
 * — a nullable free-form `String` column (schema.zmodel), not an enum.
 *
 * PURE module: zero imports. Split out of SyncService.ts (28-07) so a
 * "use client" component (requirements-config-settings.tsx) can import this
 * vocabulary directly without pulling SyncService.ts's server-only
 * dependencies (ioredis, bullmq, the raw ZenStack/DB client — none of which
 * are browser-safe and none of which carry a `server-only` guard) into the
 * browser bundle. Mirrors the exact reasoning already documented on
 * requirementTypeConfig.ts, the sibling pure module this file was modeled
 * after.
 *
 * `SyncService.ts` re-exports this object verbatim, so every existing
 * server-side consumer that imports `SYNC_STATUS` from
 * "@/lib/integrations/services/SyncService" keeps working unchanged.
 *
 * `cancelRequested` is an intermediate value written by a cancel request;
 * `cancelled` is the terminal state a paged-to-completion import lands in
 * when it honors one.
 */
export const SYNC_STATUS = {
  syncing: "syncing",
  cancelRequested: "cancel-requested",
  cancelled: "cancelled",
  completed: "completed",
  error: "error",
} as const;

export type SyncStatusValue = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS];
