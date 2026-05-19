"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import LoadingSpinner from "~/components/LoadingSpinner";
import {
  iterationProgressBus,
  type ProgressJob,
} from "~/lib/services/iterationProgressBus";

export interface IterationSidebarGeneratingStateProps {
  jobId: string;
  totalExpected: number;
  runName: string;
  onSkip: () => void;
}

/**
 * Surface E.5 — In-page progress overlay for the iteration sidebar.
 *
 * Subscribes to `iterationProgressBus` for THIS jobId only. Reuses the
 * polling loop driven by `useIterationGenerationProgress` mounted at the
 * app providers level (no second poll started here).
 *
 * Wired into `IterationSidebar` (Task 10) when the active TestRunCase has
 * `totalIterations === 0` AND a known active jobId from the bus. The Skip
 * link calls `onSkip()` so the parent can switch back to the regular run
 * view; the user can navigate freely while iterations finish materializing.
 */
export function IterationSidebarGeneratingState({
  jobId,
  totalExpected,
  runName,
  onSkip,
}: IterationSidebarGeneratingStateProps) {
  const t = useTranslations("parameters");
  const [job, setJob] = useState<ProgressJob | undefined>(() =>
    iterationProgressBus.snapshot().find((j) => j.jobId === jobId)
  );

  useEffect(() => {
    return iterationProgressBus.subscribe((m) => {
      setJob(m.get(jobId));
    });
  }, [jobId]);

  const total = job?.total ?? totalExpected;
  const safeTotal = Math.max(total, 1);
  const done = Math.min(job?.processed ?? 0, safeTotal);
  const pct = Math.min(100, Math.round((done / safeTotal) * 100));

  return (
    <div
      className="flex flex-col items-center gap-3 p-6 text-center"
      data-testid="iteration-sidebar-generating-state"
      data-job-id={jobId}
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner className="text-primary" delay={0} />
      <p className="text-sm font-medium">{t("runGeneratingHeading")}</p>
      <Progress value={pct} className="h-1.5 w-full max-w-xs" />
      <p className="text-xs text-muted-foreground tabular-nums">
        {t("runProgressCounter", {
          done: String(done),
          total: String(safeTotal),
        })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("runGeneratingHelper")}
      </p>
      <Button
        variant="link"
        size="sm"
        onClick={onSkip}
        data-testid="iteration-sidebar-generating-skip"
        title={runName}
      >
        {t("runProgressNavAway")}
      </Button>
    </div>
  );
}

export default IterationSidebarGeneratingState;
