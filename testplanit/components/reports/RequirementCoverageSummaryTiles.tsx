"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { cn } from "~/utils";
import { REQUIREMENT_COVERAGE_CHART_COLORS } from "./RequirementCoverageOverview";

/**
 * Overview stat tiles for the Requirement Traceability report — the
 * per-REQUIREMENT headline the pair-level rows can't give a reader at a
 * glance (a requirement with eight covering cases is eight rows below,
 * but one requirement here).
 *
 * A tile row, deliberately not a chart: four mutually-exclusive states of
 * one whole is a headline, not a trend. Counts dedupe by `requirementId`
 * (every row of a requirement carries the same `coverageStatus`), state
 * tiles pair a status-colored dot WITH its label (never color alone), the
 * numbers wear text tokens and the app locale.
 */

interface SummaryRow {
  requirementId: number;
  coverageStatus?: string;
}

// One entry per state, in the SHARED state order the donut's arcs and the
// hierarchy bars use, with the SAME validated hex per state
// (REQUIREMENT_COVERAGE_CHART_COLORS) — the tiles double as the charts'
// legend, and a legend whose swatch drifts from the mark it names is
// worse than no legend.
const STATE_TILES: Array<{ status: string; labelKey: string }> = [
  { status: "PASSED", labelKey: "statusPassed" },
  { status: "NOT_RUN", labelKey: "statusNotRun" },
  { status: "UNCOVERED", labelKey: "uncovered" },
  { status: "FAILED", labelKey: "statusFailed" },
];

export function RequirementCoverageSummaryTiles({
  rows,
  className,
  compact = false,
}: {
  rows: SummaryRow[];
  /** Grid column classes for the hosting layout; the standalone default
   * spreads six tiles across a wide row. */
  className?: string;
  /** Dense single-line rows beside a chart, instead of headline cards. */
  compact?: boolean;
}) {
  const t = useTranslations("requirements.coverage");
  const tReports = useTranslations("reports.ui.requirementCoverage");
  const tCommon = useTranslations("common.fields");
  const locale = useLocale();

  const summary = useMemo(() => {
    const statusById = new Map<number, string>();
    for (const row of rows) {
      if (!statusById.has(row.requirementId)) {
        statusById.set(row.requirementId, row.coverageStatus ?? "UNCOVERED");
      }
    }
    const counts: Record<string, number> = {
      PASSED: 0,
      FAILED: 0,
      NOT_RUN: 0,
      UNCOVERED: 0,
    };
    for (const status of statusById.values()) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const total = statusById.size;
    const covered = total - counts.UNCOVERED;
    return { total, covered, counts };
  }, [rows]);

  if (summary.total === 0) {
    return null;
  }

  const coveredPercent = Math.round((summary.covered / summary.total) * 100);
  const formatCount = (value: number) => value.toLocaleString(locale);

  return (
    <div
      className={cn(
        "grid gap-2",
        className ?? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
      )}
      data-testid="requirement-coverage-summary"
    >
      <SummaryTile
        label={tCommon("requirements")}
        value={formatCount(summary.total)}
        testId="requirement-summary-total"
        compact={compact}
      />
      <SummaryTile
        label={tReports("covered")}
        value={formatCount(summary.covered)}
        detail={`${coveredPercent.toLocaleString(locale)}%`}
        testId="requirement-summary-covered"
        compact={compact}
      />
      {STATE_TILES.map((tile) => (
        <SummaryTile
          key={tile.status}
          label={t(tile.labelKey)}
          value={formatCount(summary.counts[tile.status] ?? 0)}
          dotColor={REQUIREMENT_COVERAGE_CHART_COLORS[tile.status]}
          testId={`requirement-summary-${tile.status.toLowerCase()}`}
          compact={compact}
        />
      ))}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  dotColor,
  testId,
  compact = false,
}: {
  label: string;
  value: string;
  detail?: string;
  dotColor?: string;
  testId: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        className="flex items-center gap-1.5 rounded border bg-card px-2 py-1"
        data-testid={testId}
      >
        {dotColor ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
        ) : null}
        {detail ? (
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {detail}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums">{value}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card px-3 py-2" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dotColor ? (
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
        ) : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
