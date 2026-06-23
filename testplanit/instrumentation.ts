/**
 * Next.js server instrumentation hook. Runs once when the server starts
 * (nodejs runtime only, not edge), before any request is served — and on
 * EVERY launcher: docker entrypoint, `next start`, standalone `node server.js`,
 * pm2, or a k8s `command:` override. That makes it the one launch-agnostic
 * place to guarantee runtime invariants.
 *
 * Use this to fail fast on missing security-critical configuration. A
 * production deployment without ENCRYPTION_KEY would silently fall back
 * to a built-in default key and effectively publish every encrypted
 * secret in the database — better to refuse to start than to run insecure.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEncryptionConfigured } = await import("~/utils/encryption");
  try {
    assertEncryptionConfigured();
    // Intentionally terse — never log the key itself.
    console.info("[startup] ENCRYPTION_KEY configured ✓");
  } catch (error) {
    // Re-throw so the server process exits instead of accepting traffic.
    // The deploy platform's health check will see the failure and hold
    // the rollout.
    console.error("[startup] encryption misconfiguration:", error);
    throw error;
  }

  // Re-attach the audit-trigger substrate on every boot. `prisma db push` silently drops these
  // triggers and not every launch path runs apply-triggers, so doing it here is what keeps audit
  // capture alive no matter how the app is installed/updated/launched. Idempotent, advisory-locked,
  // and fail-open by default (see ensureAuditTriggers); never blocks startup unless explicitly made
  // fatal via AUDIT_TRIGGER_BOOTSTRAP_FATAL=1.
  const { ensureAuditTriggers } =
    await import("~/lib/audit/ensureAuditTriggers");
  await ensureAuditTriggers();
}
