import type { Access } from "~/zenstack/models";

export const ACCESS_RANK: Record<Access, number> = {
  NONE: 0,
  USER: 1,
  PROJECTADMIN: 2,
  ADMIN: 3,
};

function highestTier(tiers: Access[]): Access {
  return tiers.reduce<Access>((best, tier) => {
    return ACCESS_RANK[tier] > ACCESS_RANK[best] ? tier : best;
  }, tiers[0]);
}

/**
 * Resolve the access tier a directory-governed user should hold.
 *
 * Two independent inputs, in precedence order:
 *
 *   1. `roleTiers` — tiers derived from the IdP's `roles` core attribute via
 *      ScimRoleMapping. When the IdP asserts any mapped role, that assertion
 *      wins outright: it is a statement about the person, not about a group
 *      they happen to sit in. Highest-wins applies *within* the role tiers,
 *      so a user asserting two mapped roles gets the stronger one.
 *   2. `mappedTiers` — tiers derived from group membership
 *      (`Groups.mappedAccess`), highest-wins among themselves.
 *
 * When neither input yields a tier, `fallbackDefault` applies.
 *
 * Precedence is deliberately absolute rather than another highest-wins input:
 * a role mapping of USER on a user who also sits in an ADMIN-mapped group
 * resolves to USER. That is what makes the roles attribute usable as a
 * *correction* to coarse group mapping, which is the whole point of the
 * hybrid. Callers that only have group tiers omit `roleTiers` and get the
 * original two-input behaviour unchanged.
 */
export function resolveEffectiveAccess(
  mappedTiers: Access[],
  fallbackDefault: Access,
  roleTiers: Access[] = []
): Access {
  if (roleTiers.length > 0) {
    return highestTier(roleTiers);
  }

  if (mappedTiers.length === 0) {
    return fallbackDefault;
  }

  return highestTier(mappedTiers);
}
