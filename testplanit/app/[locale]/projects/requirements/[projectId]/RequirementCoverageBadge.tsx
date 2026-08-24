"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  IterationStatusPip,
  resolvePipColor,
  type IterationStatusGlyph,
} from "@/components/iterations/IterationStatusPip";
import { cn } from "~/utils";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

interface RequirementCoverageBadgeProps {
  breakdown: RequirementCoverageBreakdown | undefined;
  className?: string;
}

/**
 * The tree row's shrink weight for this badge (D-1, locked). Flexbox
 * distributes a deficit proportionally to shrink x basis across every
 * shrinkable sibling SIMULTANEOUSLY — there is no sequential ladder — so
 * with three competitors on the row (the provenance badge, this badge, and
 * the requirement name) the weights ARE the priority and must be chosen,
 * not inherited:
 *
 *   | Element            | Shrink | Floor     | Share of a deficit |
 *   |--------------------|--------|-----------|---------------------|
 *   | provenance badge   | 999    | min-w-8   | ~95%                |
 *   | coverage badge     | 50     | min-w-24  | ~4.8%               |
 *   | requirement name   | 1      | min-w-0   | ~0.1%               |
 *
 * Provenance still absorbs the overwhelming majority of any deficit and
 * hits its own floor first; what's left then splits 50:1 in this badge's
 * favour, so its status word gives way before the requirement's title loses
 * a character. 26-13's operator UAT confirmed the WEIGHTS are wired
 * correctly and refuted only the FLOOR and the missing collapse STEP (see
 * `COVERAGE_BADGE_MIN_WIDTH_PX` and `showStatusWord` below) — do not "fix"
 * the 50 back to 999.
 */
export const COVERAGE_BADGE_SHRINK = 50;

/**
 * Tailwind's static scanner needs this arbitrary-value utility to appear as
 * literal text in the source file — every other `shrink-[N]` class in this
 * codebase (RequirementProvenanceBadge, MilestoneSourceBadge, TestRunCasesSummary)
 * is hardcoded for the identical reason, since a class built from a runtime
 * template literal (`` `shrink-[${COVERAGE_BADGE_SHRINK}]` ``) never appears
 * as that literal text and silently generates no CSS rule at all. The
 * dev-only assertion right below is what keeps this literal and the
 * exported constant above from silently drifting apart instead.
 */
const COVERAGE_BADGE_SHRINK_CLASSNAME = "shrink-[50]";
if (
  process.env.NODE_ENV !== "production" &&
  COVERAGE_BADGE_SHRINK_CLASSNAME !== `shrink-[${COVERAGE_BADGE_SHRINK}]`
) {
  throw new Error(
    "RequirementCoverageBadge: COVERAGE_BADGE_SHRINK and COVERAGE_BADGE_SHRINK_CLASSNAME have drifted apart"
  );
}

/**
 * 26-13's operator UAT (Scenario 2, Finding 1 — BLOCKING) found the old
 * `min-w-[3rem]` (48px) floor sat BELOW this badge's own minimum realistic
 * content width on real data: the "Uncovered" word alone measured 83px, and
 * pip+count-only content (e.g. "0/10") measures well above 48px once
 * padding, border and the pip glyph are counted. Below that floor,
 * `overflow-hidden` was hard-clipping text mid-word ("Uncovered" -> "Uncov",
 * "0/10" -> "0/1(") instead of degrading through a discrete step.
 *
 * 96px comfortably clears the widest measured single-content case
 * ("Uncovered" at 83px) with headroom for the pip+count-only rendering this
 * badge now falls back to once `showStatusWord` below drops the status word
 * (see the layout effect), while still sitting well below the widest
 * measured FULL content ("0/10 · Not run" at 116px) so the drop step
 * remains reachable rather than the badge always rendering at full size.
 */
export const COVERAGE_BADGE_MIN_WIDTH_PX = 96;

/**
 * Same static-scanner constraint as `COVERAGE_BADGE_SHRINK_CLASSNAME` above,
 * and the same dev-only drift guard. `min-w-24` is Tailwind's own spacing
 * scale (`calc(var(--spacing) * 24)`, 4px per step by default) rather than
 * an arbitrary bracketed value — no interpolation risk on the class itself,
 * but the PX constant above can still drift from the multiplier below, so
 * the assertion stays.
 */
