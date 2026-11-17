import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";

/**
 * The user webhook actions act as: the seeded System user, or, on a database
 * the seed hasn't reached yet, the given fallback (the project's creator).
 */
export async function webhookActorId(
  db: any,
  fallbackUserId: string
): Promise<string> {
  const system = await db.user
    .findUnique({
      where: { id: SYSTEM_AUTOMATION_USER_ID },
      select: { id: true },
    })
    .catch(() => null);
  if (system) return SYSTEM_AUTOMATION_USER_ID;
  console.warn(
    "[webhook-actions] System user missing; acting as the project creator"
  );
  return fallbackUserId;
}
