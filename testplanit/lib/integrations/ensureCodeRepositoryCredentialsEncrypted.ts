/**
 * Startup pass that encrypts code repository credentials saved before the
 * app encrypted them at rest.
 *
 * Writes now encrypt through sideEffectsPlugin, and reads accept the older
 * plain shape with a warning, so an upgraded instance keeps working with its
 * plaintext rows — but they stay plaintext, in the database and every backup,
 * until something rewrites them. Nobody should have to remember to. This
 * runs from instrumentation.ts on every boot: it re-saves each row whose
 * credentials are not yet the `{ encrypted }` blob, which the plugin then
 * encrypts, and it is a single cheap read once everything is converted.
 *
 * Behavior mirrors ensureAuditTriggers: at most once per process, fail-open
 * (logged, never blocks startup), CREDENTIAL_ENCRYPTION_BOOTSTRAP=off skips it.
 */
import { resolveStoredCredentials } from "./credentials";

export interface CredentialRewriter {
  codeRepository: {
    findMany(args: {
      where: { isDeleted: boolean };
      select: { id: true; name: true; provider: true; credentials: true };
    }): Promise<
      Array<{
        id: number;
        name: string;
        provider: string;
        credentials: unknown;
      }>
    >;
    update(args: {
      where: { id: number };
      data: { credentials: Record<string, string> };
    }): Promise<unknown>;
  };
}

export const isEncryptedCredentialBlob = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { encrypted?: unknown }).encrypted === "string";

/**
 * Re-save every repository whose credentials are still plain. Returns how
 * many were rewritten and how many were left because they could not be read.
 */
export async function encryptLegacyCodeRepositoryCredentials(
  db: CredentialRewriter,
  log: (message: string) => void = () => {}
): Promise<{ rewritten: number; unreadable: number; total: number }> {
  const repositories = await db.codeRepository.findMany({
    where: { isDeleted: false },
    select: { id: true, name: true, provider: true, credentials: true },
  });
  let rewritten = 0;
  let unreadable = 0;
  for (const repo of repositories) {
    if (isEncryptedCredentialBlob(repo.credentials)) continue;
    let plain: Record<string, string>;
    try {
      plain = await resolveStoredCredentials(repo.credentials, repo.provider);
    } catch {
      // A corrupt row is for an admin to re-enter; leave it and say so.
      unreadable++;
      log(
        `credentials for repository #${repo.id} ${repo.name} could not be read; re-enter them`
      );
      continue;
    }
    await db.codeRepository.update({
      where: { id: repo.id },
      data: { credentials: plain },
    });
    rewritten++;
    log(`encrypted credentials for repository #${repo.id} ${repo.name}`);
  }
  return { rewritten, unreadable, total: repositories.length };
}

let inFlight: Promise<void> | null = null;

export function ensureCodeRepositoryCredentialsEncrypted(): Promise<void> {
  if (process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP === "off") {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { baseClient } = await import("~/lib/zenstack");
      const result = await encryptLegacyCodeRepositoryCredentials(
        baseClient as unknown as CredentialRewriter,
        (message) => console.info(`[startup] ${message}`)
      );
      if (result.rewritten > 0 || result.unreadable > 0) {
        console.info(
          `[startup] code repository credentials: ${result.rewritten} encrypted, ${result.unreadable} unreadable, ${result.total} checked`
        );
      } else {
        console.info("[startup] code repository credentials encrypted ✓");
      }
    } catch (error) {
      console.error(
        "[startup] code repository credential encryption failed — plaintext rows stay readable and will be retried on the next start:",
        error
      );
      // Fail-open: clear the memo so a later explicit call can retry.
      inFlight = null;
    }
  })();

  return inFlight;
}
