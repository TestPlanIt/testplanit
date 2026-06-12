import type { Access } from "@prisma/client";

export const ACCESS_RANK: Record<Access, number> = {
  NONE: 0,
  USER: 1,
  PROJECTADMIN: 2,
  ADMIN: 3,
};

export function resolveEffectiveAccess(
  mappedTiers: Access[],
  fallbackDefault: Access
): Access {
  if (mappedTiers.length === 0) {
    return fallbackDefault;
  }

  return mappedTiers.reduce<Access>((best, tier) => {
    return ACCESS_RANK[tier] > ACCESS_RANK[best] ? tier : best;
  }, mappedTiers[0]);
}
