import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  isUniqueConstraintError,
  isNotFoundError,
  isForeignKeyError,
  ReviewGateError,
  AlreadyPendingError,
  IneligibleReviewerError,
  isReviewGateError,
  isAlreadyPendingError,
  isIneligibleReviewerError,
} from "./errors";

function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  // Constructor signature in @prisma/client v5+:
  // (message: string, { code, clientVersion, meta? })
  return new Prisma.PrismaClientKnownRequestError(`test ${code}`, {
    code,
    clientVersion: "test",
  });
}

describe("errors helpers", () => {
  it("detects P2002 unique-constraint errors", () => {
    expect(isUniqueConstraintError(makePrismaError("P2002"))).toBe(true);
    expect(isNotFoundError(makePrismaError("P2002"))).toBe(false);
    expect(isForeignKeyError(makePrismaError("P2002"))).toBe(false);
  });

  it("detects P2025 not-found errors", () => {
    expect(isNotFoundError(makePrismaError("P2025"))).toBe(true);
    expect(isUniqueConstraintError(makePrismaError("P2025"))).toBe(false);
    expect(isForeignKeyError(makePrismaError("P2025"))).toBe(false);
  });

  it("detects P2003 foreign-key errors", () => {
    expect(isForeignKeyError(makePrismaError("P2003"))).toBe(true);
    expect(isUniqueConstraintError(makePrismaError("P2003"))).toBe(false);
    expect(isNotFoundError(makePrismaError("P2003"))).toBe(false);
  });

  it("rejects non-Prisma Error subclasses", () => {
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

  it("isAlreadyPendingError detects P2002 with correct index target", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "review_request_one_pending_per_entity" },
    });
    expect(isAlreadyPendingError(err)).toBe(true);
  });

  it("isAlreadyPendingError detects P2002 with array target (Prisma 6 shape)", () => {
    // Prisma 6.19+ reports `meta.target` as a string[] of field names instead
    // of the bare index name. This is the shape returned in the wild by the
    // partial unique index on ReviewRequest — verified by the live-DB test
    // at lib/services/schemaValidation.test.ts.
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["entityType", "entityId"] },
    });
    expect(isAlreadyPendingError(err)).toBe(true);
  });

  it("isAlreadyPendingError rejects P2002 with wrong index target", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "some_other_constraint" },
    });
    expect(isAlreadyPendingError(err)).toBe(false);
  });

  it("isAlreadyPendingError rejects P2002 with array target on unrelated fields", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });
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
