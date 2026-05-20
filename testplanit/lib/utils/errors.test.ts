import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  isUniqueConstraintError,
  isNotFoundError,
  isForeignKeyError,
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
