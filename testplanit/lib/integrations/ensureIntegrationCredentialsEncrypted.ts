/**
 * Startup pass that rewrites issue-integration credentials saved in an older
 * shape — secrets in cleartext, or each value encrypted on its own — as the
 * single `{ encrypted }` blob the integration API writes today.
 *
 * Reads accept the older shapes (cleartext with a warning), so those
 * integrations keep working, but their secrets stay readable in the database
 * and every backup until someone re-saves them. This runs from
 * instrumentation.ts on every boot and is a single cheap read once every row
 * is converted. Same posture as ensureCodeRepositoryCredentialsEncrypted: at
 * most once per process, fail-open, CREDENTIAL_ENCRYPTION_BOOTSTRAP=off skips.
 */
import { encrypt } from "~/utils/encryption";
import { resolveStoredCredentials } from "./credentials";
import { isEncryptedCredentialBlob } from "./ensureCodeRepositoryCredentialsEncrypted";

export interface IntegrationCredentialRewriter {
  integration: {
    findMany(args: {
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
      data: { credentials: { encrypted: string } };
    }): Promise<unknown>;
  };
}

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === "object" && Object.keys(value as object).length === 0);

/**
 * Rewrite every integration whose credentials are not yet the encrypted
 * blob. Returns how many were rewritten and how many could not be read.
 */
export async function encryptLegacyIntegrationCredentials(
  db: IntegrationCredentialRewriter,
  log: (message: string) => void = () => {}
): Promise<{ rewritten: number; unreadable: number; total: number }> {
  const integrations = await db.integration.findMany({
    select: { id: true, name: true, provider: true, credentials: true },
  });
  let rewritten = 0;
  let unreadable = 0;
  for (const row of integrations) {
    if (
      isEmpty(row.credentials) ||
      isEncryptedCredentialBlob(row.credentials)
    ) {
      continue;
    }
    let plain: Record<string, string>;
    try {
      plain = await resolveStoredCredentials(row.credentials, row.provider);
    } catch {
      // A corrupt row is for an admin to re-enter; leave it and say so.
      unreadable++;
      log(
        `credentials for integration #${row.id} ${row.name} could not be read; re-enter them`
      );
      continue;
    }
    await db.integration.update({
      where: { id: row.id },
      data: {
        credentials: { encrypted: await encrypt(JSON.stringify(plain)) },
      },
    });
    rewritten++;
    log(`encrypted credentials for integration #${row.id} ${row.name}`);
  }
  return { rewritten, unreadable, total: integrations.length };
}

let inFlight: Promise<void> | null = null;

export function ensureIntegrationCredentialsEncrypted(): Promise<void> {
  if (process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP === "off") {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { baseClient } = await import("~/lib/zenstack");
      const result = await encryptLegacyIntegrationCredentials(
        baseClient as unknown as IntegrationCredentialRewriter,
        (message) => console.info(`[startup] ${message}`)
      );
      if (result.rewritten > 0 || result.unreadable > 0) {
        console.info(
          `[startup] integration credentials: ${result.rewritten} encrypted, ${result.unreadable} unreadable, ${result.total} checked`
        );
      } else {
        console.info("[startup] integration credentials encrypted ✓");
      }
    } catch (error) {
      console.error(
        "[startup] integration credential encryption failed — older rows stay readable and will be retried on the next start:",
        error
      );
      // Fail-open: clear the memo so a later explicit call can retry.
      inFlight = null;
    }
  })();

  return inFlight;
}
