"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";

export interface CoverageBreakdown {
  linkedCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
}

interface CoverageChipProps {
  breakdown: CoverageBreakdown | undefined;
  className?: string;
}

/**
 * Per-issue coverage breakdown display for the Member Issues table
 * (MLINK-04, D-04/D-05). Renders a compact row of result-state counts, or a
 * visually distinct "Uncovered" chip (outlined/amber) when the issue has no
 * linked test cases at all — a gap warning, not another result color (D-05).
 */
export function CoverageChip({ breakdown, className }: CoverageChipProps) {
  const t = useTranslations("milestones.members");

  if (!breakdown || breakdown.uncovered) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "whitespace-nowrap border-dashed border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400",
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
    className: string;
  }> = [
    {
      key: "passed",
      label: t("coveragePassed"),
      count: breakdown.passed,
      className: "text-green-700 dark:text-green-400",
    },
    {
      key: "failed",
      label: t("coverageFailed"),
      count: breakdown.failed,
      className: "text-red-700 dark:text-red-400",
    },
    {
      key: "inProgress",
      label: t("coverageInProgress"),
      count: breakdown.inProgress,
      className: "text-blue-700 dark:text-blue-400",
    },
    {
      key: "notRun",
      label: t("coverageNotRun"),
      count: breakdown.notRun,
      className: "text-muted-foreground",
    },
  ].filter((segment) => segment.count > 0);

  if (segments.length === 0) {
    return (
      <Badge variant="outline" className={cn("whitespace-nowrap", className)}>
        {t("coverageNotRun")}: {breakdown.linkedCaseCount}
      </Badge>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("text-xs font-medium whitespace-nowrap", segment.className)}
          title={segment.label}
        >
          {segment.label}: {segment.count}
        </span>
      ))}
    </div>
  );
}
