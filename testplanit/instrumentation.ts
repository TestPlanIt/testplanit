/**
 * Next.js server instrumentation hook. Runs once when the server starts
 * (nodejs runtime only, not edge), before any request is served.
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
}
