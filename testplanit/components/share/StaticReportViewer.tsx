"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Eye, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportChart } from "@/components/dataVisualizations/ReportChart";
import { DataTable } from "@/components/tables/DataTable";
import { useTranslations } from "next-intl";
import { useReportColumns } from "~/hooks/useReportColumns";
import { PaginationComponent } from "~/components/tables/Pagination";
import { PaginationInfo } from "~/components/tables/PaginationControls";
import { defaultPageSizeOptions } from "~/lib/contexts/PaginationContext";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

interface StaticReportViewerProps {
  shareData: any;
  shareMode: string;
}

export function StaticReportViewer({ shareData, shareMode }: StaticReportViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "All">(10);

  const t = useTranslations("reports.sharedReport");
  const tCommon = useTranslations("common");

  // Extract dimension and metric IDs from reportData for column generation
  const dimensionIds = useMemo(() => {
    if (!reportData?.dimensions) return [];
    const ids = reportData.dimensions.map((d: any) => d.value || d.id);
    console.log("[StaticReportViewer] dimensionIds:", ids);
    console.log("[StaticReportViewer] dimensions full:", reportData.dimensions);
    return ids;
  }, [reportData?.dimensions]);

  const metricIds = useMemo(() => {
    if (!reportData?.metrics) return [];
    const ids = reportData.metrics.map((m: any) => m.value || m.id);
    console.log("[StaticReportViewer] metricIds:", ids);
    console.log("[StaticReportViewer] metrics full:", reportData.metrics);
    return ids;
  }, [reportData?.metrics]);

  // Generate columns using the useReportColumns hook
  const columns = useReportColumns(
    dimensionIds,
    metricIds,
    reportData?.dimensions,
    reportData?.metrics,
    undefined, // No drill-down for shared reports
    shareData.projectId // Pass project ID for link generation
  );

  // Apply client-side sorting and pagination to results
  const { sortedAndPaginatedResults, totalResults, totalPages, startIndex, endIndex } = useMemo(() => {
    // Use chartData for full dataset (all results) instead of paginated results
    const allResults = reportData?.chartData || reportData?.results || [];

    // Apply sorting
    let sorted = [...allResults];
    if (sortConfig) {
      sorted.sort((a, b) => {
        // Check if it's a dimension or metric
        const isDimension = dimensionIds.includes(sortConfig.column);
        let aVal, bVal;

        if (isDimension) {
          // For dimensions, the value is usually an object with name/id properties
          const aDim = a[sortConfig.column];
          const bDim = b[sortConfig.column];

          // Handle date dimension specially
          if (sortConfig.column === "date") {
            aVal = aDim?.executedAt || aDim?.createdAt || aDim;
            bVal = bDim?.executedAt || bDim?.createdAt || bDim;
          } else {
            // For other dimensions, sort by name or id
            aVal = aDim?.name || aDim?.title || aDim?.id || aDim;
            bVal = bDim?.name || bDim?.title || bDim?.id || bDim;
          }
        } else {
          // For metrics, need to find the metric label
          const metric = reportData?.metrics?.find((m: any) => m.value === sortConfig.column);
          if (metric) {
            aVal = a[metric.label];
            bVal = b[metric.label];
          } else {
            // Fallback to direct access
            aVal = a[sortConfig.column];
            bVal = b[sortConfig.column];
          }
        }

        // Handle null/undefined values
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        // Handle different value types
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        }

        if (aVal instanceof Date || bVal instanceof Date) {
          const aTime = new Date(aVal).getTime();
          const bTime = new Date(bVal).getTime();
          return sortConfig.direction === "asc" ? aTime - bTime : bTime - aTime;
        }

        // String comparison
        const comparison = String(aVal).localeCompare(String(bVal));
        return sortConfig.direction === "asc" ? comparison : -comparison;
      });
    }

    // Apply pagination
    let paginated = sorted;
    let calculatedStartIndex = 1;
    let calculatedEndIndex = sorted.length;
    let calculatedTotalPages = 1;

    if (pageSize !== "All") {
      const numericPageSize = pageSize as number;
      calculatedStartIndex = (currentPage - 1) * numericPageSize + 1;
      calculatedEndIndex = Math.min(currentPage * numericPageSize, sorted.length);
      paginated = sorted.slice(calculatedStartIndex - 1, calculatedEndIndex);
      calculatedTotalPages = Math.ceil(sorted.length / numericPageSize);
    }

    return {
      sortedAndPaginatedResults: paginated,
      totalResults: sorted.length,
      totalPages: calculatedTotalPages,
      startIndex: calculatedStartIndex,
      endIndex: calculatedEndIndex,
    };
  }, [reportData, sortConfig, dimensionIds, currentPage, pageSize]);

  // Handle sort changes
  const handleSortChange = useCallback((columnId: string) => {
    setSortConfig((prev) => ({
      column: columnId,
      direction: prev?.column === columnId && prev.direction === "asc" ? "desc" : "asc",
    }));
    // Reset to page 1 when sorting changes
    setCurrentPage(1);
  }, []);

  // Handle page size changes
  const handlePageSizeChange = useCallback((newPageSize: number | "All") => {
    setPageSize(newPageSize);
    // Reset to page 1 when page size changes
    setCurrentPage(1);
  }, []);

  const fetchReportData = useCallback(async () => {
    if (shareData.entityType !== "REPORT") {
      setError(t("errors.onlyReportSharing"));
      setIsLoading(false);
      return;
    }

    try {
      const config = shareData.entityConfig;
      if (!config) {
        throw new Error(t("errors.failedToLoad"));
      }

      // Get the verified token from sessionStorage (for password-protected shares)
      const shareKey = window.location.pathname.split("/share/")[1];
      const tokenKey = `share_token_${shareKey}`;
      const stored = sessionStorage.getItem(tokenKey);
      let token = null;

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          token = parsed.token;
        } catch (e) {
          // Invalid token, ignore
        }
      }

      // Call the share report API to fetch data
      const url = new URL(`/api/share/${shareKey}/report`, window.location.origin);
      if (token) {
        url.searchParams.set("token", token);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t("errors.failedToLoad"));
      }

      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error("Error fetching report data:", error);
      setError(error instanceof Error ? error.message : t("errors.failedToLoad"));
    } finally {
      setIsLoading(false);
    }
  }, [shareData, t]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!reportData) {
    return null;
  }

  const config = shareData.entityConfig;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <Badge variant="outline">{shareData.entityType}</Badge>
                <Badge variant="secondary">
                  <Eye className="h-3 w-3 mr-1" />
                  {t("viewCount", { count: shareData.viewCount })}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold mb-1">
                {shareData.title || t("defaultTitle")}
              </h1>
              {shareData.description && (
                <p className="text-sm text-muted-foreground">{shareData.description}</p>
              )}
            </div>
          </div>

          {/* Project info */}
          {shareData.projectName && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("fromProject")}</span>
              <span className="font-medium">{shareData.projectName}</span>
            </div>
          )}

          {/* Report config info */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {config.startDate && config.endDate && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t("dateRange")}</span>
                <span className="font-medium">
                  {new Date(config.startDate).toLocaleDateString()} -{" "}
                  {new Date(config.endDate).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Report content */}
      <div className="container mx-auto px-4 py-6">
        {reportData.results && columns.length > 0 ? (
          <ResizablePanelGroup
            direction="vertical"
            className="min-h-[calc(100vh-20rem)]"
            autoSaveId="shared-report-panels"
          >
            {/* Visualization Panel */}
            <ResizablePanel defaultSize={50} minSize={20} collapsedSize={0} collapsible>
              <Card className="h-full rounded-none border-0 overflow-hidden">
                <CardHeader className="pt-2 pb-2">
                  <CardTitle>{tCommon("visualization")}</CardTitle>
                </CardHeader>
                <CardContent className="h-[calc(100%-4rem)] p-6 flex flex-col">
                  <div className="flex-1 min-h-0 w-full">
                    <ReportChart
                      results={reportData.chartData}
                      dimensions={reportData.dimensions}
                      metrics={reportData.metrics}
                      reportType={config.reportType}
                    />
                  </div>
                </CardContent>
              </Card>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Results Table Panel */}
            <ResizablePanel defaultSize={50} minSize={20} collapsedSize={0} collapsible>
              <Card className="h-full rounded-none border-0 overflow-hidden">
                <CardHeader className="pt-2 pb-2">
                  <div className="flex flex-row items-end justify-between">
                    <CardTitle>{tCommon("results")}</CardTitle>
                    {totalResults > 0 && (
                      <div className="flex flex-col items-end">
                        <div className="justify-end">
                          <PaginationInfo
                            startIndex={startIndex}
                            endIndex={endIndex}
                            totalRows={totalResults}
                            searchString=""
                            pageSize={pageSize}
                            pageSizeOptions={defaultPageSizeOptions}
                            handlePageSizeChange={handlePageSizeChange}
                          />
                        </div>
                        {pageSize !== "All" && totalPages > 1 && (
                          <div className="justify-end -mx-4">
                            <PaginationComponent
                              currentPage={currentPage}
                              totalPages={totalPages}
                              onPageChange={setCurrentPage}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="h-[calc(100%-4rem)] overflow-y-auto p-6 pt-0">
                  <DataTable
                    data={sortedAndPaginatedResults}
                    columns={columns}
                    columnVisibility={{}}
                    onColumnVisibilityChange={() => {}}
                    sortConfig={sortConfig || undefined}
                    onSortChange={handleSortChange}
                  />
                </CardContent>
              </Card>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : null}

        {/* Read-only notice */}
        <div className="text-center text-sm text-muted-foreground py-4 mt-6">
          <p>{t("readOnlyNotice")}</p>
        </div>
      </div>
    </div>
  );
}
