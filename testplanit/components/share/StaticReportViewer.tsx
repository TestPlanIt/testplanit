"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTranslations } from "next-intl";
import { ReportRenderer } from "@/components/reports/ReportRenderer";
import { VisibilityState, ExpandedState } from "@tanstack/react-table";
import { Link } from "~/lib/navigation";

interface StaticReportViewerProps {
  shareData: any;
  shareMode: string;
  isAuthenticatedUser?: boolean;
}

export function StaticReportViewer({ shareData, shareMode, isAuthenticatedUser = false }: StaticReportViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // UI state for ReportRenderer
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "All">(10);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [grouping, setGrouping] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const t = useTranslations("reports.sharedReport");

  // Extract config from shareData
  const config = shareData.entityConfig;

  // Build full report URL with configuration for "View in Full App" button
  const fullReportUrl = useMemo(() => {
    if (!shareData.projectId || !config) return null;

    const params = new URLSearchParams();
    if (config.reportType) params.set("reportType", config.reportType);
    if (config.startDate) params.set("startDate", config.startDate);
    if (config.endDate) params.set("endDate", config.endDate);
    if (config.dimensions) params.set("dimensions", Array.isArray(config.dimensions) ? config.dimensions.join(",") : config.dimensions);
    if (config.metrics) params.set("metrics", Array.isArray(config.metrics) ? config.metrics.join(",") : config.metrics);
    if (config.page) params.set("page", config.page.toString());
    if (config.pageSize) params.set("pageSize", config.pageSize.toString());

    return `/projects/reports/${shareData.projectId}?${params.toString()}`;
  }, [shareData.projectId, config]);

  // Client-side pagination and sorting
  const paginatedResults = useMemo(() => {
    if (!reportData?.results) return [];

    let processed = [...reportData.results];

    // Apply sorting if configured
    if (sortConfig) {
      processed.sort((a, b) => {
        const aValue = a[sortConfig.column];
        const bValue = b[sortConfig.column];

        if (aValue === bValue) return 0;
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        const comparison = aValue < bValue ? -1 : 1;
        return sortConfig.direction === "asc" ? comparison : -comparison;
      });
    }

    // Apply pagination
    if (pageSize === "All") {
      return processed;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return processed.slice(startIndex, endIndex);
  }, [reportData?.results, sortConfig, currentPage, pageSize]);

  // Handle sort changes
  const handleSortChange = useCallback((columnId: string) => {
    setSortConfig((prev) => ({
      column: columnId,
      direction: prev?.column === columnId && prev.direction === "asc" ? "desc" : "asc",
    }));
    setCurrentPage(1);
  }, []);

  // Handle page size changes
  const handlePageSizeChange = useCallback((newPageSize: number | "All") => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  }, []);

  const fetchReportData = useCallback(async () => {
    if (shareData.entityType !== "REPORT") {
      setError(t("errors.onlyReportSharing"));
      setIsLoading(false);
      return;
    }

    try {
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
  }, [shareData, t, config]);

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
              </div>
              <h1 className="text-2xl font-bold mb-1">
                {shareData.title || t("defaultTitle")}
              </h1>
              {shareData.description && (
                <p className="text-sm text-muted-foreground">{shareData.description}</p>
              )}
            </div>
            {isAuthenticatedUser && fullReportUrl && (
              <div>
                <Link href={fullReportUrl}>
                  <Button variant="outline" size="sm">
                    <ExternalLink className="h-4 w-4" />
                    {t("viewInFullApp")}
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Project info */}
          {shareData.projectName && (
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("fromProject")}:</span>
              <span className="font-medium">{shareData.projectName}</span>
            </div>
          )}

          {/* Date range if applicable */}
          {config.startDate && config.endDate && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("dateRange")}:</span>
              <span>
                {new Date(config.startDate).toLocaleDateString()} -{" "}
                {new Date(config.endDate).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Report content */}
      <div className="container mx-auto px-4 py-6">
        <ReportRenderer
          results={paginatedResults}
          chartData={reportData.chartData || reportData.results}
          reportType={config.reportType}
          dimensions={reportData.dimensions || []}
          metrics={reportData.metrics || []}
          projectId={shareData.projectId}
          mode={config.mode}
          projects={reportData.projects || []}
          consecutiveRuns={reportData.consecutiveRuns || config.consecutiveRuns || 5}
          staleDaysThreshold={config.staleDaysThreshold}
          minExecutionsForRate={config.minExecutionsForRate}
          lookbackDays={config.lookbackDays}
          dateGrouping={reportData.dateGrouping || config.dateGrouping || "weekly"}
          totalFlakyTests={reportData.totalFlakyTests}
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={reportData.pagination?.totalCount || reportData.results?.length || 0}
          onPageChange={setCurrentPage}
          onPageSizeChange={handlePageSizeChange}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          grouping={grouping}
          onGroupingChange={setGrouping}
          expanded={expanded}
          onExpandedChange={setExpanded}
          readOnly={true}
        />
        <p className="text-center text-sm text-muted-foreground mt-6">
          {t("readOnlyNotice")}
        </p>
      </div>
    </div>
  );
}
