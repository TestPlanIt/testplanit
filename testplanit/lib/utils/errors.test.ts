import { describe, it, expect } from "vitest";
import { ApplicationArea } from "~/zenstack/models";
import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import {
  isUniqueConstraintError,
  isNotFoundError,
  isForeignKeyError,
  ReviewGateError,
  AlreadyPendingError,
  IneligibleReviewerError,
  IneligibleAssigneeError,
  isReviewGateError,
  isAlreadyPendingError,
  isIneligibleReviewerError,
  isIneligibleAssigneeError,
} from "./errors";

// v3 surfaces database failures as an ORMError carrying the Postgres SQLSTATE in
// `dbErrorCode` (plus the SQLSTATE text the helpers also match on); a missing
// record is the NOT_FOUND reason. These build the real v3 shapes.
function makeDbError(sqlstate: string, message: string): ORMError {
  const err = new ORMError(ORMErrorReason.DB_QUERY_ERROR, message);
  (err as { dbErrorCode?: unknown }).dbErrorCode = sqlstate;
  return err;
}
const uniqueViolation = (constraint = "some_unique_index") =>
  makeDbError(
    "23505",
    `duplicate key value violates unique constraint "${constraint}"`
  );
const foreignKeyViolation = () =>
  makeDbError(
    "23503",
    'insert or update on table "x" violates foreign key constraint "x_fk"'
  );
const notFoundError = () =>
  new ORMError(ORMErrorReason.NOT_FOUND, "record not found");

describe("errors helpers", () => {
  it("detects unique-constraint (SQLSTATE 23505) errors", () => {
    expect(isUniqueConstraintError(uniqueViolation())).toBe(true);
    expect(isNotFoundError(uniqueViolation())).toBe(false);
    expect(isForeignKeyError(uniqueViolation())).toBe(false);
  });

  it("detects not-found errors", () => {
    expect(isNotFoundError(notFoundError())).toBe(true);
    expect(isUniqueConstraintError(notFoundError())).toBe(false);
    expect(isForeignKeyError(notFoundError())).toBe(false);
  });

  it("detects foreign-key (SQLSTATE 23503) errors", () => {
    expect(isForeignKeyError(foreignKeyViolation())).toBe(true);
    expect(isUniqueConstraintError(foreignKeyViolation())).toBe(false);
    expect(isNotFoundError(foreignKeyViolation())).toBe(false);
  });

  it("rejects unrelated Error subclasses", () => {
    expect(isUniqueConstraintError(new Error("plain"))).toBe(false);
    expect(isUniqueConstraintError(new TypeError("type"))).toBe(false);
    expect(isNotFoundError(new RangeError("range"))).toBe(false);
    expect(isForeignKeyError(new Error("plain"))).toBe(false);
  });

  it("rejects non-Error values without throwing", () => {
    for (const value of [null, undefined, "string", 42, {}, []]) {
      expect(isUniqueConstraintError(value)).toBe(false);
      expect(isNotFoundError(value)).toBe(false);
      expect(isForeignKeyError(value)).toBe(false);
    }
  });
});

