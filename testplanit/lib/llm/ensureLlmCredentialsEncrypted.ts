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
      select: {
        id: true;
        name: true;
        provider: true;
        credentials: true;
        settings: true;
      };
    }): Promise<
      Array<{
        id: number;
        name: string;
        provider: string;
        credentials: unknown;
        settings: unknown;
      }>
    >;
    update(args: {
      where: { id: number };
      data: {
        credentials: { encrypted: string };
        settings?: Record<string, unknown>;
      };
    }): Promise<unknown>;
  };
}

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === "object" && Object.keys(value as object).length === 0);

/** Settings keys that hold secrets and belong in the sealed credentials. */
const SECRET_SETTINGS_KEYS = ["apiKey", "headers"] as const;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Seal every integration whose credentials are not yet the encrypted blob,
 * and move an API key or request headers kept in its settings (which every
 * signed-in user can read) into the sealed credentials. Returns how many
 * were sealed and how many could not be read.
 */
export async function encryptLegacyLlmCredentials(
  db: LlmCredentialRewriter,
  log: (message: string) => void = () => {}
): Promise<{ rewritten: number; unreadable: number; total: number }> {
  const integrations = await db.llmIntegration.findMany({
    select: {
      id: true,
      name: true,
      provider: true,
      credentials: true,
      settings: true,
    },
  });
  let rewritten = 0;
  let unreadable = 0;
  for (const row of integrations) {
    const settings = asObject(row.settings);
    const misplaced = SECRET_SETTINGS_KEYS.filter(
      (key) => settings && key in settings
    );
    const sealed = isEncryptedCredentialBlob(row.credentials);
    if ((isEmpty(row.credentials) || sealed) && misplaced.length === 0) {
      continue;
    }
    let plain: Record<string, unknown>;
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
    let remainingSettings: Record<string, unknown> | undefined;
    if (settings && misplaced.length > 0) {
      remainingSettings = { ...settings };
      for (const key of misplaced) {
        if (plain[key] === undefined && settings[key])
          plain[key] = settings[key];
        delete remainingSettings[key];
      }
    }
    await db.llmIntegration.update({
      where: { id: row.id },
      data: {
        credentials: { encrypted: await encrypt(JSON.stringify(plain)) },
        ...(remainingSettings ? { settings: remainingSettings } : {}),
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
