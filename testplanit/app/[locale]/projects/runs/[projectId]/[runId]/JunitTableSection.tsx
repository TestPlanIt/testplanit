import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import JUnitDurationHistogram from "@/components/dataVisualizations/JUnitDurationHistogram";
import JUnitStatusTimeline from "@/components/dataVisualizations/JUnitStatusTimeline";
import TestRunResultsDonut from "@/components/dataVisualizations/TestRunResultsDonut";
import { DateFormatter } from "@/components/DateFormatter";
import DynamicIcon from "@/components/DynamicIcon";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem, CarouselNext, CarouselPrevious
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  FormControl, FormField,
  FormItem, FormLabel
} from "@/components/ui/form";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup
} from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import {
  ArrowLeft, ChevronLeft, CircleCheckBig, CircleSlash2, Maximize2, Save, SquarePen, Trash2
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider } from "react-hook-form";
import LoadingSpinnerAlert from "~/components/LoadingSpinnerAlert";
import { TestRunCasesSummary } from "~/components/TestRunCasesSummary";
import {
  defaultPageSizeOptions, usePagination
} from "~/lib/contexts/PaginationContext";
import { useFindManyJUnitTestResult } from "~/lib/hooks";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import CompleteTestRunDialog from "./CompleteTestRunDialog";
import { DeleteTestRunModal } from "./DeleteTestRun";
import { getJunitColumns } from "./junitColumns";
import TestRunFormControls from "./TestRunFormControls";

