import { describe, expect, it } from "vitest";

import {
  DEFAULT_TYPE_TOKENS,
  formatRecordKey,
  isValidProjectKey,
  isValidTypeToken,
  normalizeProjectKey,
  parseRecordId,
  parseRecordKey,
  recordTypeForToken,
  resolveTypeTokens,
  sanitizeKeyInput,
  suggestProjectKey,
} from "./recordKey";

describe("normalizeProjectKey", () => {
  it("trims and uppercases", () => {
    expect(normalizeProjectKey("  project ")).toBe("PROJECT");
  });
  it("returns null for empty/whitespace/null", () => {
    expect(normalizeProjectKey("")).toBeNull();
    expect(normalizeProjectKey("   ")).toBeNull();
    expect(normalizeProjectKey(null)).toBeNull();
    expect(normalizeProjectKey(undefined)).toBeNull();
  });
});

describe("isValidProjectKey", () => {
  it("accepts uppercase-letter codes (2-10, no digits)", () => {
    for (const k of ["PROJECT", "PAY", "RETAIL", "AB", "ABCDEFGHIJ"]) {
      expect(isValidProjectKey(k)).toBe(true);
    }
  });
  it("rejects digits, too short, lowercase, hyphens, too long", () => {
    for (const k of [
      "A",
      "PAY2",
      "1BANK",
      "bank",
      "BAN-K",
      "TOOLONGKEYS",
      "",
    ]) {
      expect(isValidProjectKey(k)).toBe(false);
    }
  });
});

describe("isValidTypeToken", () => {
  it("accepts 1-6 uppercase letters (no digits)", () => {
    for (const t of ["TC", "TR", "X", "ABCDEF"]) {
      expect(isValidTypeToken(t)).toBe(true);
    }
  });
  it("rejects digits, lowercase, hyphens, empty, too long", () => {
    for (const t of ["TC2", "ABC123", "tc", "T-C", "", "ABCDEFG"]) {
      expect(isValidTypeToken(t)).toBe(false);
    }
  });
});

describe("sanitizeKeyInput", () => {
  it("strips digits, symbols, and whitespace and uppercases", () => {
    expect(sanitizeKeyInput("pay2")).toBe("PAY");
    expect(sanitizeKeyInput("re-tail 1")).toBe("RETAIL");
    expect(sanitizeKeyInput("  bank٣  ")).toBe("BANK");
    expect(sanitizeKeyInput("123")).toBe("");
  });
});

describe("suggestProjectKey", () => {
  it("uses initials for multi-word names", () => {
    expect(suggestProjectKey("Mobile Banking App")).toBe("MBA");
    expect(suggestProjectKey("Conversation Intelligence")).toBe("CI");
    expect(suggestProjectKey("Admin Tool")).toBe("AT");
  });
  it("uses leading letters for single-word names", () => {
    expect(suggestProjectKey("Web")).toBe("WEB");
    expect(suggestProjectKey("Android")).toBe("ANDROID");
    expect(suggestProjectKey("iOS")).toBe("IOS");
  });
  it("ignores digits and punctuation in the name", () => {
    expect(suggestProjectKey("Payments 2.0")).toBe("PAYMENTS");
    expect(suggestProjectKey("v3-checkout-flow")).toBe("VCF");
  });
  it("clamps to 10 characters", () => {
    expect(suggestProjectKey("Supercalifragilistic")).toBe("SUPERCALIF");
  });
  it("returns empty when no valid code can be formed", () => {
    expect(suggestProjectKey("")).toBe("");
    expect(suggestProjectKey("123 456")).toBe("");
    expect(suggestProjectKey("A")).toBe("");
  });
});

describe("resolveTypeTokens", () => {
  it("returns defaults for null/garbage input", () => {
    expect(resolveTypeTokens(null)).toEqual(DEFAULT_TYPE_TOKENS);
    expect(resolveTypeTokens("nope")).toEqual(DEFAULT_TYPE_TOKENS);
    expect(resolveTypeTokens(42)).toEqual(DEFAULT_TYPE_TOKENS);
  });
  it("overlays valid overrides and normalizes case", () => {
    const resolved = resolveTypeTokens({ TEST_CASE: "case", TEST_RUN: "RUN" });
    expect(resolved.TEST_CASE).toBe("CASE");
    expect(resolved.TEST_RUN).toBe("RUN");
    // untouched types keep defaults
    expect(resolved.SESSION).toBe(DEFAULT_TYPE_TOKENS.SESSION);
  });
  it("ignores invalid overrides (hyphen / too long / non-string)", () => {
    const resolved = resolveTypeTokens({
      TEST_CASE: "T-C",
      TEST_RUN: "ABCDEFG",
      SESSION: 5,
    });
    expect(resolved.TEST_CASE).toBe(DEFAULT_TYPE_TOKENS.TEST_CASE);
    expect(resolved.TEST_RUN).toBe(DEFAULT_TYPE_TOKENS.TEST_RUN);
    expect(resolved.SESSION).toBe(DEFAULT_TYPE_TOKENS.SESSION);
  });
});

