"use client";

import { useQuery } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, type ComponentProps } from "react";
import type { BatchTestRunSummaryResponse } from "~/app/api/test-runs/summaries/route";
import {
  ABANDONED_RUN_IDLE_MINUTES_KEY,
  resolveEffectiveIdleMinutes,
} from "~/lib/services/abandonedRuns";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type AutomationRunListItem = NonNullable<
  ComponentProps<typeof TestRunNameDisplay>["testRun"]
> & { id: number };

interface AutomationRunsCardProps {
  projectId: number;
  /** In-progress automated runs, pre-filtered by the page (which already
   *  holds the project's active runs — no extra run query needed here). */
  runs: AutomationRunListItem[];
}

/**
 * UI-only fallback for when the abandoned-run cleanup policy is off: stop
 * the "importing" spinner after an hour of silence so a run whose CI job
 * died doesn't appear to import forever. When the policy IS configured
 * (system default or project override), the spinner follows that
 * threshold instead — see the resolution below.
 */
const SPINNER_STALE_FALLBACK_MINUTES = 60;

/**
 * Summary-grid card on the project runs page: one compact row per
 * in-progress automated run — name, a mini result-status bar, test
 * count, and a spinner while results are still arriving. Sized and
 * styled like the neighboring chart cards; renders nothing when no
 * automation is running.
 *
 * Live updates ride the page's existing machinery: the runs list query
 * polls at 30s on the active tab, and TestRunDisplay's project SSE
 * stream invalidates the "batchTestRunSummaries" prefix on wake-up,
 * which covers this card's summaries query too.
 */
export function AutomationRunsCard({
  projectId,
  runs,
}: AutomationRunsCardProps) {
  const t = useTranslations();

  const runIds = useMemo(() => runs.map((run) => run.id), [runs]);

  // The spinner goes stale at the same idle threshold the abandoned-run
  // sweeper uses (project override, else the system policy), so the UI and
  // the cleanup job agree on what "abandoned" means. With the policy off the
  // sweeper never runs, so a fixed fallback keeps dead runs from spinning
  // forever. Re-evaluated by the summaries query's 30s refetch.
  const { data: sweepConfig } = useClientQueries(
    schema
  ).appConfig.useFindUnique({ where: { key: ABANDONED_RUN_IDLE_MINUTES_KEY } });
  const { data: projectSweep } = useClientQueries(
    schema
  ).projects.useFindUnique({
    where: { id: projectId },
    select: { abandonedRunIdleMinutes: true },
  });
  const systemMinutes =
    typeof sweepConfig?.value === "number" && sweepConfig.value > 0
      ? Math.floor(sweepConfig.value as number)
      : 0;
  const effectiveMinutes = resolveEffectiveIdleMinutes(
    systemMinutes,
    projectSweep?.abandonedRunIdleMinutes ?? null
  );
  const spinnerStaleMs =
    (effectiveMinutes > 0 ? effectiveMinutes : SPINNER_STALE_FALLBACK_MINUTES) *
    60 *
    1000;

  const { data: batchSummaries } = useQuery<BatchTestRunSummaryResponse>({
    queryKey: ["batchTestRunSummaries", runIds],
    queryFn: async () => {
      const response = await fetch(
        `/api/test-runs/summaries?testRunIds=${runIds.join(",")}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch batch test run summaries");
      }
      return response.json();
    },
    enabled: runIds.length > 0,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  if (runs.length === 0) {
    return null;
  }

  return (
    <Card data-testid="automation-runs-card">
      <CardHeader className="pb-2 flex flex-row items-start justify-between">
        <div>
          <CardTitle className="font-medium">
            {t("runs.summary.automationRunsInProgress", { count: runs.length })}
          </CardTitle>
          <CardDescription>
            {t("runs.summary.automationRunsInProgressDescription")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto px-2 pb-2">
          {runs.map((run) => {
            const summary = batchSummaries?.summaries[run.id];
            const lastActivityMs = summary?.lastActivityAt
              ? new Date(summary.lastActivityAt).getTime()
              : null;
            const isStale =
              lastActivityMs !== null &&
              Date.now() - lastActivityMs > spinnerStaleMs;
            return (
              <div
                key={run.id}
                className="flex items-center gap-2"
                data-testid={`automation-run-item-${run.id}`}
              >
                <div className="min-w-0 flex-1 text-sm">
                  <TestRunNameDisplay
                    testRun={run}
                    projectId={projectId}
                    className="truncate"
                  />
                </div>
                {summary ? (
                  <>
                    {summary.totalCases > 0 && (
                      <div
                        className="flex h-2 w-24 shrink-0 overflow-hidden rounded-full"
                        role="img"
                        aria-label={summary.statusCounts
                          .map((sc) => `${sc.count} ${sc.statusName}`)
                          .join(", ")}
                      >
                        {summary.statusCounts.map((sc, index) => (
                          <div
                            key={sc.statusId ?? `status-${index}`}
                            className="h-full"
                            style={{
                              backgroundColor: sc.colorValue,
                              flexGrow: sc.count,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums min-w-8 text-end">
                      {summary.totalCases}
                    </span>
                    {summary.workflowType === "IN_PROGRESS" && !isStale && (
                      <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </>
                ) : (
                  <Skeleton className="h-2 w-24 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
