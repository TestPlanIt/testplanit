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

import {
  COVERAGE_BADGE_MIN_WIDTH_PX,
  RequirementCoverageBadge,
} from "./RequirementCoverageBadge";

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
    expect(screen.queryByTestId("requirement-coverage-passed")).toBeNull();
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
    expect(screen.queryByTestId("requirement-coverage-uncovered")).toBeNull();
    expect(screen.queryByText(/uncovered/i)).toBeNull();
  });

  // Visual collapse order (does the provenance badge actually shrink
  // before the coverage badge) is NOT provable in jsdom —
  // getBoundingClientRect() returns 0 here, same reason
  // RequirementProvenanceBadge's own collapse effect early-returns. What
  // IS provable, and is what this test proves, is that the badges still
  // carry distinct, explicitly-authored shrink weights above the CSS
  // default. Visual confirmation is 26-13's operator UAT.
  //
  // 26.2-05: this test used to also read the row's name-cell span (then
  // living in the earlier react-arborist tree component this phase
  // replaced) and assert a three-way ordering —
  // provenance above coverage above the name — because all three were flex
  // siblings competing for width on one row. Per UI-SPEC §9.5, the
  // tree-table rebuild gave each badge its own resizable table column: with
  // no sibling to negotiate against, that flex-competition math is inert,
  // and the name-cell half of the old assertion no longer has a row to
  // assert against. The badges' own internal ResizeObserver collapse
  // ladders are unchanged and still covered by this file's other tests, so
  // this test now only proves the two badges that remain flex-relevant to
  // each other (provenance still wraps its own name-cell drag handle
  // laterally) keep their documented floor above the CSS default of 1.
  it("encodes the row priority as distinct shrink weights: provenance above coverage above the CSS default", () => {
    render(<RequirementCoverageBadge breakdown={passedBreakdown} />);
    const coverageBadge = screen.getByTestId("requirement-coverage-passed");
    // 26-13 moved the shrink/min-w classes off the visible Badge and onto
    // its wrapper span (the actual flex item on the row now that this
    // badge has its own in-flow measuring copy, mirroring
    // RequirementProvenanceBadge's wrapper/badge split) — walk up from the
    // testid'd element rather than assuming the class is on it directly.
    let ancestor: HTMLElement | null = coverageBadge;
    let coverageShrink: number | null = null;
    while (ancestor && coverageShrink === null) {
      const match = ancestor.className.match(/shrink-\[(\d+)\]/);
      if (match) coverageShrink = Number(match[1]);
      ancestor = ancestor.parentElement;
    }
    expect(coverageShrink).not.toBeNull();

    const provenanceSource = fs.readFileSync(
      "app/[locale]/projects/requirements/[projectId]/RequirementProvenanceBadge.tsx",
      "utf8"
    );
    const provenanceMatch = provenanceSource.match(/shrink-\[(\d+)\]/);
    expect(provenanceMatch).not.toBeNull();
    const provenanceShrink = Number(provenanceMatch![1]);

    // Floor-style ordering assertion, not an exact-value pin on either
    // badge's own weight (which this file does not own).
    expect(provenanceShrink).toBeGreaterThan(coverageShrink!);
    // The CSS default shrink weight is 1 -- both badges' authored weights
    // stay above it even with no sibling left to shrink against.
    expect(coverageShrink!).toBeGreaterThan(1);
  });

  // 26-13 Finding 1 (BLOCKING): the operator's live-browser UAT found the
  // status word never actually dropped — it shrank into its 48px floor and
  // hard-clipped its own text instead, with 5 of 11 real badges clipped
  // mid-word at 1440x900. jsdom has no layout, so this cannot re-run the
  // visual proof; it proves the STRUCTURAL contract the fix depends on
  // instead, per 26-13-PLAN.md's own guidance for this exact situation.
  it("keeps the status word in its own droppable segment, separate from the count, so it can be omitted without truncating either", () => {
    render(<RequirementCoverageBadge breakdown={notRunBreakdown} />);
    const countEl = screen.getByTestId("requirement-coverage-count");
    const statusWordEl = screen.getByTestId("requirement-coverage-status-word");

    // Two distinct elements, neither nested inside the other -- dropping
    // one can never require truncating or reaching into the other.
    expect(statusWordEl).not.toBe(countEl);
    expect(statusWordEl.contains(countEl)).toBe(false);
    expect(countEl.contains(statusWordEl)).toBe(false);

    // Neither segment carries a character-level truncation class. The old
    // version's status word was `min-w-0 truncate`, which is exactly what
    // let it clip mid-word instead of disappearing whole; the count itself
    // was never supposed to truncate at all, and 26-13 found it doing so
    // anyway once nothing else was left to give up width.
    expect(countEl.className).not.toMatch(/\btruncate\b/);
    expect(countEl.className).not.toMatch(/\bmin-w-0\b/);
    expect(statusWordEl.className).not.toMatch(/\btruncate\b/);
    expect(statusWordEl.className).not.toMatch(/\bmin-w-0\b/);

    expect(countEl).toHaveTextContent(notRunBreakdown.linkedCaseCount + "");
    expect(statusWordEl).toHaveTextContent("statusNotRun");
  });

  it('raises the width floor above the old 48px value that let both the count and the lone "Uncovered" word hard-clip', () => {
    // 116px is 26-13's measured widest FULL content ("0/10 · Not run"); the
    // floor must sit below that (so the drop step in the test above stays
    // reachable) but comfortably above 83px, the measured width of the
    // "Uncovered" word alone, which has no secondary segment to drop.
    expect(COVERAGE_BADGE_MIN_WIDTH_PX).toBeGreaterThanOrEqual(84);
    expect(COVERAGE_BADGE_MIN_WIDTH_PX).toBeLessThan(116);

    const { container: coveredContainer } = render(
      <RequirementCoverageBadge breakdown={notRunBreakdown} />
    );
    const coveredBadge = within(coveredContainer).getByTestId(
      "requirement-coverage-not_run"
    );
    expect(coveredBadge.parentElement!.className).toMatch(/\bmin-w-24\b/);
    expect(coveredBadge.parentElement!.className).not.toMatch(
      /\bmin-w-\[3rem\]\b/
    );

    const { container: uncoveredContainer } = render(
      <RequirementCoverageBadge breakdown={uncoveredBreakdown} />
    );
    const uncoveredBadge = within(uncoveredContainer).getByTestId(
      "requirement-coverage-uncovered"
    );
    expect(uncoveredBadge.className).toMatch(/\bmin-w-24\b/);
    expect(uncoveredBadge.className).not.toMatch(/\bmin-w-\[3rem\]\b/);
  });
});
