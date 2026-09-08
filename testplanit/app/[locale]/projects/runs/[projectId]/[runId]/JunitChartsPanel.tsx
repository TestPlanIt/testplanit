import AutomatedRunMetrics from "@/components/AutomatedRunMetrics";
import CollapsibleSummarySection from "@/components/CollapsibleSummarySection";
import JUnitDurationHistogram from "@/components/dataVisualizations/JUnitDurationHistogram";
import JUnitExecutionTimeline from "@/components/dataVisualizations/JUnitExecutionTimeline";
import TestRunResultsDonut from "@/components/dataVisualizations/TestRunResultsDonut";
import DynamicIcon from "@/components/DynamicIcon";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Maximize2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { cn } from "~/utils";
import { schema } from "~/zenstack/schema";

interface JunitChartsPanelProps {
  t: (key: string) => string;
  runId: number;
  statusScope:
    { name?: string | null; icon?: string | null } | null | undefined;
  forecastSeconds: number | null | undefined;
  /** Wired to the metrics card's Flaky Tests tile — applies the table filter. */
  onFlakyTileClick?: () => void;
  /** Wired to the metrics card's Retries tile — applies the table filter. */
  onRetriesTileClick?: () => void;
}

const fallbackColor = (type: string | null | undefined) =>
  type === "FAILURE" || type === "ERROR"
    ? "rgb(239, 68, 68)"
    : type === "SKIPPED"
      ? "rgb(161, 161, 170)"
      : "rgb(34, 197, 94)";

/**
 * The right panel of a JUnit (automated) test run: the workflow-scope badge,
 * forecast, execution metrics, and the results chart carousel (donut /
 * execution timeline / duration histogram) with a full-screen zoom dialog.
 * Content only — it renders inside the shared run-details shell's right panel
 * in `page.tsx`, above the shared `TestRunFormControls`.
 *
 * Fetches its own LEAN result rows (no system output, attachments, or case
 * links) so the metrics and charts render without waiting for the results
 * table's heavyweight suite query.
 */
