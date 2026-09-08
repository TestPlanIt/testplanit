import { describe, expect, it } from "vitest";
import { stripEphemeralHash } from "./automatedTestName";

describe("stripEphemeralHash", () => {
  it("strips the TestNG runner identity-hash suffix", () => {
    expect(
      stripEphemeralHash(
        "testCompareCompanyReportObjectsNotEqual[0](org.testng.TestRunner@41738d)"
      )
    ).toBe("testCompareCompanyReportObjectsNotEqual[0]");
  });

  it("collapses names that differ only by the hash to one value", () => {
    const a = stripEphemeralHash(
      "testLoginSuccess[0](org.testng.TestRunner@41738d)"
    );
    const b = stripEphemeralHash(
      "testLoginSuccess[0](org.testng.TestRunner@59df7228)"
    );
    expect(a).toBe(b);
    expect(a).toBe("testLoginSuccess[0]");
  });

  it("preserves the [N] invocation index (distinct parameterized invocations)", () => {
    expect(stripEphemeralHash("testFoo[1](org.testng.TestRunner@abc123)")).toBe(
      "testFoo[1]"
    );
    expect(stripEphemeralHash("testFoo[2]")).toBe("testFoo[2]");
  });

  it("handles a bare @hash with no class name", () => {
    expect(stripEphemeralHash("testFoo(@deadbeef)")).toBe("testFoo");
  });

  it("is a no-op on clean names", () => {
    expect(stripEphemeralHash("Verify user can log in")).toBe(
      "Verify user can log in"
    );
    expect(stripEphemeralHash("com.allego.api.LoginTest")).toBe(
      "com.allego.api.LoginTest"
    );
  });

  it("does not strip an email-like @ (not a hex object hash)", () => {
    expect(stripEphemeralHash("Verify email user@example.com is valid")).toBe(
      "Verify email user@example.com is valid"
    );
  });

  it("treats null/undefined as empty string", () => {
    expect(stripEphemeralHash(null)).toBe("");
    expect(stripEphemeralHash(undefined)).toBe("");
  });
});
