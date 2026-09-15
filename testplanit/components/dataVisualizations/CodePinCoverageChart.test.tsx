import { describe, expect, it } from "vitest";
import { summarizeCodePinCoverage } from "./CodePinCoverageChart";

const row = (o: Partial<any>) => ({
  pinCount: 0,
  stalePinCount: 0,
  uncoveredFileCount: 0,
  projectCaseTotal: 20,
  projectCasesWithPins: 5,
  ...o,
});

describe("summarizeCodePinCoverage", () => {
  it("sums pins, stale pins, uncovered files, gap directories, and reads project totals once per project", () => {
    const s = summarizeCodePinCoverage([
      row({ pinCount: 3, stalePinCount: 1 }),
      row({ pinCount: 0, uncoveredFileCount: 4 }),
      row({ pinCount: 2, uncoveredFileCount: 1 }),
      row({
        pinCount: 0,
        uncoveredFileCount: 2,
        project: { id: 2 },
        projectCaseTotal: 10,
        projectCasesWithPins: 1,
      }),
    ] as any);
    expect(s).toEqual({
      pinCount: 5,
      stalePinCount: 1,
      uncoveredFileCount: 7,
      gapDirectories: 2,
      casesWithPins: 6,
      caseTotal: 30,
      casesWithPinsPct: 20,
    });
  });
});
