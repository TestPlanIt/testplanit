import type { Access } from "~/zenstack/models";
import type { TxClient } from "~/lib/zenstack";

import { resolveEffectiveAccess } from "../access/resolve";

export { readScimFallbackDefault } from "../access/fallbackDefault";

/**
 * Translate the role values the IdP last asserted for a user into access
 * tiers via the admin-configured ScimRoleMapping table.
 *
 * Unmapped role values are ignored rather than treated as NONE — an IdP
 * commonly asserts organizational roles ("engineering", "contractor") that
 * carry no access meaning here, and mapping those to NONE would silently
 * strip access. Only values an admin explicitly mapped participate.
 */
export async function resolveRoleTiers(
  tx: TxClient,
  roleValues: string[]
): Promise<Access[]> {
  if (roleValues.length === 0) return [];

  const mappings = await tx.scimRoleMapping.findMany({
    where: { roleValue: { in: roleValues } },
    select: { mappedAccess: true },
  });

  return mappings.map((m) => m.mappedAccess);
}

export async function recomputeUserAccess(
  tx: TxClient,
  userId: string,
  fallbackDefault: Access
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, access: true, accessSource: true, scimRoles: true },
  });
  if (!user) return;

  const assignments = await tx.groupAssignment.findMany({
    where: { userId },
    select: { group: { select: { mappedAccess: true } } },
  });

  const mappedTiers: Access[] = assignments
    .map((a) => a.group.mappedAccess)
    .filter((v): v is Access => v !== null);

  const roleTiers = await resolveRoleTiers(tx, user.scimRoles);

  // A user is directory-governed once any mapping input applies to them, or
  // once a previous recompute already took ownership of their tier. Role
  // mappings join group mappings as a governing input: an IdP asserting a
  // mapped role is enough on its own, even with no mapped group.
  const isGoverned =
    mappedTiers.length > 0 ||
    roleTiers.length > 0 ||
    user.accessSource === "GROUP_MAPPING";

  if (!isGoverned) {
    return;
  }

  const computed = resolveEffectiveAccess(
    mappedTiers,
    fallbackDefault,
    roleTiers
  );
  const targetSource = "GROUP_MAPPING";

  if (computed === user.access && targetSource === user.accessSource) {
    return;
  }

  await tx.user.update({
    where: { id: userId },
    data: { access: computed, accessSource: targetSource },
  });
}