describe("formatRecordKey", () => {
  it("derives PREFIX-TOKEN-ID with defaults", () => {
    expect(
      formatRecordKey({ projectKey: "PROJECT", type: "TEST_CASE", id: 1234 })
    ).toBe("PROJECT-TC-1234");
    expect(
      formatRecordKey({ projectKey: "PAY", type: "TEST_RUN", id: 7 })
    ).toBe("PAY-TR-7");
  });
  it("normalizes the project key to uppercase", () => {
    expect(
      formatRecordKey({ projectKey: "project", type: "SESSION", id: 9 })
    ).toBe("PROJECT-SN-9");
  });
  it("returns null when the project has no key (additive fallback)", () => {
    expect(
      formatRecordKey({ projectKey: null, type: "TEST_CASE", id: 1 })
    ).toBeNull();
    expect(
      formatRecordKey({ projectKey: "  ", type: "TEST_CASE", id: 1 })
    ).toBeNull();
  });
  it("honors a custom token map", () => {
    expect(
      formatRecordKey({
        projectKey: "PROJECT",
        type: "TEST_CASE",
        id: 1234,
        tokens: { ...DEFAULT_TYPE_TOKENS, TEST_CASE: "CASE" },
      })
    ).toBe("PROJECT-CASE-1234");
  });
});

describe("parseRecordId (symmetric lookup primitive)", () => {
  it("returns the bare id unchanged", () => {
    expect(parseRecordId("1234")).toBe(1234);
    expect(parseRecordId(" 1234 ")).toBe(1234);
  });
  it("strips a project+token prefix", () => {
    expect(parseRecordId("PROJECT-TC-1234")).toBe(1234);
    expect(parseRecordId("RETAIL-TR-88")).toBe(88);
  });
  it("strips a lone token prefix", () => {
    expect(parseRecordId("TC-1234")).toBe(1234);
  });
  it("is case-insensitive on the prefix", () => {
    expect(parseRecordId("project-tc-1234")).toBe(1234);
  });
  it("returns null for non-id input (mirrors old isNaN guards)", () => {
    for (const bad of ["", "   ", "abc", "TC-", "PROJECT-TC-", "12.5", "-5"]) {
      expect(parseRecordId(bad)).toBeNull();
    }
  });
  it("returns null for null/undefined and zero/negative", () => {
    expect(parseRecordId(null)).toBeNull();
    expect(parseRecordId(undefined)).toBeNull();
    expect(parseRecordId("0")).toBeNull();
  });
});

describe("parseRecordKey", () => {
  it("parses bare id", () => {
    expect(parseRecordKey("1234")).toEqual({
      id: 1234,
      token: null,
      projectKey: null,
    });
  });
  it("parses full prefix", () => {
    expect(parseRecordKey("PROJECT-TC-1234")).toEqual({
      id: 1234,
      token: "TC",
      projectKey: "PROJECT",
    });
  });
  it("classifies a lone head segment as token when it is a known token", () => {
    expect(parseRecordKey("TC-1234", ["TC", "TR"])).toEqual({
      id: 1234,
      token: "TC",
      projectKey: null,
    });
  });
  it("classifies a lone head segment as project key when not a known token", () => {
    expect(parseRecordKey("PROJECT-1234", ["TC", "TR"])).toEqual({
      id: 1234,
      token: null,
      projectKey: "PROJECT",
    });
  });
  it("uppercases parts", () => {
    expect(parseRecordKey("project-tc-1234")).toEqual({
      id: 1234,
      token: "TC",
      projectKey: "PROJECT",
    });
  });
  it("returns null without a trailing id", () => {
    expect(parseRecordKey("PROJECT-TC-")).toBeNull();
    expect(parseRecordKey("abc")).toBeNull();
    expect(parseRecordKey("")).toBeNull();
  });
});

describe("recordTypeForToken", () => {
  it("reverses default tokens (case-insensitive)", () => {
    expect(recordTypeForToken("TC")).toBe("TEST_CASE");
    expect(recordTypeForToken("tr")).toBe("TEST_RUN");
    expect(recordTypeForToken("SN")).toBe("SESSION");
    expect(recordTypeForToken("MS")).toBe("MILESTONE");
  });
  it("reverses a custom token map", () => {
    expect(
      recordTypeForToken("CASE", { ...DEFAULT_TYPE_TOKENS, TEST_CASE: "CASE" })
    ).toBe("TEST_CASE");
  });
  it("returns null for unknown/empty token", () => {
    expect(recordTypeForToken("ZZ")).toBeNull();
    expect(recordTypeForToken(null)).toBeNull();
    expect(recordTypeForToken("")).toBeNull();
  });
});
