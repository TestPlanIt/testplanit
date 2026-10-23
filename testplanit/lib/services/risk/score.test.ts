import { describe, expect, it } from "vitest";
import { computeRiskScore, STALENESS_HORIZON_DAYS } from "./score";
import type { CaseRiskSignals, RiskWeights } from "./types";
import { DEFAULT_RISK_WEIGHTS } from "./weights";

const NOW = new Date("2026-10-23T12:00:00.000Z");

function daysBefore(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function signals(overrides: Partial<CaseRiskSignals> = {}): CaseRiskSignals {
  return {
    caseId: 1,
    verdicts: [],
    lastExecutedAt: daysBefore(0),
    createdAt: daysBefore(30),
    requirementPriorities: [],
    suspectLinkCount: 0,
    defectPriorities: [],
    casePriority: null,
    quarantined: false,
    ...overrides,
  };
}

/** Weights that isolate one component at full scale. */
function only(key: keyof RiskWeights): RiskWeights {
  return {
    failureHistory: 0,
    flakiness: 0,
    staleness: 0,
    criticality: 0,
    defects: 0,
    [key]: 100,
  };
}

describe("computeRiskScore", () => {
  it("scores a fresh, healthy, unlinked case as zero", () => {
    const { score, reasons } = computeRiskScore(
      signals(),
      DEFAULT_RISK_WEIGHTS,
      NOW
    );
    expect(score).toBe(0);
    expect(reasons.version).toBe(1);
    expect(reasons.components).toHaveLength(5);
    expect(reasons.components.map((c) => c.key)).toEqual([
      "failureHistory",
      "flakiness",
      "staleness",
      "criticality",
      "defects",
    ]);
  });

  it("is deterministic", () => {
    const input = signals({
      verdicts: [false, true, false],
      requirementPriorities: ["high"],
      defectPriorities: ["low"],
    });
    const first = computeRiskScore(input, DEFAULT_RISK_WEIGHTS, NOW);
    const second = computeRiskScore(input, DEFAULT_RISK_WEIGHTS, NOW);
    expect(second).toEqual(first);
  });

  describe("failure history", () => {
    it("saturates on an all-failing history", () => {
      const { score } = computeRiskScore(
        signals({ verdicts: [false, false, false] }),
        only("failureHistory"),
        NOW
      );
      expect(score).toBe(100);
    });

    it("weighs recent verdicts heavier than old ones", () => {
      const recentFail = computeRiskScore(
        signals({ verdicts: [false, true, true] }),
        only("failureHistory"),
        NOW
      );
      const oldFail = computeRiskScore(
        signals({ verdicts: [true, true, false] }),
        only("failureHistory"),
        NOW
      );
      expect(recentFail.score).toBeGreaterThan(oldFail.score);
    });

    it("yields the documented value for one fail over one pass", () => {
      // failed = 1, total = 1 + 0.75 → 0.5714…
      const { score } = computeRiskScore(
        signals({ verdicts: [false, true] }),
        only("failureHistory"),
        NOW
      );
      expect(score).toBe(57);
    });

    it("carries no signal without verdicts", () => {
      const { score, reasons } = computeRiskScore(
        signals({ verdicts: [] }),
        only("failureHistory"),
        NOW
      );
      expect(score).toBe(0);
      expect(reasons.facts.verdictsSampled).toBe(0);
    });
  });

  describe("flakiness", () => {
    it("needs at least three samples", () => {
      const { score, reasons } = computeRiskScore(
        signals({ verdicts: [false, true] }),
        only("flakiness"),
        NOW
      );
      expect(score).toBe(0);
      expect(reasons.facts.flips).toBe(1);
    });

    it("saturates on a fully alternating history", () => {
      const { score, reasons } = computeRiskScore(
        signals({ verdicts: [true, false, true, false] }),
        only("flakiness"),
        NOW
      );
      expect(score).toBe(100);
      expect(reasons.facts.flips).toBe(3);
    });

    it("scores a stable history as zero", () => {
      const { score } = computeRiskScore(
        signals({ verdicts: [true, true, true, true] }),
        only("flakiness"),
        NOW
      );
      expect(score).toBe(0);
    });
  });

  describe("staleness", () => {
    it("is zero right after an execution", () => {
      const { score } = computeRiskScore(
        signals({ lastExecutedAt: NOW }),
        only("staleness"),
        NOW
      );
      expect(score).toBe(0);
    });

    it("saturates at the horizon", () => {
      const { score } = computeRiskScore(
        signals({ lastExecutedAt: daysBefore(STALENESS_HORIZON_DAYS + 10) }),
        only("staleness"),
        NOW
      );
      expect(score).toBe(100);
    });

    it("ages a never-executed case from its creation date", () => {
      const { score } = computeRiskScore(
        signals({
          lastExecutedAt: null,
          createdAt: daysBefore(STALENESS_HORIZON_DAYS / 2),
        }),
        only("staleness"),
        NOW
      );
      expect(score).toBe(50);
    });

    it("clamps future-dated references to zero", () => {
      const { score } = computeRiskScore(
        signals({ lastExecutedAt: daysBefore(-5) }),
        only("staleness"),
        NOW
      );
      expect(score).toBe(0);
    });
  });

  describe("criticality", () => {
    it("takes the highest linked requirement priority", () => {
      const { score, reasons } = computeRiskScore(
        signals({ requirementPriorities: ["low", "critical", "medium"] }),
        only("criticality"),
        NOW
      );
      expect(score).toBe(100);
      expect(reasons.facts.topRequirementPriority).toBe("critical");
      expect(reasons.facts.requirementCount).toBe(3);
    });

    it("scores an unknown requirement priority as medium", () => {
      const { score } = computeRiskScore(
        signals({ requirementPriorities: [null] }),
        only("criticality"),
        NOW
      );
      expect(score).toBe(50);
    });

    it("uses the case's own priority field when it outranks the links", () => {
      const { score, reasons } = computeRiskScore(
        signals({ requirementPriorities: ["low"], casePriority: "High" }),
        only("criticality"),
        NOW
      );
      expect(score).toBe(75);
      expect(reasons.facts.casePriority).toBe("High");
    });

    it("carries no signal without links or a case priority", () => {
      const { score } = computeRiskScore(signals(), only("criticality"), NOW);
      expect(score).toBe(0);
    });

    it("boosts suspect links and caps at 100", () => {
      const boosted = computeRiskScore(
        signals({ requirementPriorities: ["medium"], suspectLinkCount: 1 }),
        only("criticality"),
        NOW
      );
      expect(boosted.score).toBe(75);
      const capped = computeRiskScore(
        signals({ requirementPriorities: ["critical"], suspectLinkCount: 2 }),
        only("criticality"),
        NOW
      );
      expect(capped.score).toBe(100);
      expect(capped.reasons.facts.suspectLinkCount).toBe(2);
    });
  });

  describe("defects", () => {
    it("saturates on two critical defects", () => {
      const { score, reasons } = computeRiskScore(
        signals({ defectPriorities: ["critical", "critical"] }),
        only("defects"),
        NOW
      );
      expect(score).toBe(100);
      expect(reasons.facts.defectCount).toBe(2);
      expect(reasons.facts.topDefectPriority).toBe("critical");
    });

    it("scores one low defect proportionally", () => {
      const { score } = computeRiskScore(
        signals({ defectPriorities: ["low"] }),
        only("defects"),
        NOW
      );
      // 25 / 200
      expect(score).toBe(13);
    });

    it("carries no signal without defects", () => {
      const { score } = computeRiskScore(signals(), only("defects"), NOW);
      expect(score).toBe(0);
    });
  });

  it("returns zero when every weight is zero", () => {
    const { score, reasons } = computeRiskScore(
      signals({ verdicts: [false], defectPriorities: ["critical"] }),
      {
        failureHistory: 0,
        flakiness: 0,
        staleness: 0,
        criticality: 0,
        defects: 0,
      },
      NOW
    );
    expect(score).toBe(0);
    expect(reasons.components.every((c) => c.points === 0)).toBe(true);
  });

  it("normalizes by the weight sum", () => {
    // Two equal-weight components, one saturated: half the scale.
    const { score } = computeRiskScore(
      signals({ verdicts: [false, false, false] }),
      {
        failureHistory: 50,
        flakiness: 0,
        staleness: 0,
        criticality: 50,
        defects: 0,
      },
      NOW
    );
    expect(score).toBe(50);
  });

  it("records quarantine and execution facts without scoring them", () => {
    const executedAt = daysBefore(1);
    const { reasons } = computeRiskScore(
      signals({ quarantined: true, lastExecutedAt: executedAt }),
      DEFAULT_RISK_WEIGHTS,
      NOW
    );
    expect(reasons.facts.quarantined).toBe(true);
    expect(reasons.facts.lastExecutedAt).toBe(executedAt.toISOString());
  });
});
