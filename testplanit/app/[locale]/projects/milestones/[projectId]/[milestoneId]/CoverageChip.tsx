"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import {
  IterationStatusPip,
  resolvePipColor,
} from "@/components/iterations/IterationStatusPip";

export interface CoverageBreakdown {
  linkedCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
}

/**
 * Coverage pip colors come from the project's real Test-Run statuses (the
 * same admin-configured colors the Parameterized Test Iteration Matrix
 * uses): passed = first isSuccess status, failed = first isFailure status.
 * Untested falls back to the pip's notStarted semantic token.
 */
export function useCoveragePipColors(projectId: number): {
  passed?: string;
  failed?: string;
} {
  const { data: statuses } = useClientQueries(schema).status.useFindMany({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        { projects: { some: { projectId: Number(projectId) } } },
        { scope: { some: { scope: { name: "Test Run" } } } },
      ],
    },
    include: { color: { select: { value: true } } },
    orderBy: { order: "asc" },
  });

  return {
    passed: statuses?.find((status) => status.isSuccess)?.color?.value,
    failed: statuses?.find((status) => status.isFailure)?.color?.value,
  };
}

interface CoverageChipProps {
  breakdown: CoverageBreakdown | undefined;
  /** Status-driven pip colors (useCoveragePipColors). */
  pipColors?: { passed?: string; failed?: string };
  className?: string;
}

/**
 * Per-issue coverage display for the Member Issues table (MLINK-04,
 * D-04/D-05), rendered the way the Parameterized Test Iteration Matrix
 * shows results: status pips (project status colors) with counts —
 * Passed / Failed / Untested — plus the shared status legend at the
 * section level. In-progress executions count toward Untested (no
 * completed outcome yet); the tooltip carries the full breakdown.
 * Issues with no linked cases keep the visually distinct "Uncovered"
 * chip (outlined/amber) — a gap warning, not another result color (D-05).
 */
export function CoverageChip({
  breakdown,
  pipColors,
  className,
}: CoverageChipProps) {
  const t = useTranslations("milestones.members");

  if (!breakdown || breakdown.uncovered) {
    return (
      <Badge
        variant="outline"
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

  const untested = breakdown.notRun + breakdown.inProgress;
  const segments: Array<{
    key: string;
    label: string;
    count: number;
    color: string;
  }> = [
    {
      key: "passed",
      label: t("coveragePassed"),
      count: breakdown.passed,
      color: resolvePipColor("passed", pipColors?.passed),
    },
    {
      key: "failed",
      label: t("coverageFailed"),
      count: breakdown.failed,
      color: resolvePipColor("failed", pipColors?.failed),
    },
    {
      key: "untested",
      label: t("coverageUntested"),
      count: untested,
      color: resolvePipColor("notStarted"),
    },
  ].filter((segment) => segment.count > 0);

  const tooltip = [
    `${t("coveragePassed")}: ${breakdown.passed}`,
    `${t("coverageFailed")}: ${breakdown.failed}`,
    `${t("coverageInProgress")}: ${breakdown.inProgress}`,
    `${t("coverageNotRun")}: ${breakdown.notRun}`,
  ].join(" · ");

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
