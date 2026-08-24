// Converted from the Wave 0 title scaffold (COV-01, COV-03, D-1). See
// 26-PATTERNS.md Trap 1 and this file's own comments for why the Trap-1
// regression test below anchors on a case-insensitive text substring
// rather than a shared data-testid: CoverageChip's uncovered branch
// carries no data-testid of its own at all, so a testid-based assertion
// can never discriminate the mutation — only a text-content check can.

import fs from "node:fs";
import { act, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

import {
  COLLAPSE_HYSTERESIS_PX,
  COVERAGE_BADGE_MIN_WIDTH_PX,
  RequirementCoverageBadge,
} from "./RequirementCoverageBadge";

const uncoveredBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 0,
  crossProjectCaseCount: 0,
  directCaseCount: 0,
  directCrossProjectCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  statuses: [],
  untested: 0,
  uncovered: true,
  status: "UNCOVERED",
};

const passedBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 7,
  crossProjectCaseCount: 0,
  directCaseCount: 7,
  directCrossProjectCaseCount: 0,
  passed: 7,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  statuses: [],
  untested: 0,
  uncovered: false,
  status: "PASSED",
};

const failedBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 7,
  crossProjectCaseCount: 0,
  directCaseCount: 7,
  directCrossProjectCaseCount: 0,
  passed: 3,
  failed: 1,
  inProgress: 0,
  notRun: 3,
  statuses: [],
  untested: 0,
  uncovered: false,
  status: "FAILED",
};

const notRunBreakdown: RequirementCoverageBreakdown = {
  linkedCaseCount: 4,
  crossProjectCaseCount: 0,
  directCaseCount: 4,
  directCrossProjectCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 4,
  statuses: [],
  untested: 4,
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
  directCaseCount: 5,
  directCrossProjectCaseCount: 0,
  passed: 5,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  statuses: [],
  untested: 0,
  uncovered: false,
  status: "FAILED",
};

// --- Driven-ResizeObserver harness (gap closure, 26.2-09) ---------------
//
// jsdom's `getBoundingClientRect()` always returns zeros, and the global
// `MockResizeObserver` in vitest.setup.tsx discards the callback it is
// constructed with (`observe`/`disconnect` are no-ops) — between the two,
// the component's layout effect always early-returns on `full === 0` and
// 15 previously-green tests never drove a single real width through it.
// This harness removes both excuses for the tests below only: it swaps in
// a `ResizeObserver` fake that records its callback and lets a test fire
// it on demand, and stubs `getBoundingClientRect` per-element so the
// measuring copy and the wrapper can be given independent, test-chosen
// widths.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  /** Test-only: invoke the callback the way a real browser would on an
   *  actual resize, wrapped in `act` so the resulting `setState` commits
   *  before the next assertion. */
  trigger() {
    act(() => {
      this.callback(
        [] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver
      );
    });
  }
}

const rectWidths = new WeakMap<Element, number>();
/** Sets the width `getBoundingClientRect()` reports for one specific DOM
 *  node, independent of every other node — this is what lets a test give
 *  the invisible measuring copy a fixed FULL width while driving the
 *  wrapper's own reported width up and down across a threshold. */
function setRectWidth(el: Element, width: number) {
  rectWidths.set(el, width);
}

