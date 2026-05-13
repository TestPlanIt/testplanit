"use client";

import { useEffect, useState } from "react";

import {
  iterationProgressBus,
  type ProgressJob,
} from "~/lib/services/iterationProgressBus";

/**
 * Subscribes to the in-memory iteration-progress bus AND drives the polling
 * loop against `/api/test-runs/iterations/status/[jobId]` for every
 * non-terminal job.
 *
 * Designed to be mounted exactly ONCE per browser tab — typically by the
 * `<RunGenerationProgressMount />` component in `app/providers.tsx`. Other
 * surfaces (e.g. `IterationSidebarGeneratingState`) should subscribe to the
 * bus directly via `iterationProgressBus.subscribe()` instead of calling
 * this hook again, otherwise multiple polling loops will compete.
 *
 * Returns the current jobs array so the host component can render UI for
 * each (the toast renderer iterates over them and calls
 * `toast.custom(jobId, ...)`).
 */
export function useIterationGenerationProgress(): ProgressJob[] {
  const [jobsArr, setJobsArr] = useState<ProgressJob[]>(() =>
    iterationProgressBus.snapshot()
  );

  useEffect(() => {
    return iterationProgressBus.subscribe((m) => {
      setJobsArr(Array.from(m.values()));
    });
  }, []);

  // Re-derive the list of jobs we need to poll. Re-running this effect when
  // the (jobId, state) tuple changes lets us cancel a poll when the job
  // reaches a terminal state without leaking intervals.
  const pollKey = jobsArr
    .filter((j) => j.state === "queued" || j.state === "active")
    .map((j) => `${j.jobId}:${j.state}`)
    .join(",");

  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    for (const job of jobsArr) {
      if (job.state !== "queued" && job.state !== "active") continue;
      const handle = setInterval(async () => {
        try {
          const r = await fetch(
            `/api/test-runs/iterations/status/${job.jobId}`,
            { cache: "no-store" }
          );
          if (!r.ok) {
            // 404 after the job has been reaped from BullMQ — treat as
            // completed so the toast can resolve. Other errors swallow to
            // keep the UI alive (next tick may succeed).
            if (r.status === 404) {
              iterationProgressBus.update(job.jobId, { state: "completed" });
            }
            return;
          }
          const body = (await r.json()) as {
            state?: string;
            progress?: { processed?: number; total?: number } | number;
            failedReason?: string | null;
          };
          const progress =
            body.progress && typeof body.progress === "object"
              ? body.progress
              : null;
          const nextState: ProgressJob["state"] | undefined =
            body.state === "queued" ||
            body.state === "active" ||
            body.state === "completed" ||
            body.state === "failed"
              ? body.state
              : undefined;
          iterationProgressBus.update(job.jobId, {
            ...(nextState ? { state: nextState } : {}),
            ...(progress?.processed != null
              ? { processed: progress.processed }
              : {}),
            ...(progress?.total != null && progress.total > 0
              ? { total: progress.total }
              : {}),
            ...(body.failedReason
              ? { failedReason: body.failedReason }
              : {}),
          });
        } catch {
          // Network blip — leave state untouched; next tick retries.
        }
      }, 2000);
      intervals.push(handle);
    }
    return () => {
      for (const h of intervals) clearInterval(h);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollKey]);

  return jobsArr;
}
