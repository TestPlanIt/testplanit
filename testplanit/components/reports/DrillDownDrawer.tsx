/**
 * Drawer component for displaying drill-down records from report metrics
 */

"use client";

import React, { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Circle, Dot, Download, X } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { DataTable } from "~/components/tables/DataTable";
import LoadingSpinner from "~/components/LoadingSpinner";
import { useDrillDownColumns } from "~/hooks/useDrillDownColumns";
import { useDrillDownExport } from "~/hooks/useDrillDownExport";
import type {
  DrillDownContext,
  DrillDownRecord,
  DrillDownResponse,
} from "~/lib/types/reportDrillDown";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface DrillDownDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** The drill-down context */
  context: DrillDownContext | null;
  /** The loaded records */
  records: DrillDownRecord[];
  /** Total number of records */
  total: number;
  /** Whether there are more records to load */
  hasMore: boolean;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether more records are being loaded */
  isLoadingMore: boolean;
  /** Error if any */
  error: Error | null;
  /** Load more records */
  onLoadMore: () => void;
  /** Aggregate statistics */
  aggregates?: DrillDownResponse["aggregates"];
}

/**
 * Format dimension filters into a readable summary
 */
function formatDimensionSummary(context: DrillDownContext, t: any): string {
  const parts: string[] = [];

  if (context.dimensions.user?.name) {
    parts.push(context.dimensions.user.name);
  }

  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    parts.push(date.toLocaleDateString());
  }

  if (context.dimensions.status?.name) {
    parts.push(context.dimensions.status.name);
  }

  if (context.dimensions.testRun?.name) {
    parts.push(context.dimensions.testRun.name);
  }

  if (context.dimensions.testCase?.name) {
    parts.push(context.dimensions.testCase.name);
  }

  if (context.dimensions.milestone?.name) {
    parts.push(context.dimensions.milestone.name);
  }

  if (context.dimensions.configuration?.name) {
    parts.push(context.dimensions.configuration.name);
  }

  if (context.dimensions.project?.name) {
    parts.push(context.dimensions.project.name);
  }

  return parts.length > 0 ? parts.join(" • ") : t("allRecords");
}

/**
 * Drawer component for drill-down records
 */
export function DrillDownDrawer({
  isOpen,
  onClose,
  context,
  records,
  total,
  hasMore,
  isLoading,
  isLoadingMore,
  error,
  onLoadMore,
  aggregates,
}: DrillDownDrawerProps) {
  const t = useTranslations();
  const tReports = useTranslations("reports.drillDown");
  const tGlobal = useTranslations();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Get columns based on metric type
  const columns = useDrillDownColumns({
    metricId: context?.metricId || "",
  });

  // Export functionality
  const { isExporting, exportToCSV } = useDrillDownExport({
    context,
    t: tGlobal,
  });

  // Infinite scroll: observe the load more trigger
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isLoadingMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoadingMore, isLoading, onLoadMore]);

  if (!context) return null;

  const dimensionSummary = formatDimensionSummary(context, tReports);

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="h-[85vh] flex flex-col">
        <DrawerHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <DrawerTitle className="text-2xl">
                {context.metricLabel}
              </DrawerTitle>
              <DrawerDescription className="mt-1 flex flex-col gap-1">
                <div className="flex items-center">
                  {dimensionSummary} <Dot className="h-4 w-4 shrink-0" />
                  {tReports("recordCount", { count: total })}
                </div>
                {aggregates?.statusCounts &&
                  aggregates.statusCounts.length > 0 && (
                    <div className="flex items-center gap-3 text-sm">
                      {aggregates.passRate !== undefined && (
                        <span className="font-medium">
                          {"Pass Rate: "}
                          {aggregates.passRate.toFixed(1)}
                          {"%"}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        <Dot className="h-4 w-4" />
                      </span>
                      <div className="flex items-center gap-6 flex-wrap">
                        {aggregates.statusCounts.map((sc) => (
                          <span
                            key={sc.statusId}
                            className="flex items-center gap-1"
                          >
                            {sc.statusColor && (
                              <Circle
                                className="h-3 w-3 shrink-0"
                                fill={sc.statusColor}
                                stroke={sc.statusColor}
                              />
                            )}
                            <span className="text-xs">
                              {sc.statusName}
                              {": "}
                              {sc.count}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </DrawerDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={exportToCSV}
                disabled={isExporting || isLoading || records.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting
                  ? tGlobal("repository.exportModal.exporting")
                  : tGlobal("admin.auditLogs.exportCsv")}
              </Button>
              <DrawerClose asChild>
                <Button variant="ghost" size="icon">
                  <X className="h-5 w-5" />
                </Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-auto p-4">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {tReports("error")}: {error.message}
              </AlertDescription>
            </Alert>
          )}

          {isLoading && records.length === 0 && (
            <div className="flex items-center justify-center h-64 w-full">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <LoadingSpinner delay={0} />
                <p className="text-muted-foreground">{tReports("loading")}</p>
              </div>
            </div>
          )}

          {!isLoading && records.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">{tReports("noRecords")}</p>
            </div>
          )}

          {records.length > 0 && (
            <>
              <div className="w-full [&_table]:table-fixed [&>div]:w-full [&>div]:max-w-full">
                <DataTable<DrillDownRecord, any>
                  columns={columns}
                  data={records}
                  isLoading={false}
                  columnVisibility={{}}
                  onColumnVisibilityChange={() => {}}
                  pageSize={records.length} // Show all loaded records
                />
              </div>

              {/* Infinite scroll trigger */}
              <div
                ref={loadMoreRef}
                className="h-20 flex items-center justify-center"
              >
                {isLoadingMore && (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <LoadingSpinner delay={0} />
                    <p className="text-sm text-muted-foreground">
                      {tReports("loadingMore")}
                    </p>
                  </div>
                )}
                {!hasMore && records.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {tReports("allLoaded")}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DrawerFooter className="border-t flex items-center justify-center">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full md:w-lg">
              {t("common.actions.close")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
