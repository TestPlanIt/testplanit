import { resolveStoredCredentials } from "~/lib/integrations/credentials";

export interface SsoConfigSummary {
  clientId?: string;
  tenantId?: string;
  teamId?: string;
  keyId?: string;
  hasClientSecret: boolean;
  hasPrivateKey: boolean;
}

/**
 * An SSO provider's stored config as plain values, whichever shape it was
 * saved in (sealed blob, or the older cleartext object). Throws when a
 * secret cannot be decrypted.
 */
export async function resolveSsoConfig(
  raw: unknown,
  type: string
): Promise<Record<string, string>> {
  return resolveStoredCredentials(raw, `SSO ${type}`);
}

/**
 * What the admin page may show of a config: its identifiers and which
 * secrets are set, never the secrets themselves.
 */
export function summarizeSsoConfig(
  config: Record<string, string>
): SsoConfigSummary {
  const summary: SsoConfigSummary = {
    hasClientSecret: Boolean(config.clientSecret),
    hasPrivateKey: Boolean(config.privateKey),
  };
  for (const key of ["clientId", "tenantId", "teamId", "keyId"] as const) {
    if (config[key]) summary[key] = config[key];
  }
  return summary;
}
