/**
 * Iteration progress bus — stub for Wave 1.
 *
 * Wave 3 (Task 8 in the phase plan) replaces this stub with a real
 * in-memory pub/sub that drives the polling progress toast and the
 * in-page IterationSidebarGeneratingState overlay. Until then, the
 * stub satisfies the AddTestRunModal's import for async-path runs
 * without coupling Wave 1 to the Wave 3 surface.
 *
 * Behavior of the stub:
 *   - `start()` records the job in a module-level Map so a future Wave 3
 *     consumer mounted at app startup CAN pick up jobs that were
 *     enqueued before its mount (defensive — prevents lost progress
 *     for jobs in flight at the moment of upgrade).
 *   - No subscribers, no dispatch, no UI side effects. The polling
 *     status endpoint is the authoritative source of truth for the
 *     async path; this bus just multicasts that polling result to any
 *     consumer that wants to render it.
 *
 * Wave 3 must KEEP the same `start()` signature so AddTestRunModal
 * does not need a second edit when the real implementation lands.
 */

export interface IterationProgressJob {
  jobId: string;
  runId: number;
  runName: string;
  total: number;
}

const inFlight = new Map<string, IterationProgressJob>();

/**
 * Register a newly-enqueued iteration-generation job. Called from the
 * AddTestRunModal submission flow when /generate-iterations returns
 * `async: true`. Wave 3 will add a subscribe()/unsubscribe()/poll()
 * surface that drives the toast and in-page overlay.
 */
function start(job: IterationProgressJob): void {
  inFlight.set(job.jobId, job);
}

/**
 * Snapshot of currently-tracked jobs. Wave 3's mount-time consumer
 * uses this to recover jobs enqueued before it subscribed.
 */
function snapshot(): IterationProgressJob[] {
  return Array.from(inFlight.values());
}

/**
 * Test/dev helper — drop a job from the in-memory map. Production
 * Wave 3 implementation will clear jobs on completion or failure.
 */
function clear(jobId: string): void {
  inFlight.delete(jobId);
}

export const iterationProgressBus = {
  start,
  snapshot,
  clear,
};
