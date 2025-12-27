/**
 * Hook for exporting drill-down data to CSV
 */

import { useState, useCallback } from "react";
import Papa from "papaparse";
import type {
  DrillDownContext,
  DrillDownRecord,
} from "~/lib/types/reportDrillDown";
import { format } from "date-fns";
import { toHumanReadable } from "~/utils/duration";
import { logDataExport } from "~/lib/services/auditClient";

interface UseDrillDownExportProps {
  /** The drill-down context */
  context: DrillDownContext | null;
  /** Translation function */
  t: any;
  /** Translation function for reports */
  tReports: any;
}

interface UseDrillDownExportReturn {
  /** Whether export is in progress */
  isExporting: boolean;
  /** Export all drill-down data to CSV */
  exportToCSV: () => Promise<void>;
}

/**
 * Hook for exporting drill-down data to CSV
 */
export function useDrillDownExport({
  context,
  t,
  tReports,
}: UseDrillDownExportProps): UseDrillDownExportReturn {
  const [isExporting, setIsExporting] = useState(false);

  /**
   * Fetch all records (no pagination limit)
   */
  const fetchAllRecords = useCallback(
    async (ctx: DrillDownContext): Promise<DrillDownRecord[]> => {
      const allRecords: DrillDownRecord[] = [];
      let offset = 0;
      const limit = 500; // Fetch in batches of 500
      let hasMore = true;

      while (hasMore) {
        const response = await fetch("/api/report-builder/drill-down", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            context: ctx,
            offset,
            limit,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch drill-down data for export");
        }

        const data = await response.json();
        allRecords.push(...data.data);
        hasMore = data.hasMore;
        offset += limit;
      }

      return allRecords;
    },
    []
  );

  /**
   * Transform records to CSV format based on metric type
   */
  const transformRecordsToCSV = useCallback(
    (records: DrillDownRecord[], metricId: string): Record<string, any>[] => {
      // Test execution records
      if (metricId === "testResults" || metricId === "passRate") {
        return records.map((record: any) => ({
          [tReports("caseName")]:
            record.testRunCase?.repositoryCase?.name || "",
          [tReports("runName")]: record.testRun?.name || "",
          [tReports("status")]: record.status?.name || "",
          [tReports("executedBy")]: record.executedBy?.name || "",
          [tReports("date")]: record.executedAt
            ? format(new Date(record.executedAt), "yyyy-MM-dd HH:mm:ss")
            : "",
          [tReports("elapsedTime")]: record.elapsed
            ? toHumanReadable(record.elapsed)
            : "",
          [t("common.fields.configuration")]:
            record.testRun?.configuration?.name || "",
          [t("common.fields.notes")]: record.notes
            ? JSON.stringify(record.notes)
            : "",
        }));
      }

      // Average Elapsed Time metrics
      if (
        metricId === "avgElapsed" ||
        metricId === "avgElapsedTime" ||
        metricId === "averageElapsed"
      ) {
        return records.map((record: any) => ({
          [tReports("elapsedTime")]: record.elapsed
            ? toHumanReadable(record.elapsed)
            : "",
          [tReports("caseName")]:
            record.testRunCase?.repositoryCase?.name || "",
          [tReports("runName")]: record.testRun?.name || "",
          [tReports("executedBy")]: record.executedBy?.name || "",
          [tReports("date")]: record.executedAt
            ? format(new Date(record.executedAt), "yyyy-MM-dd HH:mm:ss")
            : "",
        }));
      }

      // Total Elapsed Time metrics
      if (metricId === "sumElapsed" || metricId === "totalElapsedTime") {
        return records.map((record: any) => ({
          [tReports("elapsedTime")]: record.elapsed
            ? toHumanReadable(record.elapsed)
            : "",
          [tReports("caseName")]:
            record.testRunCase?.repositoryCase?.name || "",
          [tReports("runName")]: record.testRun?.name || "",
          [tReports("executedBy")]: record.executedBy?.name || "",
          [tReports("date")]: record.executedAt
            ? format(new Date(record.executedAt), "yyyy-MM-dd HH:mm:ss")
            : "",
        }));
      }

      // Test runs
      if (metricId === "testRuns") {
        return records.map((record: any) => {
          const total =
            (record.passed || 0) +
            (record.failed || 0) +
            (record.blocked || 0) +
            (record.untested || 0);
          const executed = total - (record.untested || 0);

          return {
            [tReports("runName")]: record.name || "",
            [tReports("status")]: record.status?.name || "",
            [t("common.fields.createdBy")]: record.createdBy?.name || "",
            [t("common.fields.startDate")]: record.startedAt
              ? format(new Date(record.startedAt), "yyyy-MM-dd HH:mm:ss")
              : "",
            [t("common.fields.progress")]:
              total > 0 ? `${executed}/${total}` : "",
            [t("common.fields.milestone")]: record.milestone?.name || "",
            [t("common.fields.passed")]: record.passed || 0,
            [t("common.fields.failed")]: record.failed || 0,
            [t("common.fields.blocked")]: record.blocked || 0,
            [t("common.fields.untested")]: record.untested || 0,
          };
        });
      }

      // Test cases
      if (metricId === "testCases") {
        return records.map((record: any) => ({
          [tReports("caseName")]: record.name || "",
          [tReports("status")]: record.status?.name || "",
          [t("common.fields.folder")]: record.folder?.name || "",
          [t("common.fields.createdAt")]: record.createdAt
            ? format(new Date(record.createdAt), "yyyy-MM-dd")
            : "",
        }));
      }

      // Repository stats metrics (averageSteps, totalSteps, automatedCount, manualCount, testCaseCount)
      if (
        metricId === "averageSteps" ||
        metricId === "totalSteps" ||
        metricId === "avgStepsPerCase" ||
        metricId === "automatedCount" ||
        metricId === "manualCount" ||
        metricId === "testCaseCount"
      ) {
        return records.map((record: any) => {
          const result: Record<string, any> = {
            ID: record.id || "",
            [tReports("caseName")]: record.name || "",
            [t("common.fields.project")]: record.project?.name || "",
            [t("common.fields.folder")]: record.folder?.name || "",
            [tReports("status")]: record.state?.name || "",
            [t("common.fields.createdBy")]:
              record.creator?.name || record.creator?.email || "",
            [t("common.fields.template")]: record.template?.templateName || "",
            [t("common.fields.createdAt")]: record.createdAt
              ? format(new Date(record.createdAt), "yyyy-MM-dd HH:mm:ss")
              : "",
          };

          // Add step count for averageSteps and totalSteps
          if (
            metricId === "averageSteps" ||
            metricId === "totalSteps" ||
            metricId === "avgStepsPerCase"
          ) {
            result[tReports("steps")] = record.steps?.length || 0;
          }

          // Add other fields that might be useful
          if (record.className) result["Class Name"] = record.className;
          if (record.source) result["Source"] = record.source;
          if (record.automated !== undefined)
            result["Automated"] = record.automated ? "Yes" : "No";
          if (record.estimate) result["Estimate"] = record.estimate;

          return result;
        });
      }

      // Sessions
      if (metricId === "sessions" || metricId === "sessionCount") {
        return records.map((record: any) => ({
          [t("common.name")]: record.name || "",
          [t("common.fields.charter")]: record.charter || "",
          [t("common.fields.createdBy")]: record.createdBy?.name || "",
          [t("common.fields.startDate")]: record.startedAt
            ? format(new Date(record.startedAt), "yyyy-MM-dd HH:mm:ss")
            : "",
          [t("common.fields.duration")]: record.duration
            ? toHumanReadable(record.duration)
            : "",
        }));
      }

      // Session Duration metrics
      if (
        metricId === "sessionDuration" ||
        metricId === "averageTimeSpent" ||
        metricId === "averageDuration" ||
        metricId === "totalDuration"
      ) {
        return records.map((record: any) => ({
          [t("common.name")]: record.name || "",
          [t("common.fields.duration")]: record.duration
            ? toHumanReadable(record.duration)
            : "",
          [t("common.fields.charter")]: record.charter || "",
          [t("common.fields.createdBy")]: record.createdBy?.name || "",
          [t("common.fields.startDate")]: record.startedAt
            ? format(new Date(record.startedAt), "yyyy-MM-dd HH:mm:ss")
            : "",
        }));
      }

      // Issues
      if (metricId === "issues") {
        return records.map((record: any) => ({
          [t("common.fields.key")]: record.key || "",
          [t("common.fields.summary")]: record.summary || "",
          [tReports("status")]: record.issueStatus?.name || "",
          [t("common.fields.priority")]: record.issuePriority?.name || "",
          [t("common.fields.assignee")]: record.assignee?.name || "",
          [t("common.fields.createdAt")]: record.createdAt
            ? format(new Date(record.createdAt), "yyyy-MM-dd")
            : "",
        }));
      }

      // Milestone records
      if (metricId === "totalMilestones" || metricId === "activeMilestones") {
        return records.map((record: any) => ({
          ID: record.id || "",
          Milestone: record.name || "",
          [t("common.fields.project")]: record.project?.name || "",
          [t("common.fields.createdBy")]:
            record.creator?.name || record.creator?.email || "",
          Status: record.isCompleted
            ? "Completed"
            : record.isStarted
              ? "In Progress"
              : "Not Started",
          [t("common.fields.createdAt")]: record.createdAt
            ? format(new Date(record.createdAt), "yyyy-MM-dd HH:mm:ss")
            : "",
        }));
      }

      // Default format - flatten objects to avoid [object Object]
      return records.map((record: any) => {
        const flattened: Record<string, any> = {
          ID: record.id || "",
        };

        // Flatten the record, converting objects to strings
        for (const [key, value] of Object.entries(record)) {
          if (key === "id") continue; // Already added as ID

          if (value === null || value === undefined) {
            flattened[key] = "";
          } else if (typeof value === "object") {
            // Handle arrays
            if (Array.isArray(value)) {
              flattened[key] = value.length > 0 ? value.length.toString() : "";
            }
            // Handle objects - extract name or stringify
            else {
              const obj = value as Record<string, any>;
              if (obj.name !== undefined) {
                flattened[key] = obj.name;
              } else if (obj.email !== undefined) {
                flattened[key] = obj.email;
              } else if (obj.templateName !== undefined) {
                flattened[key] = obj.templateName;
              } else if (value instanceof Date) {
                flattened[key] = format(value, "yyyy-MM-dd HH:mm:ss");
              } else {
                // Fallback: try to stringify, but avoid [object Object]
                flattened[key] = JSON.stringify(value);
              }
            }
          } else if (value instanceof Date) {
            flattened[key] = format(value, "yyyy-MM-dd HH:mm:ss");
          } else {
            flattened[key] = value;
          }
        }

        return flattened;
      });
    },
    [t, tReports]
  );

  /**
   * Generate a filename based on context
   */
  const generateFileName = useCallback((ctx: DrillDownContext): string => {
    const parts = [
      "drill-down",
      ctx.metricLabel.toLowerCase().replace(/\s+/g, "-"),
    ];

    // Add dimension values to filename
    if (ctx.dimensions.user?.name) {
      parts.push(ctx.dimensions.user.name.toLowerCase().replace(/\s+/g, "-"));
    }
    if (ctx.dimensions.date?.executedAt) {
      const date = new Date(ctx.dimensions.date.executedAt);
      parts.push(format(date, "yyyy-MM-dd"));
    }
    if (ctx.dimensions.status?.name) {
      parts.push(ctx.dimensions.status.name.toLowerCase().replace(/\s+/g, "-"));
    }

    parts.push(format(new Date(), "yyyy-MM-dd-HHmmss"));
    return `${parts.join("-")}.csv`;
  }, []);

  /**
   * Export all drill-down data to CSV
   */
  const exportToCSV = useCallback(async () => {
    if (!context) return;

    setIsExporting(true);

    try {
      // Fetch all records
      const allRecords = await fetchAllRecords(context);

      // Transform to CSV format
      const csvData = transformRecordsToCSV(allRecords, context.metricId);

      // Generate CSV using papaparse
      const csvString = Papa.unparse(csvData, {
        delimiter: ",",
        header: true,
        quotes: true,
        escapeFormulae: true,
      });

      // Create blob and download
      const blob = new Blob(["\uFEFF" + csvString], {
        type: "text/csv;charset=utf-8;",
      });

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = generateFileName(context);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      // Log export for audit trail
      logDataExport({
        exportType: "DrillDown-CSV",
        entityType: context.metricId,
        recordCount: allRecords.length,
        filters: {
          metricLabel: context.metricLabel,
          dimensions: context.dimensions,
        },
        projectId: context.projectId,
      });
    } catch (error) {
      console.error("Export error:", error);
      throw error;
    } finally {
      setIsExporting(false);
    }
  }, [context, fetchAllRecords, transformRecordsToCSV, generateFileName]);

  return {
    isExporting,
    exportToCSV,
  };
}
