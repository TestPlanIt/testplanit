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

export class IneligibleReviewerError extends Error {
  readonly code = "INELIGIBLE_REVIEWER" as const;

  constructor(
    public readonly userId: string,
    public readonly reviewRequestId: string,
  ) {
    super(
      `User ${userId} is not eligible to decide review request ${reviewRequestId}`,
    );
    this.name = "IneligibleReviewerError";
  }
}

export function isIneligibleReviewerError(
  err: unknown,
): err is IneligibleReviewerError {
  return err instanceof IneligibleReviewerError;
}

export function isReviewGateError(err: unknown): err is ReviewGateError {
  return err instanceof ReviewGateError;
}

export function isAlreadyPendingError(
  err: unknown,
): err is AlreadyPendingError | Prisma.PrismaClientKnownRequestError {
  if (err instanceof AlreadyPendingError) return true;
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== "P2002"
  ) {
    return false;
  }
  // Prisma reports `meta.target` in two shapes depending on the underlying
  // driver and Prisma version:
  //   - String: the bare index name, e.g. "review_request_one_pending_per_entity".
  //   - Array<string>: the field list, e.g. ["entityType", "entityId"]
  //     (Prisma 6.19+ with the rust query engine returns this for partial
  //     unique indexes on the ReviewRequest table — verified live against
  //     PostgreSQL by lib/services/schemaValidation.test.ts).
  // Match both. The message body always includes the field tuple wording
  // "(`entityType`,`entityId`)", which is the disambiguating signal when
  // `meta.target` is the array form (the array alone cannot be attributed
  // to one specific partial index, but on the ReviewRequest table this
  // exact pair only belongs to `review_request_one_pending_per_entity`).
  const target = err.meta?.target;
  if (typeof target === "string") {
    return target.includes("review_request_one_pending_per_entity");
  }
  if (Array.isArray(target)) {
    const fields = target.map(String);
    return fields.includes("entityType") && fields.includes("entityId");
  }
  return false;
}
