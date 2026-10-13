import { describe, expect, it } from "vitest";
import {
  EMPTY_RUN_CASE_SELECTION,
  selectedAutomatedCaseIds,
} from "./selection";

const automated = [
  { id: 11, repositoryCaseId: 101 },
  { id: 12, repositoryCaseId: 102 },
  { id: 13, repositoryCaseId: 103 },
];

describe("selectedAutomatedCaseIds", () => {
  it("returns nothing for an empty selection or a run without automated cases", () => {
    expect(
      selectedAutomatedCaseIds(EMPTY_RUN_CASE_SELECTION, automated)
    ).toEqual([]);
    expect(
      selectedAutomatedCaseIds({ ids: [101], keyedBy: "repositoryCaseId" }, [])
    ).toEqual([]);
  });

  it("keeps only the selected repository cases that are automated, in run order", () => {
    expect(
      selectedAutomatedCaseIds(
        { ids: [103, 999, 101], keyedBy: "repositoryCaseId" },
        automated
      )
    ).toEqual([101, 103]);
  });

  it("maps a run-case keyed selection (multi-configuration view) to repository case ids", () => {
    expect(
      selectedAutomatedCaseIds(
        { ids: [12, 13, 77], keyedBy: "testRunCaseId" },
        automated
      )
    ).toEqual([102, 103]);
  });

  it("does not confuse the two id spaces", () => {
    // 11 is a run-case id, not a repository case id: nothing matches.
    expect(
      selectedAutomatedCaseIds(
        { ids: [11], keyedBy: "repositoryCaseId" },
        automated
      )
    ).toEqual([]);
  });

  it("returns each repository case once", () => {
    expect(
      selectedAutomatedCaseIds({ ids: [11, 12], keyedBy: "testRunCaseId" }, [
        ...automated,
        { id: 14, repositoryCaseId: 101 },
      ])
    ).toEqual([101, 102]);
  });
});
