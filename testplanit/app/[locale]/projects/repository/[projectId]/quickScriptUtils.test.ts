import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./quickScriptUtils";

describe("sanitizeFilename", () => {
  it("should remove special characters", () => {
    expect(sanitizeFilename("Test@#$Case!")).toBe("testcase");
  });

  it("should replace spaces with hyphens", () => {
    expect(sanitizeFilename("Test Case Name")).toBe("test-case-name");
  });

  it("should convert to lowercase", () => {
    expect(sanitizeFilename("TestCase")).toBe("testcase");
  });

  it("should preserve underscores and hyphens", () => {
    expect(sanitizeFilename("Test_Case-123")).toBe("test_case-123");
  });

  it("should handle empty string", () => {
    expect(sanitizeFilename("")).toBe("");
  });

  it("should collapse multiple spaces into single hyphen", () => {
    expect(sanitizeFilename("Test   Case")).toBe("test-case");
  });

  it("should handle a realistic test case name", () => {
    expect(
      sanitizeFilename("User Login with Valid Credentials")
    ).toBe("user-login-with-valid-credentials");
  });

  it("should strip parentheses and dots", () => {
    expect(sanitizeFilename("Playwright (TypeScript).spec")).toBe(
      "playwright-typescriptspec"
    );
  });
});
