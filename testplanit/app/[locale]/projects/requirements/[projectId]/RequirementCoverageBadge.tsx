"use client";

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
 *   | Element            | Shrink | Floor        | Share of a deficit |
 *   |--------------------|--------|--------------|---------------------|
 *   | provenance badge   | 999    | min-w-8      | ~95%                |
 *   | coverage badge     | 50     | min-w-[3rem] | ~4.8%               |
 *   | requirement name   | 1      | min-w-0      | ~0.1%               |
 *
 * Provenance still absorbs the overwhelming majority of any deficit and
 * hits its own floor first; what's left then splits 50:1 in this badge's
 * favour, so its status word truncates before the requirement's title
 * loses a character. The provenance badge now collapses somewhat LESS than
 * it did before this badge existed (~95% of a deficit instead of ~99.9%) —
 * that is the accepted, deliberate cost of showing a count and a status
 * per D-1, not a regression to chase. Do not "fix" the 50 back to 999.
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

const WRAPPER_CLASSNAME = cn(
  "min-w-[3rem] overflow-hidden",
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
 * not of whoever mounts it.
 */
export function RequirementCoverageBadge({
  breakdown,
  className,
}: RequirementCoverageBadgeProps) {
  const t = useTranslations("requirements.coverage");

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
          WRAPPER_CLASSNAME,
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
    status === "PASSED" ? "passed" : status === "FAILED" ? "failed" : "notStarted";
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

  // Full breakdown, `·`-joined (CoverageChip.tsx's tooltip idiom, copied
  // verbatim) — available on hover and to a screen reader without widening
  // the row.
  const fullBreakdown = t("breakdownTooltip", { passed, failed, inProgress, notRun });

  return (
    <Badge
      data-testid={`requirement-coverage-${status.toLowerCase()}`}
      variant="outline"
      title={fullBreakdown}
      aria-label={fullBreakdown}
      className={cn(
        WRAPPER_CLASSNAME,
        "flex items-center gap-1 whitespace-nowrap text-foreground",
        className
      )}
    >
      <IterationStatusPip glyph={glyph} statusColor={pipColor} />
      <span className="shrink-0">
        {t("countLabel", { passed, total: linkedCaseCount })}
      </span>
      <span aria-hidden="true" className="shrink-0">
        {"·"}
      </span>
      {/* `min-w-0` is what lets this span actually shrink below its own
          content width inside the badge's flex layout once the row's
          shrink-[50] squeezes the badge's own box — without it `truncate`'s
          ellipsis never engages and the badge just overflows instead. */}
      <span className="min-w-0 truncate">{statusLabel}</span>
    </Badge>
  );
}
