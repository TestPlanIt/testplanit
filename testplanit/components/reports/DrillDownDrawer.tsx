/**
 * Drawer component for displaying drill-down records from report metrics
 */

"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Circle, Dot, Download, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import LoadingSpinner from "~/components/LoadingSpinner";
import { DataTable } from "~/components/tables/DataTable";
import { useDrillDownColumns } from "~/hooks/useDrillDownColumns";
import { useDrillDownExport } from "~/hooks/useDrillDownExport";
import type {
  DrillDownContext,
  DrillDownRecord,
  DrillDownResponse,
} from "~/lib/types/reportDrillDown";

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
  const locale = useLocale();

  // Get columns based on metric type
  const columns = useDrillDownColumns({
    metricId: context?.metricId || "",
    reportType: context?.reportType,
  });

  // Export functionality
  const { isExporting, exportToCSV } = useDrillDownExport({
    context,
    t: tGlobal,
  });

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
              {/* DrawerDescription renders a <p>, so children must be
                  phrasing content (spans) to avoid a hydration error. */}
              <DrawerDescription className="mt-1 flex flex-col gap-1">
                <span className="flex items-center">
                  {dimensionSummary} <Dot className="h-4 w-4 shrink-0" />
                  {/* Loaded-vs-total, matching the other incremental tables —
                      the drawer appends pages on scroll, so a bare total
                      wouldn't say how much is actually on screen. */}
                  {t("admin.auditLogs.showing", {
                    loaded: records.length.toLocaleString(locale),
                    total: total.toLocaleString(locale),
                  })}
                </span>
                {aggregates?.statusCounts &&
                  aggregates.statusCounts.length > 0 && (
                    <span className="flex items-center gap-3 text-sm">
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
                      <span className="flex items-center gap-6 flex-wrap">
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
                      </span>
                    </span>
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
                <Download className="h-4 w-4" />
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

        <div className="flex min-h-0 flex-1 flex-col p-4">
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
              {/* Virtualized: only the visible window hits the DOM, and the
                  engine owns the fetch-on-scroll trigger and the loading-more
                  skeleton — a drill-down can hold tens of thousands of rows. */}
              <div className="min-h-0 flex-1">
                <DataTable
                  virtualized
                  pinLastColumn={false}
                  columns={columns as any}
                  data={records}
                  columnVisibility={{}}
                  onColumnVisibilityChange={() => {}}
                  hasMore={hasMore}
                  isLoading={isLoadingMore}
                  onLoadMore={onLoadMore}
                  testIdPrefix="drill-down-table"
                  rowTestIdPrefix="drill-down-row"
                />
              </div>
              {!hasMore && (
                <p className="shrink-0 pt-2 text-center text-sm text-muted-foreground">
                  {tReports("allLoaded")}
                </p>
              )}
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
