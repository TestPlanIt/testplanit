/**
 * Startup pass that seals SSO provider configs saved before the app
 * encrypted them at rest, so their client secrets and private keys stop
 * sitting readable in the database and its backups, and removes the sign-in
 * provider tokens earlier versions stored on linked accounts. Same posture
 * as the credential passes: at most once per process, fail-open,
 * CREDENTIAL_ENCRYPTION_BOOTSTRAP=off skips.
 */
import { isEncryptedCredentialBlob } from "~/lib/integrations/ensureCodeRepositoryCredentialsEncrypted";
import { encrypt } from "~/utils/encryption";
import { resolveSsoConfig } from "./ssoConfig";

export interface SsoConfigRewriter {
  ssoProvider: {
    findMany(args: {
      select: { id: true; name: true; type: true; config: true };
    }): Promise<
      Array<{ id: string; name: string; type: string; config: unknown }>
    >;
    update(args: {
      where: { id: string };
      data: { config: { encrypted: string } };
    }): Promise<unknown>;
  };
}

const isEmpty = (value: unknown) =>
  value == null ||
  (typeof value === "object" && Object.keys(value as object).length === 0);

/**
 * Seal every SSO config that is not yet the encrypted blob. Returns how many
 * were sealed and how many could not be read.
 */
export async function encryptLegacySsoConfigs(
  db: SsoConfigRewriter,
  log: (message: string) => void = () => {}
): Promise<{ rewritten: number; unreadable: number; total: number }> {
  const providers = await db.ssoProvider.findMany({
    select: { id: true, name: true, type: true, config: true },
  });
  let rewritten = 0;
  let unreadable = 0;
  for (const row of providers) {
    if (isEmpty(row.config) || isEncryptedCredentialBlob(row.config)) continue;
    let plain: Record<string, string>;
    try {
      plain = await resolveSsoConfig(row.config, row.type);
    } catch {
      unreadable++;
      log(`SSO config for ${row.name} could not be read; re-enter it`);
      continue;
    }
    await db.ssoProvider.update({
      where: { id: row.id },
      data: { config: { encrypted: await encrypt(JSON.stringify(plain)) } },
    });
    rewritten++;
    log(`encrypted SSO config for ${row.name}`);
  }
  return { rewritten, unreadable, total: providers.length };
}

export interface OAuthTokenEraser {
  account: {
    updateMany(args: {
      where: { OR: Array<Record<string, { not: null }>> };
      data: { access_token: null; refresh_token: null; id_token: null };
    }): Promise<{ count: number }>;
  };
}

/**
 * Remove the sign-in provider tokens earlier versions stored on each linked
 * account. Sign-in never reads them back, so they are only a liability.
 * Returns how many accounts were cleared.
 */
export async function clearStoredOAuthTokens(
  db: OAuthTokenEraser
): Promise<number> {
  const { count } = await db.account.updateMany({
    where: {
      OR: [
        { access_token: { not: null } },
        { refresh_token: { not: null } },
        { id_token: { not: null } },
      ],
    },
    data: { access_token: null, refresh_token: null, id_token: null },
  });
  return count;
}

let inFlight: Promise<void> | null = null;

export function ensureSsoConfigEncrypted(): Promise<void> {
  if (process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP === "off") {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { baseClient } = await import("~/lib/zenstack");
      const result = await encryptLegacySsoConfigs(
        baseClient as unknown as SsoConfigRewriter,
        (message) => console.info(`[startup] ${message}`)
      );
      if (result.rewritten > 0 || result.unreadable > 0) {
        console.info(
          `[startup] SSO configs: ${result.rewritten} encrypted, ${result.unreadable} unreadable, ${result.total} checked`
        );
      } else {
        console.info("[startup] SSO configs encrypted ✓");
      }
      const cleared = await clearStoredOAuthTokens(
        baseClient as unknown as OAuthTokenEraser
      );
      if (cleared > 0) {
        console.info(
          `[startup] removed stored sign-in provider tokens from ${cleared} linked accounts`
        );
      }
    } catch (error) {
      console.error(
        "[startup] SSO config encryption failed — older rows stay readable and will be retried on the next start:",
        error
      );
      inFlight = null;
    }
  })();
  return inFlight;
}
