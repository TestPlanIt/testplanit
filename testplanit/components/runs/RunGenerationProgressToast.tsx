"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useIterationGenerationProgress } from "~/hooks/useIterationGenerationProgress";
import {
  iterationProgressBus,
  type ProgressJob,
} from "~/lib/services/iterationProgressBus";

interface ProgressToastBodyProps {
  job: ProgressJob;
  onDismiss: () => void;
}

function ProgressToastBody({ job, onDismiss }: ProgressToastBodyProps) {
  const t = useTranslations("parameters");
  const safeTotal = Math.max(job.total, 1);
  const done = Math.min(job.processed, safeTotal);
  const pct = Math.min(100, Math.round((done / safeTotal) * 100));
  const remaining = Math.max(0, safeTotal - done);
  const minutes = Math.max(1, Math.ceil(remaining / 1000));

  return (
    <div
      className="w-80 bg-popover text-popover-foreground border rounded-md shadow-lg p-3 flex flex-col gap-2"
      data-testid="run-generation-progress-toast"
      data-job-id={job.jobId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-tight">
          {t("runProgressTitle", { runName: job.runName })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 -mr-1 -mt-1"
          aria-label={t("runProgressDismissAria")}
          data-testid="run-generation-progress-dismiss"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {t("runProgressCounter", {
            done: String(done),
            total: String(safeTotal),
          })}
        </span>
        <span>{t("runProgressEta", { minutes })}</span>
      </div>
    </div>
  );
}

/**
 * Side-effect-only renderer for the iteration-generation progress toast.
 *
 * Mounted exactly once at the providers level via
 * `<RunGenerationProgressMount />`. Subscribes to `iterationProgressBus`
 * (through `useIterationGenerationProgress`) which also drives the polling
 * loop, and emits/updates a sticky `sonner` toast per active job. On
 * terminal state transitions, swaps the sticky toast for a regular
 * success/error toast and removes the job from the bus.
 *
 * The component itself returns `null`.
 */
export function RunGenerationProgressToast() {
  const t = useTranslations("parameters");
  const jobs = useIterationGenerationProgress();
  const queryClient = useQueryClient();
  // Track the previous state per job so we can detect terminal transitions
  // exactly once and avoid replaying success/failure toasts on every tick.
  const prevStateRef = useRef<Map<string, ProgressJob["state"]>>(new Map());
  // Track which jobs the user has dismissed visually so we don't recreate
  // the sticky toast on the next progress tick.
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const seen = new Set<string>();
    for (const job of jobs) {
      seen.add(job.jobId);
      const prev = prevStateRef.current.get(job.jobId);
      prevStateRef.current.set(job.jobId, job.state);

      if (job.state === "completed") {
        if (prev !== "completed") {
          toast.dismiss(job.jobId);
          toast.success(
            t("runProgressComplete", {
              total: job.total,
              runName: job.runName,
            })
          );
          void queryClient.invalidateQueries({
            queryKey: ["zenstack", "TestRunCases"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["zenstack", "TestRunCaseIteration"],
          });
          iterationProgressBus.remove(job.jobId);
        }
        continue;
      }

      if (job.state === "failed") {
        if (prev !== "failed") {
          toast.dismiss(job.jobId);
          toast.error(
            t("runProgressFailedToast", {
              runName: job.runName,
              reason: job.failedReason ?? "",
            })
          );
          iterationProgressBus.remove(job.jobId);
        }
        continue;
      }

      // queued | active — render or update the sticky toast unless the user
      // has dismissed it manually.
      if (dismissedRef.current.has(job.jobId)) continue;

      toast.custom(
        () => (
          <ProgressToastBody
            job={job}
            onDismiss={() => {
              dismissedRef.current.add(job.jobId);
              toast.dismiss(job.jobId);
            }}
          />
        ),
        { id: job.jobId, duration: Infinity }
      );
    }

    // Cleanup: remove tracking entries for jobs that have been removed from
    // the bus (e.g. via remove() after terminal state).
    for (const id of Array.from(prevStateRef.current.keys())) {
      if (!seen.has(id)) {
        prevStateRef.current.delete(id);
        dismissedRef.current.delete(id);
      }
    }
  }, [jobs, queryClient, t]);

  return null;
}

/**
 * Convenience wrapper to mount once near the app's `<Toaster />`.
 */
export function RunGenerationProgressMount() {
  return <RunGenerationProgressToast />;
}
