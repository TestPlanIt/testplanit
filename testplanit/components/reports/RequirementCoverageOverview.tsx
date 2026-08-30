"use client";

import TestRunResultsDonut from "@/components/dataVisualizations/TestRunResultsDonut";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import { useMemo } from "react";
import { formatRequirementCellText } from "~/utils/issueDisplayText";
import { RequirementCoverageSummaryTiles } from "./RequirementCoverageSummaryTiles";

/**
 * The Requirement Traceability report's visualization panel: a donut of
 * the four coverage states with the requirement total in the hole, the
 * stat tiles (which double as the donut's legend — same colors, labeled),
 * and a "coverage by top-level requirement" stacked-bar breakdown — the
 * hierarchy-aware view that answers "which areas are least covered?"
 * without a sunburst (a tracker-imported forest has thousands of roots;
 * see the 2026-08-30 design discussion).
 *
 * All three read the SAME rows the table renders, deduped per
 * requirement, so the panel can never disagree with the table.
 *
 * Colors are a STATUS palette validated with the dataviz six-checks
 * script for both surfaces: every adjacent pair in the shared state
 * order clears CVD ΔE ≥ 8 (Failed is red-600, not red-500 — red-500
 * sits too close to both the amber and the green for deutan/protan
 * readers). The deliberate neutral gray reads gray by design. Green and
 * amber sit below 3:1 contrast on the light surface, which obligates
 * visible labels — the tiles, tooltips, and the table below carry them.
 */

export const REQUIREMENT_COVERAGE_CHART_COLORS: Record<string, string> = {
  PASSED: "#22c55e",
  NOT_RUN: "#6b7280",
  UNCOVERED: "#f59e0b",
  FAILED: "#dc2626",
};

/** One shared state order for the donut's arcs and the bars' segments —
 * chosen so every ADJACENT color pair (including the donut's wrap-around)
 * passes the CVD separation check. Reordering this is a palette change:
 * re-run the validator on the new adjacencies. */
export const REQUIREMENT_COVERAGE_STATE_ORDER = [
  "PASSED",
  "NOT_RUN",
  "UNCOVERED",
  "FAILED",
] as const;

const TOP_HIERARCHY_LIMIT = 10;

interface OverviewRow {
  requirementId: number;
  coverageStatus?: string;
  requirementParentPath?: string;
  requirementKey?: string;
  requirementTitle?: string | null;
  requirementRootId?: number;
}

export interface HierarchyGroup {
  label: string;
  counts: Record<string, number>;
  total: number;
  /** The root requirement's own id, when the root itself appeared as a
   * row (a group discovered only through descendants has none) — makes
   * the bar's label a link to the requirement. */
  requirementId?: number;
}

export function stateLabel(t: (key: string) => string, status: string): string {
  switch (status) {
    case "PASSED":
      return t("statusPassed");
    case "FAILED":
      return t("statusFailed");
    case "NOT_RUN":
      return t("statusNotRun");
    default:
      return t("uncovered");
  }
}

export function RequirementCoverageOverview({ rows }: { rows: OverviewRow[] }) {
  const t = useTranslations("requirements.coverage");
  const tReports = useTranslations("reports.ui.requirementCoverage");

  const { donutData, groups, foldedCount } = useMemo(() => {
    // Dedupe to one entry per requirement; its root is the first segment
    // of the ancestors-only parent path, or the requirement itself when
    // it IS top-level.
    const byRequirement = new Map<
      number,
      { status: string; root: string; rootId?: number }
    >();
    for (const row of rows) {
      if (byRequirement.has(row.requirementId)) continue;
      const isRoot = !row.requirementParentPath;
      const root = isRoot
        ? formatRequirementCellText(row)
        : row.requirementParentPath!.split(" > ")[0];
      byRequirement.set(row.requirementId, {
        status: row.coverageStatus ?? "UNCOVERED",
        root,
        // The server-supplied root id links the bar label even when the
        // root has no row of its own; a root row's own id is the
        // fallback for older payloads.
        rootId:
          row.requirementRootId ?? (isRoot ? row.requirementId : undefined),
      });
    }

    const stateCounts: Record<string, number> = {};
    const groupsByRoot = new Map<string, HierarchyGroup>();
    for (const { status, root, rootId } of byRequirement.values()) {
      stateCounts[status] = (stateCounts[status] ?? 0) + 1;
      let group = groupsByRoot.get(root);
      if (!group) {
        group = { label: root, counts: {}, total: 0 };
        groupsByRoot.set(root, group);
      }
      if (group.requirementId == null && rootId != null) {
        group.requirementId = rootId;
      }
      group.counts[status] = (group.counts[status] ?? 0) + 1;
      group.total += 1;
    }

    const donutData = REQUIREMENT_COVERAGE_STATE_ORDER.filter(
      (status) => (stateCounts[status] ?? 0) > 0
    ).map((status) => ({
      id: status,
      name: stateLabel(t, status),
      value: stateCounts[status],
      color: REQUIREMENT_COVERAGE_CHART_COLORS[status],
    }));

    const ranked = [...groupsByRoot.values()].sort(
      (a, b) => b.total - a.total || a.label.localeCompare(b.label)
    );
    const top = ranked.slice(0, TOP_HIERARCHY_LIMIT);
    const folded = ranked.slice(TOP_HIERARCHY_LIMIT);
    if (folded.length > 0) {
      const other: HierarchyGroup = { label: "", counts: {}, total: 0 };
      for (const group of folded) {
        for (const [status, count] of Object.entries(group.counts)) {
          other.counts[status] = (other.counts[status] ?? 0) + count;
        }
        other.total += group.total;
      }
      top.push(other);
    }

    return { donutData, groups: top, foldedCount: folded.length };
  }, [rows, t]);

  if (donutData.length === 0) {
    return null;
  }

  // The tail fold is a footnote row, not a bar: in a mostly-flat project
  // "Other" holds thousands of single-requirement roots and would own the
  // length scale, crushing every REAL hierarchy's bar into a sliver. So
  // bars scale against the largest real hierarchy, and Other reports its
  // numbers as text.
  const realGroups = groups.filter((group) => group.label !== "");
  const otherGroup = groups.find((group) => group.label === "");

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 xl:flex-row"
      data-testid="requirement-coverage-overview"
    >
      {/* Donut with compact stat rows beside it (operator direction
          2026-08-30: the donut gets the room, the numbers stay but small).
          labelScale shrinks the donut's own arc/center text. */}
      <div className="flex shrink-0 items-start gap-3">
        <div className="h-full min-h-[220px] w-[280px] shrink-0">
          <TestRunResultsDonut data={donutData} height={260} labelScale={0.7} />
        </div>
        <div className="w-[190px] shrink-0 space-y-1">
          <RequirementCoverageSummaryTiles
            rows={rows}
            className="grid-cols-1"
            compact
          />
        </div>
      </div>

      {/* One separator between the two graphs, matching the stacking
          axis: vertical beside the bars in the wide layout, horizontal
          above them when the panel stacks. */}
      <Separator orientation="vertical" className="hidden xl:block" />
      <Separator className="xl:hidden" />

      <RequirementHierarchyBars
        heading={tReports("byHierarchy")}
        groups={realGroups}
        states={REQUIREMENT_COVERAGE_STATE_ORDER}
        otherLabel={
          otherGroup ? tReports("otherRoots", { count: foldedCount }) : null
        }
        otherTotal={otherGroup?.total ?? null}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
        containerTestId="requirement-top-hierarchies"
        barTestIdPrefix="requirement-hierarchy-bar"
        segmentTestIdPrefix="hierarchy-segment"
        otherTestId="requirement-hierarchy-other"
      />
    </div>
  );
}

