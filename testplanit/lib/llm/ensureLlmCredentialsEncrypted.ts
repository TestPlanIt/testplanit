/**
 * Startup pass that seals AI model integration credentials saved before the
 * app encrypted them at rest. Those rows still read (as plain values), but
 * their API keys stay readable in the database and every backup until this
 * pass or a re-save rewrites them as the `{ encrypted }` blob the write hook
 * stores. Runs from instrumentation.ts on every boot and is a single cheap
 * read once every row is converted. Same posture as the integration pass: at
 * most once per process, fail-open, CREDENTIAL_ENCRYPTION_BOOTSTRAP=off skips.
 */
import { encrypt } from "~/utils/encryption";
import { isEncryptedCredentialBlob } from "~/lib/integrations/ensureCodeRepositoryCredentialsEncrypted";
import { resolveLlmCredentials } from "./credentials";

export interface LlmCredentialRewriter {
  llmIntegration: {
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
      data: { credentials: { encrypted: string } };
    }): Promise<unknown>;
  };
}

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === "object" && Object.keys(value as object).length === 0);

/**
 * Seal every integration whose credentials are not yet the encrypted blob.
 * Returns how many were sealed and how many could not be read.
 */
export async function encryptLegacyLlmCredentials(
  db: LlmCredentialRewriter,
  log: (message: string) => void = () => {}
): Promise<{ rewritten: number; unreadable: number; total: number }> {
  const integrations = await db.llmIntegration.findMany({
    where: { isDeleted: false },
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
      plain = {
        ...(await resolveLlmCredentials(row.credentials, row.provider)),
      };
    } catch {
      unreadable++;
      log(
        `credentials for AI model #${row.id} ${row.name} could not be read; re-enter them`
      );
      continue;
    }
    await db.llmIntegration.update({
      where: { id: row.id },
      data: {
        credentials: { encrypted: await encrypt(JSON.stringify(plain)) },
      },
    });
    rewritten++;
    log(`encrypted credentials for AI model #${row.id} ${row.name}`);
  }
  return { rewritten, unreadable, total: integrations.length };
}

let inFlight: Promise<void> | null = null;

export function ensureLlmCredentialsEncrypted(): Promise<void> {
  if (process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP === "off") {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { baseClient } = await import("~/lib/zenstack");
      const result = await encryptLegacyLlmCredentials(
        baseClient as unknown as LlmCredentialRewriter,
        (message) => console.info(`[startup] ${message}`)
      );
      if (result.rewritten > 0 || result.unreadable > 0) {
        console.info(
          `[startup] AI model credentials: ${result.rewritten} encrypted, ${result.unreadable} unreadable, ${result.total} checked`
        );
      } else {
        console.info("[startup] AI model credentials encrypted ✓");
      }
    } catch (error) {
      console.error(
        "[startup] AI model credential encryption failed — older rows stay readable and will be retried on the next start:",
        error
      );
      // Fail-open: clear the memo so a later explicit call can retry.
      inFlight = null;
    }
  })();
  return inFlight;
}
