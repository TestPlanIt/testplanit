import { Prisma } from "@prisma/client";

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025"
  );
}

export function isForeignKeyError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003"
  );
}

export class ReviewGateError extends Error {
  constructor(
    public readonly code: "REVIEW_REQUIRED",
    public readonly entityType: string,
    public readonly entityId: number,
    public readonly toStateId: number,
  ) {
    super(`Review gate blocked transition to state ${toStateId}`);
    this.name = "ReviewGateError";
  }
}

export class AlreadyPendingError extends Error {
  readonly code = "PENDING_REVIEW_EXISTS" as const;

  constructor(
    public readonly entityType: string,
    public readonly entityId: number,
    public readonly existingRequestId: string,
  ) {
    super(`A pending review request already exists for this entity`);
    this.name = "AlreadyPendingError";
  }
}

export function isReviewGateError(err: unknown): err is ReviewGateError {
  return err instanceof ReviewGateError;
}

export function isAlreadyPendingError(
  err: unknown,
): err is AlreadyPendingError | Prisma.PrismaClientKnownRequestError {
  if (err instanceof AlreadyPendingError) return true;
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    typeof err.meta?.target === "string" &&
    (err.meta.target as string).includes("review_request_one_pending_per_entity")
  );
}