const COVERAGE_BADGE_MIN_WIDTH_CLASSNAME = "min-w-24";
if (
  process.env.NODE_ENV !== "production" &&
  COVERAGE_BADGE_MIN_WIDTH_CLASSNAME !==
    `min-w-${COVERAGE_BADGE_MIN_WIDTH_PX / 4}`
) {
  throw new Error(
    "RequirementCoverageBadge: COVERAGE_BADGE_MIN_WIDTH_PX and COVERAGE_BADGE_MIN_WIDTH_CLASSNAME have drifted apart"
  );
}

/**
 * The actual flex item competing on the tree row. `flex-col items-start` is
 * what lets the in-flow measuring copy below hold this wrapper's requested
 * width at the FULL (count + status word) size while the visible badge has
 * already dropped to count-only — the wrapper's own width becomes the max
 * of its two stacked children rather than their sum, identical to (and for
 * the identical reason as) `RequirementProvenanceBadge`'s own `collapsible`
 * wrapper. `overflow-hidden` here is the outer clip boundary; the visible
 * `Badge` no longer needs to carry the shrink/min-w classes itself now that
 * a wrapper exists to own them.
 */
const WRAPPER_CLASSNAME = cn(
  "flex flex-col items-start overflow-hidden",
  COVERAGE_BADGE_MIN_WIDTH_CLASSNAME,
  COVERAGE_BADGE_SHRINK_CLASSNAME
);

/**
 * D-1's four-state tree-row coverage indicator: a covered/total count
 * alongside a status chip, e.g. "3/7 · Failed". Presentation only — it
 * switches on `RequirementCoverageBreakdown.status`/`.uncovered` exactly as
 * `classifyRequirementCoverage` already computed them and never re-derives
 * the failed-anywhere-wins ladder itself.
 *
 * Deliberately imports nothing from `CoverageChip.tsx`. That component's
 * `hasCompletedCoverage` reads `breakdown.statuses?.length ?? 0`, and this
 * breakdown shape carries no `statuses` array, so casting one into the
 * other would make every requirement read "Uncovered" — including passing
 * ones — with no crash and no type error. Only the visual conventions
 * (the dashed warning treatment, the `·`-joined tooltip idiom, the pip
 * vocabulary) are reused here; none of the code is.
 *
 * Passes no sizing classes from a caller into the layout — like the
 * provenance badge, this component owns its own shrink weight and width
 * floor so the tree row's collapse priority is a property of this file,
 * not of whoever mounts it. `className` (when a future caller passes one)
 * now lands on the wrapper span, the actual flex item, not the inner
 * `Badge`.
 */
