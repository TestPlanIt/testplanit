import { NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import {
  resolveSsoConfig,
  summarizeSsoConfig,
  type SsoConfigSummary,
} from "~/lib/auth/ssoConfig";
import { getServerAuthSession } from "~/server/auth";

/**
 * What the SSO settings page may show of each provider's config: its
 * identifiers and whether each secret is set. Secrets never leave the server.
 */
export async function GET() {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = await baseDb.ssoProvider.findMany({
    select: { id: true, type: true, config: true },
  });
  const summaries: Record<string, SsoConfigSummary> = {};
  for (const provider of providers) {
    try {
      summaries[provider.id] = summarizeSsoConfig(
        await resolveSsoConfig(provider.config, provider.type)
      );
    } catch (error) {
      console.error(`Error reading SSO config for ${provider.type}:`, error);
      summaries[provider.id] = { hasClientSecret: false, hasPrivateKey: false };
    }
  }
  return NextResponse.json({ providers: summaries });
}