let originalResizeObserver: typeof globalThis.ResizeObserver;
let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement
  ) {
    const width = rectWidths.get(this) ?? 0;
    return {
      width,
      height: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

/** Locates the badge's own measuring copy (`aria-hidden="true"`, always
 *  rendered at FULL content size) and its wrapper (the measuring copy's
 *  direct parent, the actual `ResizeObserver` target) inside a rendered
 *  container. */
function getMeasureAndWrap(container: HTMLElement) {
  const measure = container.querySelector('[aria-hidden="true"]');
  if (!measure) throw new Error("measuring copy not found");
  const wrap = measure.parentElement;
  if (!wrap) throw new Error("wrapper not found");
  return { measure, wrap };
}

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

  // --- Driven-ResizeObserver tests (26.2-09 gap closure) -----------------
  //
  // Both assertions below are new in the sense the acceptance criteria
  // means: the existing suite (above) could never make them, because
  // nothing before this drove a real, non-zero width through
  // `getBoundingClientRect()`.
  describe("driven collapse decision (26.2-09)", () => {
    const FULL_WIDTH = 100;

    it("renders the status word when the wrapper reports a width wide enough to fit the full content", () => {
      const { container } = render(
        <RequirementCoverageBadge breakdown={notRunBreakdown} />
      );
      const { measure, wrap } = getMeasureAndWrap(container);
      setRectWidth(measure, FULL_WIDTH);
      setRectWidth(wrap, FULL_WIDTH + 20); // comfortably wide
      FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!.trigger();

      expect(
        screen.getByTestId("requirement-coverage-status-word")
      ).toBeInTheDocument();
    });

    it("drops the status word when the wrapper narrows below the full content width", () => {
      const { container } = render(
        <RequirementCoverageBadge breakdown={notRunBreakdown} />
      );
      const { measure, wrap } = getMeasureAndWrap(container);
      setRectWidth(measure, FULL_WIDTH);
      setRectWidth(wrap, FULL_WIDTH - 20); // comfortably narrow
      FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!.trigger();

      expect(
        screen.queryByTestId("requirement-coverage-status-word")
      ).toBeNull();
      // The count itself must still be present and un-clipped (26-13
      // Finding 1) -- the status word is what drops, never the count.
      expect(
        screen.getByTestId("requirement-coverage-count")
      ).toBeInTheDocument();
    });

    // THE REGRESSION TEST for the update-depth defect (26.2-09 task 1's
    // attribution). Pre-fix, `compute()` read `available`/`full` fresh from
    // `getBoundingClientRect()` on every fire and wrote unconditionally
    // whenever the raw `available + 0.5 >= full` comparison differed from
    // the current render's value -- no dead zone, no ref-gated idempotent
    // write. A width sitting exactly on that boundary needed only
    // sub-pixel measurement noise between successive `ResizeObserver`
    // fires (real browsers report exactly this kind of jitter -- font
    // metrics settling, sub-pixel layout rounding differing between
    // paints) to alternate forever, which is exactly what pegs the main
    // thread and trips React's "Maximum update depth exceeded" guard. This
    // test drives that documented noise directly: two widths 0.2px apart,
    // straddling the boundary, fed on alternating fires.
    //
    // Pre-fix RED (captured verbatim, 26.2-09-SUMMARY.md carries the full
    // run):
    //   AssertionError: expected 20 to be less than or equal to 1
    it("settles after at most one state change when the wrapper width jitters across the boundary", () => {
      const { container } = render(
        <RequirementCoverageBadge breakdown={notRunBreakdown} />
      );
      const { measure, wrap } = getMeasureAndWrap(container);
      setRectWidth(measure, FULL_WIDTH);
      const ro =
        FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;

      // available + 0.5 >= 100 flips exactly between 99.4 (false) and 99.6
      // (true) -- 0.2px apart, well inside real sub-pixel jitter range, and
      // both readings fall inside the post-fix hysteresis band (dropping
      // requires available < 100; returning requires available >= 100 +
      // COLLAPSE_HYSTERESIS_PX), so neither can cross back once settled.
      const belowThreshold = 99.4;
      const aboveThreshold = 99.6;

      let transitions = 0;
      let last =
        screen.queryByTestId("requirement-coverage-status-word") !== null;
      for (let i = 0; i < 20; i++) {
        setRectWidth(wrap, i % 2 === 0 ? belowThreshold : aboveThreshold);
        ro.trigger();
        const current =
          screen.queryByTestId("requirement-coverage-status-word") !== null;
        if (current !== last) {
          transitions += 1;
          last = current;
        }
      }

      expect(transitions).toBeLessThanOrEqual(1);
    });

    it("drops the status word on the way down but withholds it until width clears the hysteresis band on the way back up", () => {
      const { container } = render(
        <RequirementCoverageBadge breakdown={notRunBreakdown} />
      );
      const { measure, wrap } = getMeasureAndWrap(container);
      setRectWidth(measure, FULL_WIDTH);
      const ro =
        FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;

      // Start comfortably wide.
      setRectWidth(wrap, FULL_WIDTH + 50);
      ro.trigger();
      expect(
        screen.getByTestId("requirement-coverage-status-word")
      ).toBeInTheDocument();

      // Sweep down across the threshold -- drops immediately, no delay.
      setRectWidth(wrap, FULL_WIDTH - 10);
      ro.trigger();
      expect(
        screen.queryByTestId("requirement-coverage-status-word")
      ).toBeNull();

      // Sweep back up, but only just past the (pre-hysteresis) threshold --
      // must NOT return yet.
      setRectWidth(wrap, FULL_WIDTH + 1);
      ro.trigger();
      expect(
        screen.queryByTestId("requirement-coverage-status-word")
      ).toBeNull();

      // Clear the full hysteresis band -- now it returns.
      setRectWidth(wrap, FULL_WIDTH + COLLAPSE_HYSTERESIS_PX + 1);
      ro.trigger();
      expect(
        screen.getByTestId("requirement-coverage-status-word")
      ).toBeInTheDocument();
    });
  });
});
