import type { Access, Prisma } from "@prisma/client";

import { resolveEffectiveAccess } from "../access/resolve";

export { readScimFallbackDefault } from "../access/fallbackDefault";

export async function recomputeUserAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  fallbackDefault: Access
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, access: true, accessSource: true },
  });
  if (!user) return;

  const assignments = await tx.groupAssignment.findMany({
    where: { userId },
    select: { group: { select: { mappedAccess: true } } },
  });

  const mappedTiers: Access[] = assignments
    .map((a) => a.group.mappedAccess)
    .filter((v): v is Access => v !== null);

  const isGoverned =
    mappedTiers.length > 0 || user.accessSource === "GROUP_MAPPING";

  if (!isGoverned) {
    return;
  }

  const computed = resolveEffectiveAccess(mappedTiers, fallbackDefault);
  const targetSource = "GROUP_MAPPING";

  if (computed === user.access && targetSource === user.accessSource) {
    return;
  }

  await tx.user.update({
    where: { id: userId },
    data: { access: computed, accessSource: targetSource },
  });
}
