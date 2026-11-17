import { describe, expect, it } from "vitest";
import {
  AFFECTED_CASES_MAX,
  buildClassificationVariables,
  fillPrompt,
  formatCatalogue,
  normalizeClassification,
  parseClassification,
  STACK_TRACE_MAX_CHARS,
  type ClassificationCatalogueEntry,
} from "./classify";

const catalogue: ClassificationCatalogueEntry[] = [
  { id: 1, name: "Product bug", key: "PRODUCT_BUG", description: "app" },
  { id: 2, name: "Test bug", key: "TEST_BUG", description: "test" },
  { id: 3, name: "Environment", key: "ENVIRONMENT", description: null },
  { id: 4, name: "Flaky", key: "FLAKY", description: "flips" },
  { id: 5, name: "Data setup", key: null, description: "fixtures" },
];

describe("parseClassification", () => {
  it("reads a plain JSON answer", () => {
    const parsed = parseClassification(
      '{"classification":"Flaky","confidence":0.8,"rationale":"flips","suggestedIssueTitle":"Login flakes","suggestedNextStep":"add wait"}',
      catalogue
    );
    expect(parsed).toEqual({
      classificationId: 4,
      confidence: 0.8,
      rationale: "flips",
      suggestedIssueTitle: "Login flakes",
      suggestedNextStep: "add wait",
    });
  });

  it("tolerates fences, aliases and missing optional fields", () => {
    const parsed = parseClassification(
      'Sure:\n```json\n{"classification":"test bug","confidence":1.4,"rationale":"stale selector"}\n```',
      catalogue
    );
    expect(parsed?.classificationId).toBe(2);
    expect(parsed?.confidence).toBe(1);
    expect(parsed?.suggestedIssueTitle).toBeNull();
  });

  it("returns null for unreadable or unknown answers", () => {
    expect(parseClassification("no idea", catalogue)).toBeNull();
    expect(
      parseClassification(
        '{"classification":"UNKNOWN","confidence":0.5}',
        catalogue
      )
    ).toBeNull();
    expect(parseClassification('{"confidence":0.5}', catalogue)).toBeNull();
  });
});

describe("normalizeClassification", () => {
  it("matches catalogue names ignoring case, spacing and punctuation", () => {
    expect(normalizeClassification("product-bug", catalogue)?.id).toBe(1);
    expect(normalizeClassification("  DATA SETUP ", catalogue)?.id).toBe(5);
    expect(normalizeClassification("Data_setup", catalogue)?.id).toBe(5);
  });

  it("falls back to seeded keys and their synonyms", () => {
    expect(normalizeClassification("PRODUCT_BUG", catalogue)?.id).toBe(1);
    expect(normalizeClassification("infra", catalogue)?.id).toBe(3);
    expect(normalizeClassification("intermittent", catalogue)?.id).toBe(4);
    expect(normalizeClassification("automation-bug", catalogue)?.id).toBe(2);
    expect(normalizeClassification("other", catalogue)).toBeNull();
  });

  it("ignores synonyms for entries the catalogue no longer has", () => {
    const withoutFlaky = catalogue.filter((c) => c.key !== "FLAKY");
    expect(normalizeClassification("intermittent", withoutFlaky)).toBeNull();
  });
});

describe("formatCatalogue", () => {
  it("lists one entry per line with a placeholder for a missing description", () => {
    expect(formatCatalogue(catalogue.slice(2, 4))).toBe(
      "- Environment: (no description)\n- Flaky: flips"
    );
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
    catalogue,
  };

  it("renders counts, history and truncation markers", () => {
    const vars = buildClassificationVariables(base);
    expect(vars.CLASSIFICATIONS.split("\n")).toHaveLength(catalogue.length);
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
