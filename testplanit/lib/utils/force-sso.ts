import { db } from "~/server/db";

/**
 * Check if Force SSO is on. Same rule as the sign-in and signup pages:
 * on when any SSO provider has forceSso set.
 * @returns true if password sign-in and local signup are disabled
 */
export async function isForceSsoEnabled(): Promise<boolean> {
  const provider = await db.ssoProvider.findFirst({
    where: { forceSso: true },
    select: { id: true },
  });

  return !!provider;
}
