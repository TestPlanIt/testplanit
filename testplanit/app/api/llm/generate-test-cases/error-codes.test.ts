import { describe, expect, it } from "vitest";
import { classifyLlmStreamError } from "./error-codes";

describe("classifyLlmStreamError", () => {
  it.each([
    ["overloaded", "Anthropic API is overloaded right now"],
    ["overloaded", "service is busy, retry later"],
    ["overloaded", "model is at capacity"],
    ["quota", "you have exceeded your quota"],
    ["quota", "rate limit reached for this hour"],
    ["timeout", "request timed out after 60s"],
    ["timeout", "504 Gateway Timeout"],
    ["unauthorized", "401 Unauthorized"],
    ["unauthorized", "invalid api key"],
    ["forbidden", "403 forbidden"],
    ["forbidden", "permission denied"],
    ["forbidden", "insufficient privileges"],
    ["network", "network error"],
    ["network", "fetch failed"],
    ["network", "ECONNRESET"],
    ["network", "EAI_AGAIN dns lookup"],
  ])("classifies %s for %j", (expected, input) => {
    expect(classifyLlmStreamError(input)).toBe(expected);
  });

  it("returns generic for unrecognized text", () => {
    expect(classifyLlmStreamError("totally weird new error")).toBe("generic");
  });

  it("does not classify 'unlimited' as quota", () => {
    // Sanity check on the limit-but-not-unlimited carve-out.
    expect(classifyLlmStreamError("plan is unlimited")).toBe("generic");
  });

  it("handles empty/undefined input safely", () => {
    expect(classifyLlmStreamError("")).toBe("generic");
    expect(classifyLlmStreamError(undefined as unknown as string)).toBe(
      "generic"
    );
  });
});
