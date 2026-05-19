import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyBand,
  computePreflight,
  DEFAULT_CARDINALITY_THRESHOLDS,
  readCardinalityThresholds,
} from "./iterationCardinality";

const DEFAULTS = DEFAULT_CARDINALITY_THRESHOLDS;

describe("classifyBand", () => {
  it.each([
    [0, "sync"],
    [1, "sync"],
    [DEFAULTS.asyncCap, "sync"],
    [DEFAULTS.asyncCap + 1, "async"],
    [DEFAULTS.softCap - 1, "async"],
    [DEFAULTS.softCap, "async"],
    [DEFAULTS.softCap + 1, "softConfirm"],
    [DEFAULTS.hardCap - 1, "softConfirm"],
    [DEFAULTS.hardCap, "softConfirm"],
    [DEFAULTS.hardCap + 1, "hardRefuse"],
    [100_000, "hardRefuse"],
  ] as const)("classifies total=%i as %s", (total, expected) => {
    expect(classifyBand(total, DEFAULTS)).toBe(expected);
  });

  it("respects custom thresholds (used when env vars override defaults)", () => {
    const custom = { hardCap: 100, softCap: 50, asyncCap: 10 };
    expect(classifyBand(0, custom)).toBe("sync");
    expect(classifyBand(10, custom)).toBe("sync");
    expect(classifyBand(11, custom)).toBe("async");
    expect(classifyBand(50, custom)).toBe("async");
    expect(classifyBand(51, custom)).toBe("softConfirm");
    expect(classifyBand(100, custom)).toBe("softConfirm");
    expect(classifyBand(101, custom)).toBe("hardRefuse");
  });
});

describe("readCardinalityThresholds", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.PARAMETERIZED_RUN_HARD_CAP;
    delete process.env.PARAMETERIZED_RUN_SOFT_CAP;
    delete process.env.PARAMETERIZED_RUN_ASYNC_CAP;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("returns the locked defaults when no env vars are set", () => {
    expect(readCardinalityThresholds()).toEqual(DEFAULTS);
  });

  it("parses numeric env vars when present", () => {
    process.env.PARAMETERIZED_RUN_HARD_CAP = "10000";
    process.env.PARAMETERIZED_RUN_SOFT_CAP = "2500";
    process.env.PARAMETERIZED_RUN_ASYNC_CAP = "750";
    expect(readCardinalityThresholds()).toEqual({
      hardCap: 10000,
      softCap: 2500,
      asyncCap: 750,
    });
  });

  it("falls back to defaults when env vars are non-numeric", () => {
    process.env.PARAMETERIZED_RUN_HARD_CAP = "not-a-number";
    process.env.PARAMETERIZED_RUN_SOFT_CAP = "";
    process.env.PARAMETERIZED_RUN_ASYNC_CAP = "abc";
    expect(readCardinalityThresholds()).toEqual(DEFAULTS);
  });

  it("falls back to defaults when env vars are negative", () => {
    process.env.PARAMETERIZED_RUN_HARD_CAP = "-1";
    expect(readCardinalityThresholds().hardCap).toBe(DEFAULTS.hardCap);
  });
});

describe("computePreflight", () => {
  it("returns total=0 and empty perCase when no cases are provided", () => {
    const r = computePreflight([], 0, DEFAULTS);
    expect(r.total).toBe(0);
    expect(r.perCase).toEqual([]);
    expect(r.classification).toBe("sync");
    expect(r.thresholds).toEqual(DEFAULTS);
  });

  it("treats configCount=0 as configCount=1 (no-config run still creates one TestRunCase)", () => {
    const r = computePreflight(
      [{ caseId: 1, caseTitle: "A", hasParameters: true, rowCount: 5 }],
      0,
      DEFAULTS
    );
    expect(r.total).toBe(5);
    expect(r.perCase[0].iterations).toBe(5);
  });

  it("multiplies rowCount by configCount for parameterized cases", () => {
    const r = computePreflight(
      [{ caseId: 1, caseTitle: "Login", hasParameters: true, rowCount: 10 }],
      3,
      DEFAULTS
    );
    expect(r.total).toBe(30);
    expect(r.perCase[0]).toEqual({
      caseId: 1,
      caseTitle: "Login",
      rowCount: 10,
      iterations: 30,
    });
  });

  it("excludes non-parameterized cases from perCase and from total", () => {
    const r = computePreflight(
      [
        { caseId: 1, caseTitle: "Param", hasParameters: true, rowCount: 4 },
        { caseId: 2, caseTitle: "Plain", hasParameters: false, rowCount: 0 },
        { caseId: 3, caseTitle: "Plain2", hasParameters: false, rowCount: 99 },
      ],
      2,
      DEFAULTS
    );
    expect(r.total).toBe(8);
    expect(r.perCase).toHaveLength(1);
    expect(r.perCase[0].caseId).toBe(1);
  });

  it("includes parameterized cases with rowCount=0 in perCase (UI hint surface)", () => {
    const r = computePreflight(
      [
        {
          caseId: 1,
          caseTitle: "Empty Dataset",
          hasParameters: true,
          rowCount: 0,
        },
      ],
      2,
      DEFAULTS
    );
    expect(r.total).toBe(0);
    expect(r.perCase).toHaveLength(1);
    expect(r.perCase[0].iterations).toBe(0);
  });

  it("sorts perCase by iterations desc (hardest contributors first)", () => {
    const r = computePreflight(
      [
        { caseId: 1, caseTitle: "Small", hasParameters: true, rowCount: 2 },
        { caseId: 2, caseTitle: "Big", hasParameters: true, rowCount: 100 },
        { caseId: 3, caseTitle: "Medium", hasParameters: true, rowCount: 20 },
      ],
      1,
      DEFAULTS
    );
    expect(r.perCase.map((c) => c.caseId)).toEqual([2, 3, 1]);
  });

  it("classifies the rolled-up total", () => {
    const r = computePreflight(
      [{ caseId: 1, caseTitle: "Big", hasParameters: true, rowCount: 6000 }],
      1,
      DEFAULTS
    );
    expect(r.classification).toBe("hardRefuse");
  });

  it("includes every parameterized case (positive and zero) but does not double-count", () => {
    const r = computePreflight(
      [
        { caseId: 1, caseTitle: "A", hasParameters: true, rowCount: 3 },
        { caseId: 2, caseTitle: "B", hasParameters: true, rowCount: 0 },
        { caseId: 3, caseTitle: "C", hasParameters: true, rowCount: 7 },
      ],
      4,
      DEFAULTS
    );
    expect(r.total).toBe(40); // (3 + 0 + 7) × 4
    expect(r.perCase).toHaveLength(3);
  });
});