describe("review gate error helpers", () => {
  it("ReviewGateError carries entityType, entityId, toStateId, code='REVIEW_REQUIRED'", () => {
    const err = new ReviewGateError("REVIEW_REQUIRED", "CASE", 1, 42);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("REVIEW_REQUIRED");
    expect(err.entityType).toBe("CASE");
    expect(err.entityId).toBe(1);
    expect(err.toStateId).toBe(42);
    expect(err.name).toBe("ReviewGateError");
  });

  it("AlreadyPendingError carries entityType, entityId, existingRequestId, code='PENDING_REVIEW_EXISTS'", () => {
    const err = new AlreadyPendingError("RUN", 5, "req-abc");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("PENDING_REVIEW_EXISTS");
    expect(err.entityType).toBe("RUN");
    expect(err.entityId).toBe(5);
    expect(err.existingRequestId).toBe("req-abc");
    expect(err.name).toBe("AlreadyPendingError");
  });

  it("isReviewGateError detects ReviewGateError", () => {
    const err = new ReviewGateError("REVIEW_REQUIRED", "CASE", 1, 42);
    expect(isReviewGateError(err)).toBe(true);
  });

  it("isReviewGateError rejects AlreadyPendingError", () => {
    const err = new AlreadyPendingError("CASE", 1, "req-1");
    expect(isReviewGateError(err)).toBe(false);
  });

  it("isReviewGateError rejects non-Error values without throwing", () => {
    for (const value of [null, undefined, 42, "str", {}]) {
      expect(isReviewGateError(value)).toBe(false);
    }
  });

  it("isAlreadyPendingError detects AlreadyPendingError", () => {
    const err = new AlreadyPendingError("RUN", 5, "req-2");
    expect(isAlreadyPendingError(err)).toBe(true);
  });

  it("isAlreadyPendingError detects the pending-review unique index by name", () => {
    const err = makeDbError(
      "23505",
      'duplicate key value violates unique constraint "review_request_one_pending_per_entity"'
    );
    expect(isAlreadyPendingError(err)).toBe(true);
  });

  it("isAlreadyPendingError detects the pending-review violation by column tuple", () => {
    // The partial unique index on ReviewRequest is (entityType, entityId); v3
    // surfaces the raw Postgres SQLSTATE text, which names those columns even
    // when it doesn't quote the index name.
    const err = makeDbError(
      "23505",
      "duplicate key value violates unique constraint. Key (entityType, entityId)=(CASE, 1) already exists"
    );
    expect(isAlreadyPendingError(err)).toBe(true);
  });

  it("isAlreadyPendingError rejects a different unique violation", () => {
    const err = makeDbError(
      "23505",
      'duplicate key value violates unique constraint "some_other_constraint"'
    );
    expect(isAlreadyPendingError(err)).toBe(false);
  });

  it("isAlreadyPendingError rejects a unique violation on unrelated columns", () => {
    const err = makeDbError(
      "23505",
      'duplicate key value violates unique constraint "users_email_key" Key (email)=(a@b.com) already exists'
    );
    expect(isAlreadyPendingError(err)).toBe(false);
  });

  it("isAlreadyPendingError rejects non-Error values without throwing", () => {
    for (const value of [null, undefined, 42, "str", {}]) {
      expect(isAlreadyPendingError(value)).toBe(false);
    }
  });
});

describe("ineligible reviewer error helpers", () => {
  it("IneligibleReviewerError carries userId, reviewRequestId, code='INELIGIBLE_REVIEWER'", () => {
    const err = new IneligibleReviewerError("user-123", "req-abc");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("INELIGIBLE_REVIEWER");
    expect(err.userId).toBe("user-123");
    expect(err.reviewRequestId).toBe("req-abc");
    expect(err.name).toBe("IneligibleReviewerError");
    // Message references both fields for log diagnosability
    expect(err.message).toContain("user-123");
    expect(err.message).toContain("req-abc");
  });

  it("isIneligibleReviewerError detects IneligibleReviewerError instances", () => {
    const err = new IneligibleReviewerError("user-1", "req-1");
    expect(isIneligibleReviewerError(err)).toBe(true);
  });

  it("isIneligibleReviewerError rejects sibling typed errors", () => {
    expect(
      isIneligibleReviewerError(
        new ReviewGateError("REVIEW_REQUIRED", "CASE", 1, 2)
      )
    ).toBe(false);
    expect(
      isIneligibleReviewerError(new AlreadyPendingError("CASE", 1, "req-1"))
    ).toBe(false);
  });

  it("isIneligibleReviewerError rejects non-Error values without throwing", () => {
    for (const value of [null, undefined, 42, "str", {}, [], new Error("e")]) {
      expect(isIneligibleReviewerError(value)).toBe(false);
    }
  });
});

describe("IneligibleAssigneeError", () => {
  it("carries assigneeRef, area, code='INELIGIBLE_ASSIGNEE', and English message", () => {
    const err = new IneligibleAssigneeError(
      "user-abc",
      ApplicationArea.TestCaseRepository
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("INELIGIBLE_ASSIGNEE");
    expect(err.assigneeRef).toBe("user-abc");
    expect(err.area).toBe(ApplicationArea.TestCaseRepository);
    expect(err.name).toBe("IneligibleAssigneeError");
    expect(err.message).toContain("user-abc");
    expect(err.message).toContain("TestCaseRepository");
  });

  it("isIneligibleAssigneeError detects IneligibleAssigneeError instances", () => {
    const err = new IneligibleAssigneeError("42", ApplicationArea.TestRuns);
    expect(isIneligibleAssigneeError(err)).toBe(true);
  });

  it("isIneligibleAssigneeError rejects a plain Error", () => {
    expect(isIneligibleAssigneeError(new Error("plain"))).toBe(false);
  });

  it("isIneligibleAssigneeError rejects IneligibleReviewerError (different discriminant)", () => {
    expect(
      isIneligibleAssigneeError(new IneligibleReviewerError("u", "r"))
    ).toBe(false);
  });
});
