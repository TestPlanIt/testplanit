"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import {
  IterationStatusPip,
  resolvePipColor,
} from "@/components/iterations/IterationStatusPip";

export interface CoverageStatusCount {
  statusId: number;
  name: string;
  color: string | null;
  count: number;
}

export interface CoverageBreakdown {
  linkedCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
  statuses: CoverageStatusCount[];
  /** Explicit single Untested aggregate (Reports convention). */
  untested: number;
}

interface CoverageChipProps {
  breakdown: CoverageBreakdown | undefined;
  className?: string;
}

/**
 * Per-issue coverage display for the Member Issues table (MLINK-04,
 * D-04/D-05), using the Parameterized Test Iteration Matrix display model:
 * one status pip per ACTUAL project status among the linked cases' latest
 * in-scope results, tinted with the admin-configured status color, plus an
 * Untested pip (muted notStarted token) for linked cases with no in-scope
 * result. The shared IterationStatusLegendPopover at the section level
 * explains the colors — and now matches exactly, since any project status
 * can appear here.
 *
 * Issues with no linked cases keep the visually distinct "Uncovered" chip
 * (warning tokens) — a gap warning, not another result color (D-05).
 */
export function CoverageChip({ breakdown, className }: CoverageChipProps) {
  const t = useTranslations("milestones.members");
  const tCommon = useTranslations("common");

  const statuses = breakdown?.statuses ?? [];
  // Single explicit Untested aggregate from the API (Reports convention):
  // missing results + no-status/non-completed results + system 'untested'.
  const untested = breakdown?.untested ?? 0;

  // Uncovered = no COMPLETED test outcome in scope: either the issue has
  // no linked cases at all, or none of its linked cases has a completed
  // in-scope result. The tooltip keeps the untested count so "cases exist
  // but were never executed here" stays visible.
  if (!breakdown || breakdown.uncovered || statuses.length === 0) {
    const tooltip =
      breakdown && breakdown.linkedCaseCount > 0
        ? `${tCommon("labels.untested")}: ${untested}`
        : undefined;
    return (
      <Badge
        variant="outline"
        title={tooltip}
        className={cn(
          // Theme-adaptive warning tokens (see components/ui/warning-alert.tsx) —
          // hardcoded ambers were unreadable on several light themes.
          "whitespace-nowrap border-dashed border-warning bg-warning/15 text-foreground",
          className
        )}
      >
        {t("coverageUncovered")}
      </Badge>
    );
  }

  const segments: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
  }> = [
    ...statuses.map((entry) => ({
      key: `status-${entry.statusId}`,
      label: entry.name,
      count: entry.count,
      color: resolvePipColor("passed", entry.color ?? undefined),
    })),
    {
      key: "untested",
      label: tCommon("labels.untested"),
      count: untested,
      color: resolvePipColor("notStarted"),
    },
  ].filter((segment) => segment.count > 0);

  const tooltip = segments
    .map((segment) => `${segment.label}: ${segment.count}`)
    .join(" \u00b7 ");

  return (
    <div
      className={cn("flex items-center gap-3 flex-wrap", className)}
      title={tooltip}
      data-testid="coverage-pips"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className="flex items-center gap-1 text-xs font-medium whitespace-nowrap"
          aria-label={`${segment.label}: ${segment.count}`}
        >
          <IterationStatusPip glyph="passed" statusColor={segment.color} />
          {segment.count}
        </span>
      ))}
    </div>
  );
}
