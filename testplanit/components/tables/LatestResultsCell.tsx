"use client";

import StatusDotDisplay from "@/components/StatusDotDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import type { TestResultExecution } from "~/lib/types/latestTestResults";

interface LatestResultsCellProps {
  /** Executions newest first, as returned by getLatestTestResultsByCase. */
  executions: TestResultExecution[];
  /** How many slots to draw; short histories are padded with empty ones. */
  slots: number;
  /** Project the case belongs to, used to link a square to its test run. */
  projectId?: number | string;
  testCaseId: number;
}

/**
 * A case's recent executions as a row of squares, newest first, each linking to
 * the run it came from. Older results fade so the most recent one reads first.
 *
 * Shared by the repository case list's Latest Results column and the Flaky Test
 * Report's execution history, so the two stay legible in the same way.
 */
export function LatestResultsCell({
  executions,
  slots,
  projectId,
  testCaseId,
}: LatestResultsCellProps) {
  const t = useTranslations();
  const shown = executions.slice(0, slots);
  const totalSlots = Math.max(shown.length, slots);

  // Newest at full strength, the next a step down, then an even fade to 0.2.
  const getOpacity = (index: number) => {
    if (index === 0) return 1;
    if (totalSlots <= 2) return 0.7;
    return 0.7 - ((index - 1) / (totalSlots - 2)) * 0.5;
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        {shown.map((execution, index) => {
          const hasLink = projectId && execution.testRunId;
          const boxStyle = {
            backgroundColor: execution.statusColor,
            opacity: getOpacity(index),
          };

          const box = hasLink ? (
            <Link
              href={`/projects/runs/${projectId}/${execution.testRunId}?selectedCase=${testCaseId}`}
              className="block h-4 w-4 rounded-sm transition-all hover:opacity-80"
              style={boxStyle}
              aria-label={execution.statusName}
            />
          ) : (
            <div
              className="h-4 w-4 cursor-default rounded-sm"
              style={boxStyle}
              aria-label={execution.statusName}
            />
          );

          return (
            <Tooltip key={`${testCaseId}-exec-${execution.resultId}-${index}`}>
              <TooltipTrigger asChild>{box}</TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1 text-xs">
                  <StatusDotDisplay
                    name={execution.statusName}
                    color={execution.statusColor}
                  />
                  <div className="opacity-80">
                    {format(new Date(execution.executedAt), "PPp")}
                  </div>
                  {!execution.testRunId && (
                    <div className="text-xs text-destructive">
                      {t("reports.ui.flakyTests.testRunDeleted")}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {shown.length < slots &&
          Array.from({ length: slots - shown.length }).map((_, index) => (
            <div
              key={`${testCaseId}-empty-${shown.length + index}`}
              className="h-4 w-4 rounded-sm bg-muted"
              style={{ opacity: getOpacity(shown.length + index) }}
            />
          ))}
      </div>
    </TooltipProvider>
  );
}

export default LatestResultsCell;
