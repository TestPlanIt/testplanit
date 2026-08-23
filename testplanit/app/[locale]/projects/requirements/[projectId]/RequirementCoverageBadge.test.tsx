// Converted from the Wave 0 title scaffold (COV-01, COV-03, D-1). See
// 26-PATTERNS.md Trap 1 and this file's own comments for why the Trap-1
// regression test below anchors on a case-insensitive text substring
// rather than a shared data-testid: CoverageChip's uncovered branch
// carries no data-testid of its own at all, so a testid-based assertion
// can never discriminate the mutation — only a text-content check can.

import fs from "node:fs";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

import { RequirementCoverageBadge } from "./RequirementCoverageBadge";

const uncoveredBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 0,
  crossProjectCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  uncovered: true,
  status: "UNCOVERED",
};

const passedBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 7,
  crossProjectCaseCount: 0,
  passed: 7,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  uncovered: false,
  status: "PASSED",
};

const failedBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 7,
  crossProjectCaseCount: 0,
  passed: 3,
  failed: 1,
  inProgress: 0,
  notRun: 3,
  uncovered: false,
  status: "FAILED",
};

const notRunBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 4,
  crossProjectCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 4,
  uncovered: false,
  status: "NOT_RUN",
};

/** Counts alone read as fully passed (5/5, nothing failed, nothing
 * outstanding); `status` says otherwise. A component that recomputed the
 * ladder from the counts would render PASSED here — this fixture only
 * exists to catch that. */
const adversarialBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 5,
  crossProjectCaseCount: 0,
  passed: 5,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  uncovered: false,
  status: "FAILED",
};

