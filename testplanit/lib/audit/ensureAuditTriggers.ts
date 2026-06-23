/**
 * Runtime guarantee that the audit-trigger substrate exists — applied from the application's own
 * boot, independent of HOW the process was launched.
 *
 * The audit pipeline depends on per-table DB triggers that write "DataChangeLog" (capture) plus the
 * append-only enforcement triggers and grants. Those are installed by scripts/apply-triggers.ts.
 * The catch: `prisma db push` SILENTLY DROPS triggers, and the various launch paths don't all run
 * apply-triggers — the docker entrypoint does, but a bare `node server.js`, `next start`, pm2, or a
 * k8s `command:` override that runs `prisma db push` alone does not. The result is silent audit
 * data loss with no error.
 *
 * Calling this from instrumentation.ts (Next's server boot hook) closes that gap: every server
 * start re-attaches the triggers, so capture survives no matter how the app is installed, updated,
 * or relaunched. It is idempotent and serialized across replicas by an advisory lock in
 * applyAuditTriggers.
 *
 * Behavior:
 *  - Runs at most once per process (memoized).
 *  - Uses DIRECT_DATABASE_URL (pooler-bypass) when set, else DATABASE_URL — DDL must not go through
 *    a transaction-pooled PgBouncer.
 *  - Fail-open: a failure is logged loudly but does NOT block startup, so an unrelated DB hiccup
 *    can't take the web tier down. Set AUDIT_TRIGGER_BOOTSTRAP_FATAL=1 to abort startup instead
 *    (recommended for the worker tier, where audit integrity is load-bearing).
 *  - Set AUDIT_TRIGGER_BOOTSTRAP=off to skip entirely (e.g. a read-only role that cannot run DDL).
 */
import { applyAuditTriggers } from "~/scripts/apply-triggers";

let inFlight: Promise<void> | null = null;

export function ensureAuditTriggers(): Promise<void> {
  if (process.env.AUDIT_TRIGGER_BOOTSTRAP === "off") return Promise.resolve();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await applyAuditTriggers({ lock: true });
      console.info("[startup] audit triggers ensured ✓");
    } catch (error) {
      console.error(
        "[startup] audit trigger bootstrap failed — audit capture may be incomplete until this is resolved:",
        error
      );
      if (process.env.AUDIT_TRIGGER_BOOTSTRAP_FATAL === "1") throw error;
      // Fail-open: clear the memo so a later explicit call can retry.
      inFlight = null;
    }
  })();

  return inFlight;
}