export function RequirementCoverageBadge({
  breakdown,
  className,
}: RequirementCoverageBadgeProps) {
  const t = useTranslations("requirements.coverage");

  const wrapRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  // The status word fits until proven otherwise; the layout effect below
  // narrows it before paint once the row has actually squeezed this badge
  // below its own full (count + status word) content width. Mirrors
  // `RequirementProvenanceBadge`'s identical "start expanded, collapse
  // before paint" approach, for the identical reason: jsdom returns 0 from
  // `getBoundingClientRect()`, so `compute()` below bails out and this stays
  // `true` in every unit test — visual confirmation is 26-13's operator UAT,
  // which is what found the previous version never took this step at all.
  const [showStatusWord, setShowStatusWord] = useState(true);

  // Progressive collapse, second step: as the row squeezes this badge past
  // its own full content width, drop the "· <status word>" segment entirely
  // rather than letting `overflow-hidden` clip it mid-word (26-13 Finding
  // 1). The invisible, in-flow, zero-height measuring copy rendered below
  // is what makes this possible without also destabilizing the ROW's own
  // shrink computation: it always renders the FULL content, so this
  // wrapper keeps requesting its full width from the row regardless of
  // `showStatusWord`, and only the visible copy's own rendering changes.
  // An absolutely-positioned measuring copy would stop doing that the
  // instant the status word first dropped, handing the reclaimed space
  // back to the row and letting the badge and the requirement's name
  // renegotiate — which is backwards, since this badge still owns that
  // space up to its own floor.
  useLayoutEffect(() => {
    if (!breakdown || breakdown.status === "UNCOVERED") return;
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure || typeof ResizeObserver === "undefined") return;

    const compute = () => {
      const full = measure.getBoundingClientRect().width;
      if (full === 0) return; // hidden, or a non-visual environment
      const available = wrap.getBoundingClientRect().width;
      setShowStatusWord(available + 0.5 >= full);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [breakdown]);

  // Coverage that has not loaded yet (or failed to load) renders nothing —
  // it must never be mistaken for a gap. A dedicated `uncovered` field
  // exists precisely so a consumer never has to infer "no coverage" from
  // an absent or zeroed-out count.
  if (!breakdown) return null;

  if (breakdown.status === "UNCOVERED") {
    return (
      <Badge
        data-testid="requirement-coverage-uncovered"
        variant="outline"
        title={t("uncoveredTooltip")}
        className={cn(
          COVERAGE_BADGE_MIN_WIDTH_CLASSNAME,
          "overflow-hidden",
          COVERAGE_BADGE_SHRINK_CLASSNAME,
          // Theme-adaptive warning tokens (see components/ui/warning-alert.tsx) —
          // hardcoded ambers were unreadable on several light themes.
          "whitespace-nowrap border-dashed border-warning bg-warning/15 text-foreground",
          className
        )}
      >
        {t("uncovered")}
      </Badge>
    );
  }

  const { passed, failed, inProgress, notRun, linkedCaseCount, status } =
    breakdown;

  // The count is `passed` over `linkedCaseCount`, never `failed` over
  // `linkedCaseCount`. The four counters are per-case and always sum to
  // `linkedCaseCount`; `passed` is the only one of them whose ratio moves
  // monotonically with readiness. "Failed-wins" precedence is already
  // carried by the status word right beside the count — putting `failed`
  // in the numerator would say the same thing twice, and read backwards
  // while doing it (a bigger number reading as "worse").
  const glyph: IterationStatusGlyph =
    status === "PASSED"
      ? "passed"
      : status === "FAILED"
        ? "failed"
        : "notStarted";
  const pipColor =
    status === "PASSED"
      ? resolvePipColor("passed", "hsl(var(--success))")
      : status === "FAILED"
        ? resolvePipColor("failed", "hsl(var(--destructive))")
        : resolvePipColor("notStarted");
  const statusLabel =
    status === "PASSED"
      ? t("statusPassed")
      : status === "FAILED"
        ? t("statusFailed")
        : t("statusNotRun");
  const countLabel = t("countLabel", { passed, total: linkedCaseCount });

  // Full breakdown, `·`-joined (CoverageChip.tsx's tooltip idiom, copied
  // verbatim) — available on hover and to a screen reader without widening
  // the row. Carried on the visible `Badge` unconditionally, so the
  // accessible name never degrades even when `showStatusWord` drops the
  // visible status word.
  const fullBreakdown = t("breakdownTooltip", {
    passed,
    failed,
    inProgress,
    notRun,
  });

  return (
    <span ref={wrapRef} className={cn(WRAPPER_CLASSNAME, className)}>
      {/* In-flow, zero-height, invisible copy of the FULL badge (count AND
          status word both present). Never actually seen — its only job is
          to hold this wrapper's requested width open at the full,
          un-collapsed size regardless of `showStatusWord`, exactly like
          `RequirementProvenanceBadge`'s own measuring copy and for the
          identical reason (see the layout effect's comment above). Reuses
          the visible badge's own classes so its measured width matches
          what the visible badge would actually render at full size. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible h-0 overflow-hidden"
      >
        <Badge
          variant="outline"
          className="flex items-center gap-1 whitespace-nowrap text-foreground"
        >
          <IterationStatusPip glyph={glyph} statusColor={pipColor} />
          <span>{countLabel}</span>
          <span>{"·"}</span>
          <span>{statusLabel}</span>
        </Badge>
      </span>
      <Badge
        data-testid={`requirement-coverage-${status.toLowerCase()}`}
        variant="outline"
        title={fullBreakdown}
        aria-label={fullBreakdown}
        className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-foreground"
      >
        <IterationStatusPip glyph={glyph} statusColor={pipColor} />
        {/* The count never truncates and never shares an element with the
            status word — 26-13 Finding 1 was the count itself clipping
            ("0/10" -> "0/1(") because the old version had nothing else left
            to drop. Now the status word below is what drops first, in its
            own segment, well before the row could ever squeeze this span. */}
        <span className="shrink-0" data-testid="requirement-coverage-count">
          {countLabel}
        </span>
        {showStatusWord && (
          <span
            className="flex shrink-0 items-center gap-1"
            data-testid="requirement-coverage-status-word"
          >
            <span aria-hidden="true">{"·"}</span>
            <span>{statusLabel}</span>
          </span>
        )}
      </Badge>
    </span>
  );
}