describe("RequirementCoverageBadge", () => {
  it("renders the dashed warning treatment for an uncovered requirement", () => {
    render(<RequirementCoverageBadge breakdown={uncoveredBreakdown} />);
    const badge = screen.getByTestId("requirement-coverage-uncovered");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/\bborder-dashed\b/);
    expect(badge.className).toMatch(/\bborder-warning\b/);
    expect(badge).toHaveTextContent("uncovered");
    // No 0/0 noise: `uncovered` is a dedicated field precisely so a
    // consumer never has to infer the gap from a zeroed-out counter pair.
    expect(badge).not.toHaveTextContent("/");
  });

  it("renders passed, failed, and not-run states distinctly from each other", () => {
    const { container: passedContainer } = render(
      <RequirementCoverageBadge breakdown={passedBreakdown} />
    );
    const { container: failedContainer } = render(
      <RequirementCoverageBadge breakdown={failedBreakdown} />
    );
    const { container: notRunContainer } = render(
      <RequirementCoverageBadge breakdown={notRunBreakdown} />
    );

    const passedBadge = within(passedContainer).getByTestId(
      "requirement-coverage-passed"
    );
    const failedBadge = within(failedContainer).getByTestId(
      "requirement-coverage-failed"
    );
    const notRunBadge = within(notRunContainer).getByTestId(
      "requirement-coverage-not_run"
    );

    expect(passedBadge).toHaveTextContent("statusPassed");
    expect(failedBadge).toHaveTextContent("statusFailed");
    expect(notRunBadge).toHaveTextContent("statusNotRun");

    // Each carries only its own status word, never a sibling's.
    expect(passedBadge).not.toHaveTextContent("statusFailed");
    expect(passedBadge).not.toHaveTextContent("statusNotRun");
    expect(failedBadge).not.toHaveTextContent("statusPassed");
    expect(failedBadge).not.toHaveTextContent("statusNotRun");
    expect(notRunBadge).not.toHaveTextContent("statusPassed");
    expect(notRunBadge).not.toHaveTextContent("statusFailed");

    // Distinguishable from uncovered too: none of the three carries the
    // dashed warning treatment or its dedicated testid.
    for (const badge of [passedBadge, failedBadge, notRunBadge]) {
      expect(badge.className).not.toMatch(/\bborder-dashed\b/);
    }
    expect(
      within(passedContainer).queryByTestId("requirement-coverage-uncovered")
    ).toBeNull();
    expect(
      within(failedContainer).queryByTestId("requirement-coverage-uncovered")
    ).toBeNull();
    expect(
      within(notRunContainer).queryByTestId("requirement-coverage-uncovered")
    ).toBeNull();
  });

  it("renders the passed-over-total count alongside the status", () => {
    render(<RequirementCoverageBadge breakdown={failedBreakdown} />);
    const badge = screen.getByTestId("requirement-coverage-failed");
    // The numerator is `passed` (3), never `failed` (1) — see the
    // component's own comment on why putting `failed` there would read
    // backwards and say the same thing the status word already says.
    expect(badge).toHaveTextContent("countLabel:3·7");
    expect(badge).toHaveTextContent("statusFailed");
  });

  it("derives its status from the breakdown it is given rather than recomputing a ladder", () => {
    render(<RequirementCoverageBadge breakdown={adversarialBreakdown} />);
    // Counts alone (5/5, nothing failed, nothing outstanding) read as a
    // clean pass. A component deriving from `status` renders FAILED here
    // regardless; one that recomputed the ladder from the counts would
    // render PASSED and this assertion would fail.
    expect(
      screen.getByTestId("requirement-coverage-failed")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("requirement-coverage-passed")
    ).toBeNull();
    expect(screen.getByTestId("requirement-coverage-failed")).toHaveTextContent(
      "statusFailed"
    );
  });

  it("carries the full four-counter breakdown in its tooltip and aria-label", () => {
    render(<RequirementCoverageBadge breakdown={failedBreakdown} />);
    const badge = screen.getByTestId("requirement-coverage-failed");
    const expected = `breakdownTooltip:3·1·0·3`;
    expect(badge).toHaveAttribute("title", expected);
    expect(badge).toHaveAttribute("aria-label", expected);
  });

  // THE TRAP-1 REGRESSION. Mutation-proven per 26-VALIDATION.md's testing
  // standard: this test was temporarily rewritten to render `CoverageChip`
  // fed `passedBreakdown` through an `as unknown as CoverageBreakdown` cast
  // in place of `RequirementCoverageBadge`, observed RED, then restored. See
  // 26-05-SUMMARY.md for the verbatim failure output. CoverageChip's own
  // uncovered branch carries no `data-testid`, so the testid assertion
  // below cannot discriminate the substitution by construction — the text
  // assertion is the one that actually flips, which is why it is a
  // case-insensitive substring match rather than an exact string: under
  // the mock, CoverageChip's `t("coverageUncovered")` renders literally as
  // "coverageUncovered", which itself contains "Uncovered".
  it("never renders an uncovered treatment for a requirement with passing cases", () => {
    render(<RequirementCoverageBadge breakdown={passedBreakdown} />);
    expect(
      screen.queryByTestId("requirement-coverage-uncovered")
    ).toBeNull();
    expect(screen.queryByText(/uncovered/i)).toBeNull();
  });

  // Visual collapse order (does the provenance badge actually shrink
  // before the coverage badge, before the name) is NOT provable in jsdom
  // — getBoundingClientRect() returns 0 here, same reason
  // RequirementProvenanceBadge's own collapse effect early-returns. What
  // IS provable, and is what this test proves, is that the three
  // competitors carry distinct, explicitly-authored shrink weights in the
  // ORDER D-1 requires. Visual confirmation is 26-13's operator UAT.
  it("encodes the row priority as distinct shrink weights: provenance above coverage above the name", () => {
    render(<RequirementCoverageBadge breakdown={passedBreakdown} />);
    const coverageBadge = screen.getByTestId("requirement-coverage-passed");
    const coverageMatch = coverageBadge.className.match(/shrink-\[(\d+)\]/);
    expect(coverageMatch).not.toBeNull();
    const coverageShrink = Number(coverageMatch![1]);

    const provenanceSource = fs.readFileSync(
      "app/[locale]/projects/requirements/[projectId]/RequirementProvenanceBadge.tsx",
      "utf8"
    );
    const provenanceMatch = provenanceSource.match(/shrink-\[(\d+)\]/);
    expect(provenanceMatch).not.toBeNull();
    const provenanceShrink = Number(provenanceMatch![1]);

    const treeViewSource = fs.readFileSync(
      "app/[locale]/projects/requirements/[projectId]/RequirementsTreeView.tsx",
      "utf8"
    );
    // Anchored on the unique `flex-auto` token inside the className
    // attribute value itself, never a fixed-width character window —
    // four window-anchored verification scripts have already
    // mis-reported this milestone (see STATE.md).
    const nameSpanMatch = treeViewSource.match(
      /className="([^"]*\bflex-auto\b[^"]*)"/
    );
    expect(nameSpanMatch).not.toBeNull();
    const nameSpanClassName = nameSpanMatch![1];
    expect(nameSpanClassName).toContain("flex-auto");
    expect(nameSpanClassName).toContain("min-w-0");
    expect(nameSpanClassName).not.toMatch(/\bflex-1\b/);
    // No explicit override on the name span — its shrink weight is the
    // CSS default, which is 1.
    expect(nameSpanClassName).not.toMatch(/shrink-\[/);
    const nameShrink = 1;

    // Floor-style ordering assertion, not an exact-value pin on the
    // provenance badge's own weight (which this file does not own).
    expect(provenanceShrink).toBeGreaterThan(coverageShrink);
    expect(coverageShrink).toBeGreaterThan(nameShrink);
  });
});
