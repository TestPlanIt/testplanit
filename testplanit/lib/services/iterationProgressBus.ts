/**
 * Iteration progress bus — in-memory pub/sub for async iteration generation.
 *
 * The AddTestRunModal calls `start()` after enqueueing a fan-out job. A
 * single React subscriber (mounted once at the providers level) drives the
 * polling loop against `/api/test-runs/iterations/status/[jobId]` and the
 * `RunGenerationProgressToast` UI. The IterationSidebarGeneratingState
 * overlay subscribes too so the in-page progress card stays in sync.
 *
 * Module-scoped state is intentional — there is exactly one bus per browser
 * tab. The polling consumer is mounted once via `<RunGenerationProgressMount />`
 * in `app/providers.tsx`; if you mount it elsewhere too, you will get
 * duplicate `setInterval` loops per job.
 */

export type IterationProgressState =
  "queued" | "active" | "completed" | "failed";

export interface ProgressJob {
  jobId: string;
  runId: number;
  runName: string;
  total: number;
  processed: number;
  state: IterationProgressState;
  failedReason?: string;
}

type Listener = (jobs: Map<string, ProgressJob>) => void;

const listeners = new Set<Listener>();
const jobs = new Map<string, ProgressJob>();

function emit(): void {
  const snapshot = new Map(jobs);
  for (const fn of listeners) {
    fn(snapshot);
  }
}

function start(args: {
  jobId: string;
  runId: number;
  runName: string;
  total: number;
}): void {
  jobs.set(args.jobId, {
    jobId: args.jobId,
    runId: args.runId,
    runName: args.runName,
    total: args.total,
    processed: 0,
    state: "queued",
  });
  emit();
}

function update(jobId: string, patch: Partial<ProgressJob>): void {
  const cur = jobs.get(jobId);
  if (!cur) return;
  jobs.set(jobId, { ...cur, ...patch });
  emit();
}

function remove(jobId: string): void {
  if (jobs.delete(jobId)) {
    emit();
  }
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  // Push the current snapshot immediately so subscribers don't miss state
  // for jobs that started before they mounted.
  fn(new Map(jobs));
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): ProgressJob[] {
  return Array.from(jobs.values());
}

export const iterationProgressBus = {
  start,
  update,
  remove,
  subscribe,
  snapshot,
};

// Backwards-compat alias for Wave 1's `IterationProgressJob` type. Existing
// import sites (AddTestRunModal) reference this name and only use the four
// fields the start() call already supplies.
export type IterationProgressJob = Pick<
  ProgressJob,
  "jobId" | "runId" | "runName" | "total"
>;
