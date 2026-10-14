import { describe, expect, it } from "vitest";
import { needsEmailVerification } from "./emailVerification";

describe("needsEmailVerification", () => {
  it("holds for a password account with an unconfirmed address", () => {
    expect(
      needsEmailVerification({ emailVerified: null, authMethod: "INTERNAL" })
    ).toBe(true);
    expect(
      needsEmailVerification({ emailVerified: null, authMethod: null })
    ).toBe(true);
  });

  it("does not hold once the address is confirmed, or for SSO and SCIM accounts", () => {
    expect(
      needsEmailVerification({
        emailVerified: "2026-01-01T00:00:00.000Z",
        authMethod: "INTERNAL",
      })
    ).toBe(false);
    for (const authMethod of ["SSO", "BOTH", "SCIM"]) {
      expect(needsEmailVerification({ emailVerified: null, authMethod })).toBe(
        false
      );
    }
  });
});
