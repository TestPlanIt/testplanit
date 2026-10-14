/**
 * Startup pass that encrypts outbound webhook URLs saved before the app
 * encrypted them at rest, so a Slack URL stops sitting readable in the
 * database and its backups. Same posture as the credential passes: at most
 * once per process, fail-open, CREDENTIAL_ENCRYPTION_BOOTSTRAP=off skips.
 */
import { isEncrypted } from "~/utils/encryption";
import { sealOutboundUrl } from "./outboundUrl";

export interface OutboundUrlRewriter {
  webhookConfig: {
    findMany(args: {
      where: { direction: "OUTBOUND"; url: { not: null } };
      select: { id: true; url: true };
    }): Promise<Array<{ id: string; url: string | null }>>;
    update(args: {
      where: { id: string };
      data: { url: string };
    }): Promise<unknown>;
  };
}

/** Encrypt every outbound URL still stored in the clear; returns how many. */
export async function encryptLegacyOutboundUrls(
  db: OutboundUrlRewriter
): Promise<{ rewritten: number; total: number }> {
  const configs = await db.webhookConfig.findMany({
    where: { direction: "OUTBOUND", url: { not: null } },
    select: { id: true, url: true },
  });
  let rewritten = 0;
  for (const config of configs) {
    if (!config.url || isEncrypted(config.url)) continue;
    await db.webhookConfig.update({
      where: { id: config.id },
      data: { url: await sealOutboundUrl(config.url) },
    });
    rewritten++;
  }
  return { rewritten, total: configs.length };
}

let inFlight: Promise<void> | null = null;

export function ensureOutboundWebhookUrlsEncrypted(): Promise<void> {
  if (process.env.CREDENTIAL_ENCRYPTION_BOOTSTRAP === "off") {
    return Promise.resolve();
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { baseClient } = await import("~/lib/zenstack");
      const result = await encryptLegacyOutboundUrls(
        baseClient as unknown as OutboundUrlRewriter
      );
      if (result.rewritten > 0) {
        console.info(
          `[startup] outbound webhook URLs: ${result.rewritten} encrypted, ${result.total} checked`
        );
      } else {
        console.info("[startup] outbound webhook URLs encrypted ✓");
      }
    } catch (error) {
      console.error(
        "[startup] outbound webhook URL encryption failed — older rows stay readable and will be retried on the next start:",
        error
      );
      inFlight = null;
    }
  })();
  return inFlight;
}
