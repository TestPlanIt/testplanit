import { ApplicationArea } from "~/zenstack/models";
import { ORMError } from "@zenstackhq/orm";

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof ORMError && err.code === "P2002"
  );
}

export function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof ORMError && err.code === "P2025"
  );
}

export function isForeignKeyError(err: unknown): boolean {
  return (
    err instanceof ORMError && err.code === "P2003"
  );
}

export class ReviewGateError extends Error {
  /**
   * `toStateId` is the user's intended target. `blockingStateId` is the
   * gate that actually fired — they differ when transitive gating blocks a
   * downstream transition: e.g. target 6 blocked by gate at state 4.
   * Defaults to `toStateId` for callers that don't know about transitive
   * gating yet; new callers should pass both explicitly so client UI can
   * surface "approval required for {blockingStateName}" even when the
   * user picked a different target.
   */
  public readonly blockingStateId: number;

  constructor(
    public readonly code: "REVIEW_REQUIRED",
    public readonly entityType: string,
    public readonly entityId: number,
    public readonly toStateId: number,
    blockingStateId?: number
  ) {
    const blocking = blockingStateId ?? toStateId;
    super(
      blocking === toStateId
        ? `Review gate blocked transition to state ${toStateId}`
        : `Review gate at state ${blocking} blocks transition to state ${toStateId}`
    );
    this.blockingStateId = blocking;
    this.name = "ReviewGateError";
  }
}

export class AlreadyPendingError extends Error {
  readonly code = "PENDING_REVIEW_EXISTS" as const;

  constructor(
    public readonly entityType: string,
    public readonly entityId: number,
    public readonly existingRequestId: string
  ) {
    super(`A pending review request already exists for this entity`);
    this.name = "AlreadyPendingError";
  }
}

export class IneligibleReviewerError extends Error {
  readonly code = "INELIGIBLE_REVIEWER" as const;

  constructor(
    public readonly userId: string,
    public readonly reviewRequestId: string
  ) {
    super(
      `User ${userId} is not eligible to decide review request ${reviewRequestId}`
    );
    this.name = "IneligibleReviewerError";
  }
}

export function isIneligibleReviewerError(
  err: unknown
): err is IneligibleReviewerError {
  return err instanceof IneligibleReviewerError;
}

/**
 * Thrown by the request-time `assertAssigneeCanApprove` helper when the
 * chosen assignee (user or role) lacks the canApprove permission on the
 * entity's ApplicationArea. Distinct from IneligibleReviewerError
 * (decide-time) so observability and tests stay sharp on request-vs-decide
 * failures.
 */
export class IneligibleAssigneeError extends Error {
  readonly code = "INELIGIBLE_ASSIGNEE" as const;

  constructor(
    public readonly assigneeRef: string,
    public readonly area: ApplicationArea
  ) {
    super(`Assignee ${assigneeRef} lacks canApprove on ${area}`);
    this.name = "IneligibleAssigneeError";
  }
}

export function isIneligibleAssigneeError(
  err: unknown
): err is IneligibleAssigneeError {
  return err instanceof IneligibleAssigneeError;
}

/**
 * Thrown by review-decision / review-cancel server paths when the system-level
 * or project-level review feature flag is OFF. Surfaces as a 403 with the
 * typed `FEATURE_DISABLED` envelope; callers translate to UI copy.
 */
export class FeatureDisabledError extends Error {
  readonly code = "FEATURE_DISABLED" as const;

  constructor(public readonly feature: string = "review") {
    super(`Feature "${feature}" is disabled`);
    this.name = "FeatureDisabledError";
  }
}

export function isFeatureDisabledError(
  err: unknown
): err is FeatureDisabledError {
  return err instanceof FeatureDisabledError;
}

export function isReviewGateError(err: unknown): err is ReviewGateError {
  return err instanceof ReviewGateError;
}

export function isAlreadyPendingError(
  err: unknown
): err is AlreadyPendingError | ORMError {
  if (err instanceof AlreadyPendingError) return true;
  if (
    !(err instanceof ORMError) ||
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