function JunitTableSection({
  form,
  handleSubmit,
  onSubmit,
  isDeleteDialogOpen,
  setIsDeleteDialogOpen,
  runId,
  projectId,
  refetchTestRun,
  t,
  jUnitSuites,
  sortedJunitTestCases,
  junitSortConfig,
  handleJunitSortChange,
  effectiveCanDelete,
  canAddEditRun,
  canCloseRun,
  isEditMode,
  isSubmitting,
  testRunData,
  isJUnitLoading,
  handleEditClick,
  handleCancel,
  workflows,
  milestones,
  statusScope,
  selectedTestCaseId,
}: any) {
  const { data: session } = useSession();
  const [junitFilter, setJunitFilter] = useState("");
  const [junitColumnVisibility, setJunitColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const {
    currentPage: junitPage,
    setCurrentPage: setJunitPage,
    pageSize: junitPageSize,
    setPageSize: setJunitPageSize,
    totalItems,
    setTotalItems,
    totalPages,
    startIndex,
    endIndex,
  } = usePagination();
  // Filtering
  const filteredJunitTestCases = useMemo(() => {
    if (!junitFilter) return sortedJunitTestCases;
    const filterLower = junitFilter.toLowerCase();
    return sortedJunitTestCases.filter((tc: any) =>
      Object.values(tc).some(
        (val) =>
          typeof val === "string" && val.toLowerCase().includes(filterLower)
      )
    );
  }, [sortedJunitTestCases, junitFilter]);
  // Paging
  useEffect(() => {
    setTotalItems(filteredJunitTestCases.length);
  }, [filteredJunitTestCases.length, setTotalItems]);
  const effectivePageSize =
    junitPageSize === "All" ? totalItems : junitPageSize;
  const pagedJunitTestCases = useMemo(() => {
    if (junitPageSize === "All") return filteredJunitTestCases;
    const start =
      (junitPage - 1) * (typeof junitPageSize === "number" ? junitPageSize : 1);
    return filteredJunitTestCases.slice(
      start,
      start + (typeof junitPageSize === "number" ? junitPageSize : 1)
    );
  }, [filteredJunitTestCases, junitPage, junitPageSize]);

  // --- Right panel state ---
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const panelRightRef = useRef<any>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<any[]>([]);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const toggleCollapseRight = () => {
    setIsTransitioning(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };
  const handleSelect = (attachments: any[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };
  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  // State for JUnit result attachments (separate from test run attachments)
  const [junitResultAttachments, setJunitResultAttachments] = useState<any[]>(
    []
  );
  const [junitResultAttachmentIndex, setJunitResultAttachmentIndex] = useState<
    number | null
  >(null);
  const handleJunitResultAttachmentSelect = useCallback(
    (attachments: any[], index: number) => {
      setJunitResultAttachments(attachments);
      setJunitResultAttachmentIndex(index);
    },
    []
  );
  const handleJunitResultAttachmentClose = useCallback(() => {
    setJunitResultAttachmentIndex(null);
    setJunitResultAttachments([]);
  }, []);

  // Create junitColumns locally with the correct attachment handler
  const junitColumns = useMemo(
    () =>
      getJunitColumns({
        t: t as (key: string) => string,
        session,
        projectId: projectId ? String(projectId) : "",
        handleAttachmentSelect: handleJunitResultAttachmentSelect,
      }),
    [t, session, projectId, handleJunitResultAttachmentSelect]
  );

  useEffect(() => {
    if (
      selectedTestCaseId &&
      sortedJunitTestCases.length > 0 &&
      typeof junitPageSize === "number"
    ) {
      const idx = sortedJunitTestCases.findIndex(
        (tc: { id: number }) => tc.id === selectedTestCaseId
      );
      if (idx >= 0) {
        const page = Math.floor(idx / junitPageSize) + 1;
        setJunitPage(page);
      }
    }
  }, [selectedTestCaseId, sortedJunitTestCases, junitPageSize, setJunitPage]);

  // Fetch all JUnit results for this run (only if automated test run type)
  const isJUnitRun = isAutomatedTestRunType(testRunData?.testRunType);
  useFindManyJUnitTestResult(
      isJUnitRun
        ? {
            where: { testSuiteId: Number(runId) },
            orderBy: { executedAt: "desc" },
            distinct: ["repositoryCaseId"],
            select: {
              statusId: true,
              repositoryCaseId: true,
              executedAt: true,
              id: true,
            },
          }
        : undefined,
      { enabled: isJUnitRun }
    );
  // Group by status for donut chart (JUnit)
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

  const [zoomedChart, setZoomedChart] = useState<
    "donut" | "timeline" | "histogram" | null
  >(null);
  const [, setIsDialogOpen] = useState(false);
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
      if (carouselApi) {
        carouselApi.scrollNext();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [carouselApi, carouselHovered]);

  // Map jUnitSuites to the expected structure for timeline/histogram charts
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
            ? {
                name: result.status.name,
                color: result.status.color,
              }
            : undefined,
        },
      })),
    }));
  }, [jUnitSuites]);

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card
          className={`group-hover:bg-accent/50 transition-colors ${testRunData?.isCompleted ? "bg-muted-foreground/20 border-muted-foreground" : ""}`}
        >
          {isSubmitting && <LoadingSpinnerAlert />}
          <CardHeader>
            <div className="flex justify-between items-start">
              {!isEditMode && (
                <div className="mr-2">
                  <Link href={`/projects/runs/${projectId}`}>
                    <Button variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
              <CardTitle className="w-full pr-4 text-xl md:text-2xl mr-4">
                {isEditMode ? (
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="text-xl md:text-2xl mr-4"
                            readOnly={!canAddEditRun}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  testRunData?.name
                )}
              </CardTitle>
              <div className="flex items-start gap-2">
                {testRunData?.isCompleted ? (
                  <div className="flex flex-col gap-2">
                    <Badge
                      variant="secondary"
                      className="flex items-center text-md whitespace-nowrap text-sm gap-1 p-2 px-4"
                    >
                      <CircleCheckBig className="h-6 w-6 shrink-0" />
                      <div className="hidden md:block">
                        <span className="mr-1">
                          {t("common.fields.completedOn")}
                        </span>
                        <DateFormatter
                          date={testRunData?.completedAt}
                          formatString={
                            testRunData?.session?.user?.preferences?.dateFormat
                          }
                          timezone={
                            testRunData?.session?.user?.preferences?.timezone
                          }
                        />
                      </div>
                    </Badge>
                    {effectiveCanDelete && (
                      <Button
                        variant="secondary"
                        onClick={() => setIsDeleteDialogOpen(true)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("common.actions.delete")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {!isEditMode ? (
                      <>
                        {canAddEditRun && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleEditClick}
                          >
                            <SquarePen className="h-4 w-4" />
                            {t("common.actions.edit")}
                          </Button>
                        )}
                        {!testRunData?.isCompleted && canCloseRun && (
                          <CompleteTestRunDialog
                            trigger={
                              <Button type="button" variant="secondary">
                                <CircleCheckBig className="h-4 w-4" />
                                {t("common.actions.complete")}
                              </Button>
                            }
                            testRunId={Number(runId)}
                            projectId={Number(projectId)}
                            stateId={testRunData?.stateId || 0}
                            stateName={testRunData?.state?.name || ""}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <Button
                              type="submit"
                              variant="default"
                              disabled={isSubmitting || !canAddEditRun}
                            >
                              <Save className="h-4 w-4" />
                              {t("common.actions.save")}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCancel}
                              disabled={isSubmitting}
                            >
                              <CircleSlash2 className="h-4 w-4" />
                              {t("common.cancel")}
                            </Button>
                          </div>
                          {effectiveCanDelete && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setIsDeleteDialogOpen(true)}
                              disabled={isSubmitting}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("common.actions.delete")}
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            <CardDescription>
              <TestRunCasesSummary
                testRunId={Number(runId)}
                className="text-2xl"
                testRunType={testRunData?.testRunType}
              />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResizablePanelGroup
              direction="horizontal"
              className="min-h-[600px] rounded-lg border"
              autoSaveId="junit-table-panels"
            >
              <ResizablePanel
                id="junit-table-left"
                order={1}
                defaultSize={80}
                collapsible
                minSize={30}
                collapsedSize={0}
              >
                <div className="flex flex-col h-full p-4">
                  <div className="space-y-4">
                    {/* --- JUNIT TABLE CONTROLS & TABLE --- */}
                    <div className="flex flex-row items-start w-full gap-4 mb-2">
                      <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
                        <Filter
                          initialSearchString={junitFilter}
                          onSearchChange={setJunitFilter}
                          placeholder={t("common.table.filter")}
                          dataTestId="junit-table-filter"
                        />
                        <div className="mt-4">
                          <ColumnSelection<any>
                            columns={junitColumns as any}
                            onVisibilityChange={setJunitColumnVisibility}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col w-full sm:w-2/3 items-end">
                        <div className="justify-end">
                          <PaginationInfo
                            startIndex={startIndex}
                            endIndex={endIndex}
                            totalRows={totalItems}
                            searchString={junitFilter}
                            pageSize={junitPageSize}
                            pageSizeOptions={defaultPageSizeOptions}
                            handlePageSizeChange={setJunitPageSize}
                          />
                        </div>
                        <div className="justify-end -mx-4">
                          <PaginationComponent
                            currentPage={junitPage}
                            totalPages={totalPages}
                            onPageChange={setJunitPage}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-8">
                      <DataTable
                        columns={junitColumns}
                        data={isJUnitLoading ? [] : pagedJunitTestCases}
                        columnVisibility={junitColumnVisibility}
                        onColumnVisibilityChange={setJunitColumnVisibility}
                        isLoading={isJUnitLoading}
                        pageSize={effectivePageSize}
                        sortConfig={junitSortConfig}
                        onSortChange={handleJunitSortChange}
                      />
                      {!isJUnitLoading &&
                        (!jUnitSuites || jUnitSuites.length === 0) && (
                          <div className="text-muted-foreground">
                            {t("common.ui.noAutomatedTestResults")}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle className="w-1" />
              <div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseRight}
                          variant="secondary"
                          size="sm"
                          className={`p-0 transform ${isCollapsedRight ? "rounded-l-none" : "rounded-r-none rotate-180"}`}
                        >
                          <ChevronLeft />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>
                        {isCollapsedRight
                          ? t("common.actions.expandRightPanel")
                          : t("common.actions.collapseRightPanel")}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ResizablePanel
                id="junit-table-right"
                order={2}
                ref={panelRightRef}
                defaultSize={20}
                collapsedSize={0}
                minSize={20}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={
                  isTransitioning ? "transition-all duration-300 ease-in-out" : ""
                }
              >
                <div className="p-4 space-y-4">
                  {isAutomatedTestRunType(testRunData?.testRunType) && (
                    <div className="flex">
                      <Badge variant="default" className="flex gap-1">
                        <DynamicIcon
                          name={statusScope?.icon as any}
                          size={20}
                        />
                        {statusScope?.name}
                      </Badge>
                    </div>
                  )}
                  {testRunData?.forecastManual && (
                    <div className="flex flex-col gap-2">
                      <FormLabel>{t("common.fields.forecast")}</FormLabel>
                      <ForecastDisplay seconds={testRunData.forecastManual} />
                    </div>
                  )}
                  {/* Charts Carousel */}
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
                              <TestRunResultsDonut
                                data={donutChartData}
                                height={220}
                              />
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
                  {/* Slide navigation bar */}
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
                  <TestRunFormControls
                    isEditMode={isEditMode}
                    isSubmitting={isSubmitting}
                    testRun={testRunData ?? undefined}
                    control={form.control}
                    errors={form.formState.errors}
                    workflows={workflows}
                    milestones={milestones}
                    selectedTags={[]}
                    setSelectedTags={() => {}}
                    projectId={projectId}
                    handleFileSelect={() => {}}
                    handleSelect={handleSelect}
                    selectedIssues={[]}
                    setSelectedIssues={() => {}}
                    canAddEdit={canAddEditRun}
                    canCreateTags={false}
                  />
                  {selectedAttachmentIndex !== null && (
                    <AttachmentsCarousel
                      attachments={selectedAttachments}
                      initialIndex={selectedAttachmentIndex}
                      onClose={handleClose}
                      canEdit={canAddEditRun}
                    />
                  )}
                  {junitResultAttachmentIndex !== null && (
                    <AttachmentsCarousel
                      attachments={junitResultAttachments}
                      initialIndex={junitResultAttachmentIndex}
                      onClose={handleJunitResultAttachmentClose}
                      canEdit={false}
                    />
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </CardContent>
        </Card>
        {/* Zoom Dialog outside of Card/Panel structure */}
        <Dialog
          open={!!zoomedChart}
          onOpenChange={function (open) {
            setIsDialogOpen(open);
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
      </form>
      <DeleteTestRunModal
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        testRunId={Number(runId)}
        projectId={Number(projectId)}
        onDelete={refetchTestRun}
      />
    </FormProvider>
  );
}

export default JunitTableSection;
