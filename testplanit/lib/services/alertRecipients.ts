/**
 * Who an alert rule reaches when it fires (#651).
 *
 * The audience is the rule's subscriber list, narrowed to people who can
 * still see the project: a subscriber who lost access, was deactivated or
 * was deleted is dropped, so a rule never leaks a subject to someone who
 * cannot open it. System ADMINs can open every project and are kept
 * regardless of membership. A system alert (no project) reaches only its
 * ADMIN subscribers: its subject is administration-level.
 */

import { getProjectEffectiveMemberIds } from "~/lib/services/projectMembers";

interface RecipientDb {
  alertSubscriber: {
    findMany: (args: any) => Promise<Array<{ userId: string }>>;
  };
  user: {
    findMany: (
      args: any
    ) => Promise<Array<{ id: string; access: string | null }>>;
  };
}

export async function resolveAlertRecipients(
  db: RecipientDb,
  ruleId: number,
  projectId: number | null
): Promise<string[]> {
  const subscribers = await db.alertSubscriber.findMany({
    where: { ruleId },
    select: { userId: true },
  });
  if (subscribers.length === 0) return [];

  const subscriberIds = [...new Set(subscribers.map((s) => s.userId))];
  const [members, users] = await Promise.all([
    projectId == null ? [] : getProjectEffectiveMemberIds(projectId),
    db.user.findMany({
      where: {
        id: { in: subscriberIds },
        isActive: true,
        isDeleted: false,
        access: { not: "NONE" },
      },
      select: { id: true, access: true },
    }),
  ]);
  const memberSet = new Set(members);

  return users
    .filter((u) => u.access === "ADMIN" || memberSet.has(u.id))
    .map((u) => u.id);
}
