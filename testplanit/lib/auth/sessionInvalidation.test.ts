import { describe, expect, it } from "vitest";
import {
  isSessionEnded,
  passwordChangedSinceIssue,
} from "./sessionInvalidation";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-06-01T00:00:00.000Z";

describe("passwordChangedSinceIssue", () => {
  it("is false when the DB has no timestamp", () => {
    expect(passwordChangedSinceIssue(null, null)).toBe(false);
    expect(passwordChangedSinceIssue(undefined, T1)).toBe(false);
  });

  it("is true when the token has no timestamp but the DB does (first-ever change)", () => {
    expect(passwordChangedSinceIssue(new Date(T2), null)).toBe(true);
    expect(passwordChangedSinceIssue(T2, undefined)).toBe(true);
  });

  it("compares timestamps when both are present", () => {
    expect(passwordChangedSinceIssue(new Date(T2), T1)).toBe(true);
    expect(passwordChangedSinceIssue(T2, T2)).toBe(false);
    expect(passwordChangedSinceIssue(new Date(T1), T2)).toBe(false);
  });
});

describe("isSessionEnded", () => {
  it("ends the session of a deactivated user regardless of auth method", () => {
    expect(isSessionEnded({}, { authMethod: "SSO", isActive: false })).toBe(
      true
    );
  });

  it("ends a credential user's session when the password changed since issue", () => {
    expect(
      isSessionEnded(
        { passwordChangedAt: null },
        { authMethod: "INTERNAL", passwordChangedAt: T2, isActive: true }
      )
    ).toBe(true);
    expect(
      isSessionEnded(
        { passwordChangedAt: T1 },
        { authMethod: "BOTH", passwordChangedAt: T2, isActive: true }
      )
    ).toBe(true);
  });

  it("ignores password timestamps for SSO-only users", () => {
    expect(
      isSessionEnded(
        { passwordChangedAt: null },
        { authMethod: "SSO", passwordChangedAt: T2, isActive: true }
      )
    ).toBe(false);
  });

  it("keeps the session when the token is current", () => {
    expect(
      isSessionEnded(
        { passwordChangedAt: T2 },
        { authMethod: "INTERNAL", passwordChangedAt: T2, isActive: true }
      )
    ).toBe(false);
  });

  it("never ends a session on an older cache entry missing the new fields", () => {
    expect(
      isSessionEnded({ passwordChangedAt: null }, { authMethod: "INTERNAL" })
    ).toBe(false);
  });
});
