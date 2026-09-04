import { describe, expect, it } from "vitest";
import {
  canCompare,
  compareUrl,
  defaultSelection,
  impactDialogReducer,
  initialImpactDialogState,
  isSameCommit,
  shouldSwap,
  type CompareResponse,
  type ImpactDialogState,
} from "./ImpactDialog";
import type { ImpactAnalysisCaseRow } from "~/hooks/useImpactAnalysis";

type CommitRef = NonNullable<ImpactDialogState["base"]>;

function commit(sha: string): CommitRef {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: `commit ${sha}`,
    authorName: "dev",
    authoredAt: "2026-09-01T00:00:00.000Z",
  } as unknown as CommitRef;
}

function compare(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    files: [],
    commits: [],
    truncated: false,
    cached: false,
    ...overrides,
  } as unknown as CompareResponse;
}

function caseRow(caseId: number, tier: string): ImpactAnalysisCaseRow {
  return { caseId, tier } as unknown as ImpactAnalysisCaseRow;
}

const picked: ImpactDialogState = {
  ...initialImpactDialogState,
  base: commit("a".repeat(40)),
  head: commit("b".repeat(40)),
};

describe("impactDialogReducer", () => {
  it("refuses to compare the same commit twice and allows two different ones", () => {
    const same = { ...picked, head: picked.base };
    expect(isSameCommit(same)).toBe(true);
    expect(canCompare(same)).toBe(false);
    expect(impactDialogReducer(same, { type: "COMPARE" })).toBe(same);

    expect(canCompare(picked)).toBe(true);
    const next = impactDialogReducer(picked, { type: "COMPARE" });
    expect(next.step).toBe("diff");
  });

  it("clears an earlier compare when a commit changes", () => {
    const withCompare = {
      ...picked,
      step: "diff" as const,
      compare: compare(),
    };
    const next = impactDialogReducer(withCompare, {
      type: "SET_HEAD",
      commit: commit("c".repeat(40)),
    });
    expect(next.compare).toBeNull();
    expect(next.head?.sha).toBe("c".repeat(40));
  });

  it("swaps base and head once when the compare reports base ahead of head", () => {
    const backwards = compare({ aheadBy: 0, behindBy: 3 });
    expect(shouldSwap(backwards)).toBe(true);
    const swapped = impactDialogReducer(
      { ...picked, step: "diff" },
      { type: "COMPARE_LOADED", compare: backwards }
    );
    expect(swapped.swapped).toBe(true);
    expect(swapped.base?.sha).toBe("b".repeat(40));
    expect(swapped.head?.sha).toBe("a".repeat(40));
    expect(swapped.compare).toBeNull();

    const settled = impactDialogReducer(swapped, {
      type: "COMPARE_LOADED",
      compare: backwards,
    });
    expect(settled.swapped).toBe(true);
    expect(settled.compare).toEqual(backwards);
  });

  it("walks pick -> diff -> running -> review and back", () => {
    let state = impactDialogReducer(picked, { type: "COMPARE" });
    state = impactDialogReducer(state, {
      type: "COMPARE_LOADED",
      compare: compare({ aheadBy: 2, behindBy: 0 }),
    });
    expect(state.step).toBe("diff");

    state = impactDialogReducer(state, { type: "ANALYSIS_STARTED" });
    expect(state.step).toBe("running");
    state = impactDialogReducer(state, {
      type: "ANALYSIS_META",
      aiAvailable: false,
      reused: true,
    });
    expect(state.aiAvailable).toBe(false);
    expect(state.reused).toBe(true);

    const cases = [
      caseRow(1, "pinned"),
      caseRow(2, "affected"),
      caseRow(3, "related"),
    ];
    state = impactDialogReducer(state, { type: "ANALYSIS_COMPLETED", cases });
    expect(state.step).toBe("review");
    expect(state.selectedCaseIds).toEqual([1, 2]);
    expect(defaultSelection(cases)).toEqual([1, 2]);

    state = impactDialogReducer(state, { type: "BACK" });
    expect(state.step).toBe("diff");
    expect(state.cases).toEqual([]);
    expect(state.selectedCaseIds).toEqual([]);

    state = impactDialogReducer(state, { type: "BACK" });
    expect(state.step).toBe("pick");
  });

  it("toggles, replaces, and extends the selection", () => {
    const review: ImpactDialogState = {
      ...picked,
      step: "review",
      selectedCaseIds: [1, 2],
    };
    expect(
      impactDialogReducer(review, { type: "TOGGLE_CASE", caseId: 2 })
        .selectedCaseIds
    ).toEqual([1]);
    expect(
      impactDialogReducer(review, { type: "TOGGLE_CASE", caseId: 5 })
        .selectedCaseIds
    ).toEqual([1, 2, 5]);
    expect(
      impactDialogReducer(review, { type: "SET_SELECTION", caseIds: [3, 3, 4] })
        .selectedCaseIds
    ).toEqual([3, 4]);

    const pinned = impactDialogReducer(review, {
      type: "PIN_CREATED",
      path: "src/a.ts",
      caseId: 9,
    });
    expect(pinned.pinnedUncovered).toEqual({ "src/a.ts": 9 });
    expect(pinned.selectedCaseIds).toEqual([1, 2, 9]);
  });

  it("resets to the initial state", () => {
    const state = impactDialogReducer(
      { ...picked, step: "review", selectedCaseIds: [1] },
      { type: "RESET" }
    );
    expect(state).toEqual(initialImpactDialogState);
  });
});

describe("compareUrl", () => {
  it("encodes the config and both refs", () => {
    expect(compareUrl(3, 7, "feature/x", "b".repeat(40))).toBe(
      `/api/code-repositories/3/compare?configId=7&base=feature%2Fx&head=${"b".repeat(40)}`
    );
  });
});
