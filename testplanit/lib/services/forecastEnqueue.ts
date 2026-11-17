/**
 * Forecast refresh for API clients.
 *
 * The web UI refreshes a case's forecast from the browser after it records a
 * result with an elapsed time, and a run's forecast after it creates the run
 * or changes its case list. Nothing on the server did the same, so results
 * and runs written by the MCP server, the API client or an import kept stale
 * forecasts until the nightly recomputation. These enqueues hang off the
 * side-effects plugin, so every writer gets the refresh.
 */

import { getForecastQueue } from "~/lib/queues";
import {
  JOB_UPDATE_RUN_FORECAST,
  JOB_UPDATE_SINGLE_CASE,
} from "~/lib/queueNames";

/**
 * Deferred so the worker reads committed state — the plugin hook that
 * enqueues runs inside the writer's transaction — and so a bulk write
 * touching one case or run many times collapses onto one job.
 */
const FORECAST_REFRESH_DELAY_MS = 5000;

export interface UpdateRunForecastJobData {
  testRunId: number;
  tenantId?: string;
}

function dedupId(kind: "case" | "run", id: number, tenantId?: string) {
  return `forecast:${kind}:${tenantId ?? "default"}:${id}`;
}

/** Never throws into the caller: a queue hiccup must not fail a write. */
async function enqueue(
  name: string,
  data: Record<string, unknown>,
  dedup: string
): Promise<void> {
  const queue = getForecastQueue();
  if (!queue) return;
  try {
    await queue.add(name, data, {
      deduplication: { id: dedup, ttl: FORECAST_REFRESH_DELAY_MS },
      delay: FORECAST_REFRESH_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(`[forecast] failed to queue ${name} for ${dedup}:`, error);
  }
}

/** Recompute the case's group forecast, then every run that holds it. */
export function enqueueCaseForecastUpdate(
  repositoryCaseId: number,
  tenantId?: string
): Promise<void> {
  return enqueue(
    JOB_UPDATE_SINGLE_CASE,
    { repositoryCaseId, tenantId },
    dedupId("case", repositoryCaseId, tenantId)
  );
}

/** Recompute one run's forecast from its current case list. */
export function enqueueRunForecastUpdate(
  testRunId: number,
  tenantId?: string
): Promise<void> {
  return enqueue(
    JOB_UPDATE_RUN_FORECAST,
    { testRunId, tenantId } satisfies UpdateRunForecastJobData,
    dedupId("run", testRunId, tenantId)
  );
}
