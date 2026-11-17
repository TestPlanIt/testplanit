// The coverage-changes visualization panel: tiles and per-kind bars
// derived from the same rows the table shows. The seam under test is the
// derivation — a changed-requirement count that excludes UNCHANGED rows,
// the four transition counters, and the kind bars only for present kinds.

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

import { RequirementCoverageChangesOverview } from "./RequirementCoverageChangesOverview";

function row(overrides: Record<string, unknown>) {
  return {
    requirementId: 1,
    requirementKey: "REQ",
    requirementTitle: null,
    requirementPath: "REQ",
    requirementParentPath: "",
    requirementIssueTypeName: null,
    requirementIssueTypeIconUrl: null,
    requirementRootId: 1,
    changeKind: "UNCHANGED",
    previousCoverageStatus: "PASSED",
    currentCoverageStatus: "PASSED",
    previousLinkedCaseCount: 1,
    currentLinkedCaseCount: 1,
    casesAdded: 0,
    casesRemoved: 0,
    resultsChanged: 0,
    ...overrides,
  } as any;
}

describe("RequirementCoverageChangesOverview", () => {
  it("draws from the server summary when one is given, not from the rows on screen", () => {
    render(
      <RequirementCoverageChangesOverview
        rows={[row({ requirementId: 4, changeKind: "UNCHANGED" })]}
        summary={{
          total: 13085,
          byKind: {
            ADDED: 5,
            REMOVED: 6,
            COVERAGE_CHANGED: 40,
            LINKS_CHANGED: 50,
            RESULTS_CHANGED: 10,
            UNCHANGED: 12974,
          },
          newlyCovered: 7,
          newlyUncovered: 8,
          nowFailing: 9,
          noLongerFailing: 3,
        }}
      />
    );
    const tile = (key: string) =>
      screen.getByTestId(`requirement-changes-tile-${key}`).textContent;
    expect(tile("changed")).toContain("111");
    expect(tile("newly-covered")).toContain("7");
    expect(tile("newly-uncovered")).toContain("8");
    expect(tile("now-failing")).toContain("9");
  });

  it("derives the tiles and kind bars from the rows", () => {
    render(
      <RequirementCoverageChangesOverview
        rows={[
          row({
            requirementId: 1,
            changeKind: "COVERAGE_CHANGED",
            previousCoverageStatus: "UNCOVERED",
            currentCoverageStatus: "FAILED",
          }),
          row({
            requirementId: 2,
            changeKind: "COVERAGE_CHANGED",
            previousCoverageStatus: "FAILED",
            currentCoverageStatus: "PASSED",
          }),
          row({
            requirementId: 3,
            changeKind: "REMOVED",
            previousCoverageStatus: "PASSED",
            currentCoverageStatus: null,
            currentLinkedCaseCount: null,
          }),
          row({ requirementId: 4, changeKind: "UNCHANGED" }),
        ]}
      />
    );

    const tile = (key: string) =>
      screen.getByTestId(`requirement-changes-tile-${key}`).textContent;
    expect(tile("changed")).toContain("3");
    expect(tile("newly-covered")).toContain("1");
    // A removed requirement is not "newly uncovered" — it is gone.
    expect(tile("newly-uncovered")).toContain("0");
    expect(tile("now-failing")).toContain("1");
    expect(tile("no-longer-failing")).toContain("1");

    expect(
      screen.getByTestId("requirement-changes-kind-coverage_changed")
        .textContent
    ).toContain("2");
    expect(
      screen.getByTestId("requirement-changes-kind-removed").textContent
    ).toContain("1");
    expect(
      screen.getByTestId("requirement-changes-kind-unchanged").textContent
    ).toContain("1");
    expect(screen.queryByTestId("requirement-changes-kind-added")).toBeNull();
  });
});
