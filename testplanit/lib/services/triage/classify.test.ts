import { describe, expect, it } from "vitest";
import {
  AFFECTED_CASES_MAX,
  buildClassificationVariables,
  fillPrompt,
  normalizeClassification,
  parseClassification,
  STACK_TRACE_MAX_CHARS,
} from "./classify";

describe("parseClassification", () => {
  it("reads a plain JSON answer", () => {
    const parsed = parseClassification(
      '{"classification":"FLAKY","confidence":0.8,"rationale":"flips","suggestedIssueTitle":"Login flakes","suggestedNextStep":"add wait"}'
    );
    expect(parsed).toEqual({
      classification: "FLAKY",
      confidence: 0.8,
      rationale: "flips",
      suggestedIssueTitle: "Login flakes",
      suggestedNextStep: "add wait",
    });
  });

  it("tolerates fences, aliases and missing optional fields", () => {
    const parsed = parseClassification(
      'Sure:\n```json\n{"classification":"test bug","confidence":1.4,"rationale":"stale selector"}\n```'
    );
    expect(parsed?.classification).toBe("TEST_BUG");
    expect(parsed?.confidence).toBe(1);
    expect(parsed?.suggestedIssueTitle).toBeNull();
  });

  it("returns null for unreadable or unknown answers", () => {
    expect(parseClassification("no idea")).toBeNull();
    expect(
      parseClassification('{"classification":"UNKNOWN","confidence":0.5}')
    ).toBeNull();
    expect(parseClassification('{"confidence":0.5}')).toBeNull();
  });
});

describe("normalizeClassification", () => {
  it("maps synonyms onto the four classes", () => {
    expect(normalizeClassification("Product Bug")).toBe("PRODUCT_BUG");
    expect(normalizeClassification("infra")).toBe("ENVIRONMENT");
    expect(normalizeClassification("intermittent")).toBe("FLAKY");
    expect(normalizeClassification("automation-bug")).toBe("TEST_BUG");
    expect(normalizeClassification("other")).toBeNull();
  });
});

describe("fillPrompt", () => {
  it("substitutes known variables and leaves unknown ones", () => {
    expect(fillPrompt("a {{X}} b {{ Y }} c {{Z}}", { X: "1", Y: "2" })).toBe(
      "a 1 b 2 c {{Z}}"
    );
  });
});

describe("buildClassificationVariables", () => {
  const base = {
    exceptionType: "TimeoutError",
    message: "locator.click: Timeout 30000ms exceeded.",
    stackTrace: "x".repeat(STACK_TRACE_MAX_CHARS + 50),
    systemErr: null,
    occurrenceCount: 12,
    caseCount: 3,
    runCount: 4,
    firstSeenAt: new Date("2026-10-01T00:00:00Z"),
    lastSeenAt: new Date("2026-10-18T00:00:00Z"),
    flakyCandidate: true,
    cases: [
      { name: "Save profile", history: [false, true, false] },
      { name: "Open settings", history: [] },
    ],
  };

  it("renders counts, history and truncation markers", () => {
    const vars = buildClassificationVariables(base);
    expect(vars.EXCEPTION_TYPE).toBe("TimeoutError");
    expect(vars.OCCURRENCE_COUNT).toBe("12");
    expect(vars.FLAKY_CANDIDATE).toBe("yes");
    expect(vars.SYSTEM_ERR).toBe("(none)");
    expect(vars.STACK_TRACE.endsWith("…[truncated]")).toBe(true);
    expect(vars.STACK_TRACE.length).toBeLessThan(STACK_TRACE_MAX_CHARS + 20);
    expect(vars.AFFECTED_CASES).toBe(
      "- Save profile — F P F, 2 flip(s)\n- Open settings — (no history)"
    );
  });

  it("caps the affected case list", () => {
    const cases = Array.from({ length: AFFECTED_CASES_MAX + 4 }, (_, i) => ({
      name: `Case ${i}`,
      history: [],
    }));
    const vars = buildClassificationVariables({ ...base, cases });
    expect(vars.AFFECTED_CASES.split("\n")).toHaveLength(
      AFFECTED_CASES_MAX + 1
    );
    expect(vars.AFFECTED_CASES.endsWith("- …and 4 more")).toBe(true);
  });
});
