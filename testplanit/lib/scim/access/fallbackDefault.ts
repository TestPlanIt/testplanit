import type { Access } from "~/zenstack/models";
import type { Prisma } from "@prisma/client";

export const SCIM_DEFAULT_MAPPED_ACCESS_KEY = "scim.defaultMappedAccess";

const VALID_ACCESS_VALUES: readonly string[] = [
  "NONE",
  "USER",
  "PROJECTADMIN",
  "ADMIN",
];

export async function readScimFallbackDefault(
  client: Pick<Prisma.TransactionClient, "appConfig">
): Promise<Access> {
  const row = await client.appConfig.findUnique({
    where: { key: SCIM_DEFAULT_MAPPED_ACCESS_KEY },
    select: { value: true },
  });

  if (!row) {
    return "NONE";
  }

  const value = row.value;
  if (typeof value === "string" && VALID_ACCESS_VALUES.includes(value)) {
    return value as Access;
  }

  return "NONE";
}
