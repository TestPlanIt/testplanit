import { describe, expect, it } from "vitest";

import type {
  AutomationCandidatesCase,
  AutomationCandidatesContext,
} from "./automationCandidatesContext";
import {
  buildHeuristicRanking,
  formatRelativeAge,
} from "./automationCandidatesHeuristic";

function caseFixture(
  overrides: Partial<AutomationCandidatesCase> = {}
): AutomationCandidatesCase {
  return {
    id: 1,
    name: "Case",
    className: null,
    stepCount: 0,
    executionCount: 0,
    estimateSeconds: null,
    flakinessScore: null,
    createdAtIso: "2026-01-01T00:00:00.000Z",
    customFields: {},
    linkedIssues: [],
    ...overrides,
  };
}

function ctxFor(
  strategy: AutomationCandidatesContext["selectionStrategy"],
  cases: AutomationCandidatesCase[]
): AutomationCandidatesContext {
  return {
    projectId: 7,
    projectName: "Demo",
    cases,
    totalManualCases: cases.length,
    truncated: false,
    selectionStrategy: strategy,
  };
}

// Every test runs against en-US so assertions can read like English copy
// while still exercising the real `getServerTranslation` lookup path.
const LOCALE = "en_US";

describe("buildHeuristicRanking — most_executed", () => {
  it("emits rank 1..N matching the input order (materializer already sorted)", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [
        caseFixture({ id: 1, executionCount: 50 }),
        caseFixture({ id: 2, executionCount: 25 }),
        caseFixture({ id: 3, executionCount: 5 }),
      ]),
      LOCALE
    );
    expect(out.candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(out.candidates.map((c) => c.caseId)).toEqual([1, 2, 3]);
  });

  it("scores 100 to the most-executed case and proportional below", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [
        caseFixture({ id: 1, executionCount: 100 }),
        caseFixture({ id: 2, executionCount: 50 }),
        caseFixture({ id: 3, executionCount: 0 }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(100);
    expect(out.candidates[1]!.score).toBe(50);
    expect(out.candidates[2]!.score).toBe(0);
  });

  it("cites the executionCount verbatim in the rationale", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [caseFixture({ id: 1, executionCount: 47 })]),
      LOCALE
    );
    expect(out.candidates[0]!.rationale).toMatch(/Executed 47 times/);
  });

  it("singular 'time' for executionCount === 1", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [caseFixture({ id: 1, executionCount: 1 })]),
      LOCALE
    );
    expect(out.candidates[0]!.rationale).toMatch(/Executed 1 time\b/);
  });

  it("scores 50 (neutral) when no case has ever been executed", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [caseFixture({ id: 1, executionCount: 0 })]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(50);
  });
});

describe("buildHeuristicRanking — flakiest_first", () => {
  it("scores by flakiness * 100; null scores 0 with an explanatory rationale", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("flakiest_first", [
        caseFixture({ id: 1, flakinessScore: 0.9 }),
        caseFixture({ id: 2, flakinessScore: 0 }),
        caseFixture({ id: 3, flakinessScore: null }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(90);
    expect(out.candidates[1]!.score).toBe(0);
    expect(out.candidates[2]!.score).toBe(0);
    expect(out.candidates[2]!.rationale).toMatch(/no varied outcomes yet/i);
  });
});

describe("buildHeuristicRanking — longest_first", () => {
  it("scores proportionally to max forecast/estimate", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("longest_first", [
        caseFixture({ id: 1, estimateSeconds: 600 }),
        caseFixture({ id: 2, estimateSeconds: 300 }),
        caseFixture({ id: 3, estimateSeconds: null }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(100);
    expect(out.candidates[1]!.score).toBe(50);
    expect(out.candidates[2]!.score).toBe(0);
    expect(out.candidates[0]!.rationale).toMatch(/forecast 10m/);
  });
});

describe("buildHeuristicRanking — date strategies", () => {
  it("oldest_first scores by linear position (top 100, bottom ~10)", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("oldest_first", [
        caseFixture({ id: 1, createdAtIso: "2024-01-01T00:00:00Z" }),
        caseFixture({ id: 2, createdAtIso: "2025-01-01T00:00:00Z" }),
        caseFixture({ id: 3, createdAtIso: "2026-01-01T00:00:00Z" }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(100);
    expect(out.candidates[2]!.score).toBe(10);
  });

  it("newest_first uses the same position scoring (direction is the strategy's job)", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("newest_first", [
        caseFixture({ id: 1, createdAtIso: "2026-01-01T00:00:00Z" }),
        caseFixture({ id: 2, createdAtIso: "2024-01-01T00:00:00Z" }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(100);
    expect(out.candidates[1]!.score).toBe(10);
  });

  it("single-case list scores 100 (no relative position to compute)", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("oldest_first", [
        caseFixture({ id: 1, createdAtIso: "2024-01-01T00:00:00Z" }),
      ]),
      LOCALE
    );
    expect(out.candidates[0]!.score).toBe(100);
  });
});

describe("buildHeuristicRanking — random", () => {
  it("scores every case at the same neutral midpoint (no metric to rank against)", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("random", [
        caseFixture({ id: 1 }),
        caseFixture({ id: 2 }),
        caseFixture({ id: 3 }),
      ]),
      LOCALE
    );
    expect(out.candidates.every((c) => c.score === 50)).toBe(true);
  });
});

describe("buildHeuristicRanking — summary", () => {
  it("always tells the user this is heuristic and what configures the LLM path", async () => {
    const out = await buildHeuristicRanking(
      ctxFor("most_executed", [caseFixture({ id: 1, executionCount: 1 })]),
      LOCALE
    );
    expect(out.summary).toMatch(/No LLM integration is configured/);
    expect(out.summary).toMatch(/Admin → AI Models/);
  });

  it("includes the ranked-vs-total count so viewers see the truncation context", async () => {
    const ctx = ctxFor("most_executed", [caseFixture({ id: 1 })]);
    ctx.totalManualCases = 200;
    const out = await buildHeuristicRanking(ctx, LOCALE);
    expect(out.summary).toMatch(/1 of 200 eligible manual cases ranked/);
  });
});

describe("formatRelativeAge", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("today (0 days)", async () => {
    expect(
      await formatRelativeAge(
        new Date("2026-06-01T01:00:00Z").toISOString(),
        LOCALE,
        now
      )
    ).toBe("today");
  });

  it("single day", async () => {
    expect(await formatRelativeAge("2026-05-31T00:00:00Z", LOCALE, now)).toBe(
      "1 day ago"
    );
  });

  it("multiple days within a month", async () => {
    expect(await formatRelativeAge("2026-05-20T00:00:00Z", LOCALE, now)).toBe(
      "12 days ago"
    );
  });

  it("rounds into months past 30 days", async () => {
    expect(await formatRelativeAge("2026-03-01T00:00:00Z", LOCALE, now)).toBe(
      "3 months ago"
    );
  });

  it("rounds into years past 24 months", async () => {
    expect(await formatRelativeAge("2023-06-01T00:00:00Z", LOCALE, now)).toBe(
      "3 years ago"
    );
  });
});