/**
 * The stacked-bar list both requirement report panels share: one bar per
 * group, LENGTH relative to the largest group (never a 100%-stacked bar
 * that hides magnitude), segments in the validated state order/palette,
 * and an optional bar-less footnote row for a folded tail (a tail bar
 * would own the length scale — see the fold rationale above). Groups
 * render in the order given; sorting/folding is the caller's job.
 */
export function RequirementHierarchyBars({
  heading,
  groups,
  states,
  otherLabel,
  otherTotal,
  className,
  containerTestId,
  barTestIdPrefix,
  segmentTestIdPrefix,
  otherTestId,
}: {
  heading: string;
  groups: HierarchyGroup[];
  states: readonly string[];
  otherLabel?: string | null;
  otherTotal?: number | null;
  className?: string;
  containerTestId: string;
  barTestIdPrefix: string;
  segmentTestIdPrefix: string;
  otherTestId: string;
}) {
  const t = useTranslations("requirements.coverage");
  const locale = useLocale();
  const maxGroupTotal = Math.max(...groups.map((group) => group.total), 1);

  return (
    <div className={className} data-testid={containerTestId}>
      <div className="mb-2 text-sm font-bold">{heading}</div>
      <div className="space-y-1 pr-2">
        {groups.map((group, index) => {
          const label = group.label;
          return (
            <div
              className="flex items-center gap-2"
              key={group.label}
              data-testid={`${barTestIdPrefix}-${index}`}
            >
              {group.requirementId != null ? (
                <Link
                  href={`/requirement/${group.requirementId}`}
                  className="w-[220px] shrink-0 truncate text-xs hover:underline"
                  title={label}
                >
                  {label}
                </Link>
              ) : (
                <span
                  className="w-[220px] shrink-0 truncate text-xs"
                  title={label}
                >
                  {label}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div
                  className="flex h-4 gap-[2px]"
                  style={{
                    width: `${Math.max((group.total / maxGroupTotal) * 100, 2)}%`,
                  }}
                >
                  {states
                    .filter((status) => (group.counts[status] ?? 0) > 0)
                    .map((status) => (
                      <Tooltip key={status}>
                        <TooltipTrigger asChild>
                          <div
                            className="min-w-[3px] rounded-[2px]"
                            style={{
                              flexGrow: group.counts[status],
                              backgroundColor:
                                REQUIREMENT_COVERAGE_CHART_COLORS[status],
                            }}
                            data-testid={`${segmentTestIdPrefix}-${index}-${status.toLowerCase()}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {`${stateLabel(t, status)}: ${(group.counts[status] ?? 0).toLocaleString(locale)} (${Math.round(((group.counts[status] ?? 0) / group.total) * 100)}%)`}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {group.total.toLocaleString(locale)}
              </span>
            </div>
          );
        })}
        {otherLabel != null && otherTotal != null ? (
          <div
            className="flex items-center gap-2 pt-1 text-xs text-muted-foreground"
            data-testid={otherTestId}
          >
            <span className="w-[220px] shrink-0 truncate">{otherLabel}</span>
            <span className="min-w-0 flex-1" />
            <span className="w-14 shrink-0 text-right tabular-nums">
              {otherTotal.toLocaleString(locale)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
