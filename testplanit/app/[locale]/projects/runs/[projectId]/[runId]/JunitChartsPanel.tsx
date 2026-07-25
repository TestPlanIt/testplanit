import JUnitDurationHistogram from "@/components/dataVisualizations/JUnitDurationHistogram";
import JUnitStatusTimeline from "@/components/dataVisualizations/JUnitStatusTimeline";
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
import { Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "~/utils";

interface JunitChartsPanelProps {
  t: (key: string) => string;
  jUnitSuites: any[] | undefined;
  sortedJunitTestCases: any[];
  statusScope:
    { name?: string | null; icon?: string | null } | null | undefined;
  forecastSeconds: number | null | undefined;
}

/**
 * The right panel of a JUnit (automated) test run: the workflow-scope badge,
 * forecast, and the results chart carousel (donut / status timeline / duration
 * histogram) with a full-screen zoom dialog. Content only — it renders inside
 * the shared run-details shell's right panel in `page.tsx`, above the shared
 * `TestRunFormControls`. Owns its own chart/carousel/zoom state.
 */
export default function JunitChartsPanel({
  t,
  jUnitSuites,
  sortedJunitTestCases,
  statusScope,
  forecastSeconds,
}: JunitChartsPanelProps) {
  // Group by status for the donut chart.
  const donutChartData = useMemo(() => {
    if (!sortedJunitTestCases) return [];
    const statusMap: Record<
      string,
      { id: string | number; name: string; color: string; value: number }
    > = {};
    for (const result of sortedJunitTestCases) {
      const statusName = result.resultStatus;
      const statusColor = result.resultColor;
      if (!statusName) continue;
      const key = statusName;
      if (!statusMap[key]) {
        statusMap[key] = {
          id: key,
          name: statusName,
          color: statusColor,
          value: 0,
        };
      }
      statusMap[key].value++;
    }
    return Object.values(statusMap);
  }, [sortedJunitTestCases]);

  // Map jUnitSuites to the structure the timeline/histogram charts expect.
  const jUnitSuitesForCharts = useMemo(() => {
    if (!jUnitSuites) return [];
    return jUnitSuites.map((suite: any) => ({
      name: suite.name,
      timestamp: suite.timestamp,
      testCases: (suite.results || []).map((result: any) => ({
        name: result.repositoryCase?.name || `Case ${result.repositoryCaseId}`,
        className:
          result.repositoryCase?.className || String(result.repositoryCaseId),
        time: result.time,
        result: {
          status: result.status
            ? { name: result.status.name, color: result.status.color }
            : undefined,
        },
      })),
    }));
  }, [jUnitSuites]);

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
      if (carouselApi) carouselApi.scrollNext();
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
      {/* Charts carousel */}
      <div
        onMouseEnter={() => setCarouselHovered(true)}
        onMouseLeave={() => setCarouselHovered(false)}
      >
        <Carousel
          setApi={setCarouselApi}
          className="mb-4"
          opts={{ loop: true }}
        >
          <CarouselPrevious />
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
                    {t("common.ui.charts.statusTimeline")}
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
                      {t("common.ui.charts.zoomStatusTimeline")}
                    </span>
                  </Button>
                </CardHeader>
                <CardContent>
                  <JUnitStatusTimeline
                    jUnitSuites={jUnitSuitesForCharts}
                    height={180}
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
                    jUnitSuites={jUnitSuitesForCharts}
                    height={180}
                  />
                </CardContent>
              </Card>
            </CarouselItem>
          </CarouselContent>
          <CarouselNext />
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
                  ? t("common.ui.charts.statusTimeline")
                  : zoomedChart === "histogram"
                    ? t("common.ui.charts.testDurationHistogram")
                    : ""}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {zoomedChart === "donut"
                ? t("common.ui.charts.resultsDistribution")
                : zoomedChart === "timeline"
                  ? t("common.ui.charts.statusTimeline")
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
                  <JUnitStatusTimeline
                    jUnitSuites={jUnitSuitesForCharts}
                    height={600}
                  />
                )}
                {zoomedChart === "histogram" && (
                  <JUnitDurationHistogram
                    jUnitSuites={jUnitSuitesForCharts}
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
