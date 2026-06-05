import type { Prisma } from "@prisma/client";

export class InvalidFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFilterError";
  }
}

export function scimFilterToPrismaWhere(
  _raw: string,
): Prisma.UserWhereInput {
  throw new InvalidFilterError("not implemented");
}
