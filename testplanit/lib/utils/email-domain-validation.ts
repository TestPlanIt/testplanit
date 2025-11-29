import { db } from "~/server/db";

/**
 * Check if email domain is allowed for registration
 * @param email The email address to check
 * @returns true if registration is allowed, false otherwise
 */
export async function isEmailDomainAllowed(email: string): Promise<boolean> {
  // First check if domain restrictions are enabled
  const registrationSettings = await db.registrationSettings.findFirst();

  // If no settings exist or domain restriction is disabled, allow all
  if (!registrationSettings || !registrationSettings.restrictEmailDomains) {
    return true;
  }

  // Extract domain from email
  const domain = email.toLowerCase().split("@")[1];
  if (!domain) {
    return false;
  }

  // Check if domain is in the allowed list
  const allowedDomain = await db.allowedEmailDomain.findFirst({
    where: {
      domain: domain,
      enabled: true,
    },
  });

  return !!allowedDomain;
}