export default function JunitChartsPanel({
  t,
  runId,
  statusScope,
  forecastSeconds,
  onFlakyTileClick,
  onRetriesTileClick,
}: JunitChartsPanelProps) {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string | undefined;

  const { data: leanResults } = useClientQueries(
    schema
  ).jUnitTestResult.useFindMany(
    {
      where: { testSuite: { testRunId: runId } },
      select: {
        id: true,
        type: true,
        time: true,
        executedAt: true,
        createdAt: true,
        worker: true,
        repositoryCaseId: true,
        status: {
          select: { name: true, color: { select: { value: true } } },
        },
        repositoryCase: {
          select: {
            name: true,
            source: true,
            automated: true,
            isDeleted: true,
            hasParameters: true,
          },
        },
        testSuite: { select: { name: true } },
      },
      orderBy: { id: "asc" },
    },
    { enabled: Number.isFinite(runId) }
  );

  // One row shape for every consumer: metrics card, donut, timeline, histogram.
  const chartRows = useMemo(
    () =>
      (leanResults ?? []).map((result) => ({
        id: result.repositoryCaseId,
        resultId: result.id,
        name: result.repositoryCase?.name || String(result.repositoryCaseId),
        source: result.repositoryCase?.source,
        automated: result.repositoryCase?.automated || false,
        isDeleted: result.repositoryCase?.isDeleted || false,
        hasParameters: result.repositoryCase?.hasParameters || false,
        suiteName: result.testSuite?.name,
        time: result.time,
        executedAt: result.executedAt || undefined,
        createdAt: result.createdAt || undefined,
        worker: result.worker,
        resultType: result.type || "PASSED",
        resultStatus: result.status?.name || result.type || "PASSED",
        resultColor: result.status?.color?.value || fallbackColor(result.type),
      })),
    [leanResults]
  );

  // Group by status for the donut chart.
  const donutChartData = useMemo(() => {
    const statusMap: Record<
      string,
      { id: string | number; name: string; color: string; value: number }
    > = {};
    for (const row of chartRows) {
      const statusName = row.resultStatus;
      if (!statusName) continue;
      if (!statusMap[statusName]) {
        statusMap[statusName] = {
          id: statusName,
          name: statusName,
          color: row.resultColor,
          value: 0,
        };
      }
      statusMap[statusName].value++;
    }
    return Object.values(statusMap);
  }, [chartRows]);

  const timelineRows = useMemo(
    () =>
      chartRows.map((row) => ({
        caseId: row.id,
        resultId: row.resultId,
        name: row.name,
        suiteName: row.suiteName,
        statusName: row.resultStatus,
        color: row.resultColor,
        isDeleted: row.isDeleted,
        time: row.time,
        executedAt: row.executedAt,
        createdAt: row.createdAt,
        worker: row.worker,
      })),
    [chartRows]
  );

  // The histogram consumes the suite-grouped shape.
  const suitesForHistogram = useMemo(() => {
    const bySuite = new Map<
      string,
      { name: string; testCases: Array<{ name: string; time?: number | null }> }
    >();
    for (const row of chartRows) {
      const suiteName = row.suiteName || "";
      let suite = bySuite.get(suiteName);
      if (!suite) {
        suite = { name: suiteName, testCases: [] };
        bySuite.set(suiteName, suite);
      }
      suite.testCases.push({ name: row.name, time: row.time });
    }
    return Array.from(bySuite.values());
  }, [chartRows]);

  const handleTimelineResultClick = useCallback(
    (caseId: number | string) => {
      if (!projectId) return;
      router.push(`/projects/repository/${projectId}/${caseId}`);
    },
    [router, projectId]
  );

  const [zoomedChart, setZoomedChart] = useState<
    "donut" | "timeline" | "histogram" | null
  >(null);
  const [carouselApi, setCarouselApi] = useState<any>(null);
  const [carouselHovered, setCarouselHovered] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => setCurrentSlide(carouselApi.selectedScrollSnap());
    carouselApi.on("select", onSelect);
    onSelect();
    return () => carouselApi.off("select", onSelect);
  }, [carouselApi]);

  useEffect(() => {
    if (!carouselApi) return;
    if (carouselHovered) return;
    const interval = setInterval(() => {
      // The carousel unmounts when the section is collapsed, but this state
      // still holds the destroyed embla instance — don't drive it then.
      if (carouselApi && carouselApi.rootNode()?.isConnected) {
        carouselApi.scrollNext();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [carouselApi, carouselHovered]);

  return (
    <>
      <div className="flex">
        <Badge variant="default" className="flex gap-1">
          <DynamicIcon name={statusScope?.icon as any} size={20} />
          {statusScope?.name}
        </Badge>
      </div>
      {(forecastSeconds ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <FormLabel className="text-base font-bold">
            {t("common.fields.forecast")}
          </FormLabel>
          <ForecastDisplay seconds={forecastSeconds!} />
        </div>
      )}
      <CollapsibleSummarySection
        storageKey={`tpi.runs.${projectId ?? "all"}.metricsChartsCollapsed`}
        title={t("common.labels.metricsAndCharts")}
      >
        <AutomatedRunMetrics
          results={chartRows}
          onFlakyClick={onFlakyTileClick}
          onRetriesClick={onRetriesTileClick}
        />
        {/* Charts carousel */}
        <div
          className="mt-4"
          onMouseEnter={() => setCarouselHovered(true)}
          onMouseLeave={() => setCarouselHovered(false)}
        >
          <Carousel
            setApi={setCarouselApi}
            className="mb-4"
            opts={{ loop: true }}
          >
            {/* The shared carousel parks its arrows 48px outside the track, which
              overflows this narrow side panel and scrolls it horizontally.
              Overlap the chart edge instead — which means they now need a
              stacking layer to sit above the chart they overlap. */}
            <CarouselPrevious className="start-0 z-10" />
            <CarouselContent>
              <CarouselItem>
                <Card shadow="none">
                  <CardHeader className="flex flex-row items-center justify-between p-2">
                    <CardTitle className="text-base font-medium">
                      {t("common.ui.charts.resultsDistribution")}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setZoomedChart("donut")}
                    >
                      <Maximize2 className="h-4 w-4" />
                      <span className="sr-only">
                        {t("common.ui.charts.zoomDonutChart")}
                      </span>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <TestRunResultsDonut data={donutChartData} height={220} />
                  </CardContent>
                </Card>
              </CarouselItem>
              <CarouselItem>
                <Card shadow="none">
                  <CardHeader className="flex flex-row items-center justify-between p-2">
                    <CardTitle className="text-base font-medium">
                      {t("common.ui.charts.executionTimeline")}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setZoomedChart("timeline")}
                    >
                      <Maximize2 className="h-4 w-4" />
                      <span className="sr-only">
                        {t("common.ui.charts.zoomExecutionTimeline")}
                      </span>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <JUnitExecutionTimeline
                      results={timelineRows}
                      height={180}
                      onResultClick={handleTimelineResultClick}
                    />
                  </CardContent>
                </Card>
              </CarouselItem>
              <CarouselItem>
                <Card shadow="none">
                  <CardHeader className="flex flex-row items-center justify-between p-2">
                    <CardTitle className="text-base font-medium">
                      {t("common.ui.charts.testDurationHistogram")}
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setZoomedChart("histogram")}
                    >
                      <Maximize2 className="h-4 w-4" />
                      <span className="sr-only">
                        {t("common.ui.charts.zoomHistogramChart")}
                      </span>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <JUnitDurationHistogram
                      jUnitSuites={suitesForHistogram}
                      height={180}
                    />
                  </CardContent>
                </Card>
              </CarouselItem>
            </CarouselContent>
            <CarouselNext className="end-0 z-10" />
          </Carousel>
        </div>
        {/* Slide navigation dots */}
        <div className="flex justify-center gap-2 mt-2">
          {[0, 1, 2].map((idx) => (
            <button
              key={idx}
              type="button"
              className={cn(
                "h-2 w-8 rounded transition-colors",
                currentSlide === idx
                  ? "bg-primary"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
              onClick={() => carouselApi && carouselApi.scrollTo(idx)}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      </CollapsibleSummarySection>
      {/* Full-screen zoom dialog */}
      <Dialog
        open={!!zoomedChart}
        onOpenChange={(open) => {
          if (!open) setZoomedChart(null);
        }}
      >
        <DialogContent className="max-w-[80vw] h-[80vh] flex flex-col p-0 sm:p-6">
          <DialogHeader className="px-4 pt-4 sm:px-0 sm:pt-0">
            <DialogTitle>
              {zoomedChart === "donut"
                ? t("common.ui.charts.resultsDistribution")
                : zoomedChart === "timeline"
                  ? t("common.ui.charts.executionTimeline")
                  : zoomedChart === "histogram"
                    ? t("common.ui.charts.testDurationHistogram")
                    : ""}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {zoomedChart === "donut"
                ? t("common.ui.charts.resultsDistribution")
                : zoomedChart === "timeline"
                  ? t("common.ui.charts.executionTimeline")
                  : zoomedChart === "histogram"
                    ? t("common.ui.charts.testDurationHistogram")
                    : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 sm:p-0">
            <div className="flex-1 w-full h-full" style={{ minHeight: 600 }}>
              <div className="w-full h-full flex items-center justify-center">
                {zoomedChart === "donut" && (
                  <TestRunResultsDonut
                    data={donutChartData}
                    isZoomed
                    height={600}
                  />
                )}
                {zoomedChart === "timeline" && (
                  <JUnitExecutionTimeline
                    results={timelineRows}
                    height={600}
                    onResultClick={handleTimelineResultClick}
                  />
                )}
                {zoomedChart === "histogram" && (
                  <JUnitDurationHistogram
                    jUnitSuites={suitesForHistogram}
                    isZoomed
                    height={600}
                  />
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
