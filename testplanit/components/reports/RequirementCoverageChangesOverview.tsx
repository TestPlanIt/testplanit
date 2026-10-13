"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  REQUIREMENT_COVERAGE_CHANGE_KINDS,
  summarizeCoverageChanges,
  type RequirementCoverageChangeRow,
} from "~/lib/services/requirementTraceabilitySnapshotShape";
import { REQUIREMENT_COVERAGE_CHART_COLORS } from "./RequirementCoverageOverview";

/**
 * The coverage-changes report's visualization panel: the headline
 * transitions (newly covered / newly uncovered / now failing / no longer
 * failing) as tiles, and the per-kind breakdown of the rows below. Every
 * number derives from the SAME rows the table shows, through the pure
 * `summarizeCoverageChanges`, so the panel can never disagree with it.
 * Tiles pair a status-colored dot WITH a label — never color alone.
 */
export function RequirementCoverageChangesOverview({
  rows,
}: {
  rows: RequirementCoverageChangeRow[];
}) {
  const t = useTranslations("reports.ui.requirementCoverage");
  const locale = useLocale();

  const summary = useMemo(() => summarizeCoverageChanges(rows), [rows]);
  const changed = rows.length - summary.byKind.UNCHANGED;
  const formatCount = (value: number) => value.toLocaleString(locale);

  const kindLabel = (kind: string) => {
    switch (kind) {
      case "ADDED":
        return t("changeAdded");
      case "REMOVED":
        return t("changeRemoved");
      case "COVERAGE_CHANGED":
        return t("changeCoverage");
      case "LINKS_CHANGED":
        return t("changeLinks");
      case "RESULTS_CHANGED":
        return t("changeResults");
      default:
        return t("changeUnchanged");
    }
  };

  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    dotColor?: string;
  }> = [
    { key: "changed", label: t("changedRequirements"), value: changed },
    {
      key: "newly-covered",
      label: t("newlyCovered"),
      value: summary.newlyCovered,
      dotColor: REQUIREMENT_COVERAGE_CHART_COLORS.PASSED,
    },
    {
      key: "newly-uncovered",
      label: t("newlyUncovered"),
      value: summary.newlyUncovered,
      dotColor: REQUIREMENT_COVERAGE_CHART_COLORS.UNCOVERED,
    },
    {
      key: "now-failing",
      label: t("nowFailing"),
      value: summary.nowFailing,
      dotColor: REQUIREMENT_COVERAGE_CHART_COLORS.FAILED,
    },
    {
      key: "no-longer-failing",
      label: t("noLongerFailing"),
      value: summary.noLongerFailing,
      dotColor: REQUIREMENT_COVERAGE_CHART_COLORS.NOT_RUN,
    },
  ];

  const kinds = REQUIREMENT_COVERAGE_CHANGE_KINDS.filter(
    (kind) => summary.byKind[kind] > 0
  );
  const maxKind = Math.max(...kinds.map((kind) => summary.byKind[kind]), 1);

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4"
      data-testid="requirement-coverage-changes-overview"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="rounded-md border bg-card px-3 py-2"
            data-testid={`requirement-changes-tile-${tile.key}`}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {tile.dotColor ? (
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: tile.dotColor }}
                />
              ) : null}
              <span className="truncate">{tile.label}</span>
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">
              {formatCount(tile.value)}
            </div>
          </div>
        ))}
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        data-testid="requirement-changes-by-kind"
      >
        <div className="mb-2 text-sm font-bold">{t("byChangeKind")}</div>
        <div className="space-y-1 pr-2">
          {kinds.map((kind) => (
            <div
              key={kind}
              className="flex items-center gap-2"
              data-testid={`requirement-changes-kind-${kind.toLowerCase()}`}
            >
              <span className="w-[160px] shrink-0 truncate text-xs">
                {kindLabel(kind)}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className="h-4 rounded-[2px] bg-primary/70"
                  style={{
                    width: `${Math.max((summary.byKind[kind] / maxKind) * 100, 2)}%`,
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {formatCount(summary.byKind[kind])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
