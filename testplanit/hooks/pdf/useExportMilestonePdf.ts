"use client";

import { useCallback, useState } from "react";
import { logDataExport } from "~/lib/services/auditClient";
import type { MilestoneExportData } from "~/lib/services/milestoneExport";
import { toHumanReadable } from "~/utils/duration";
import { hexToRgb, PdfRenderer, type StatusToken } from "./pdfHelpers";

interface UseExportMilestonePdfProps {
  milestoneId: number | null | undefined;
  /** Used for the export audit entry; falls back to the milestone's project. */
  projectId?: number;
  locale?: string;
  /** Current user's display name, stamped into the generation header. */
  generatedByName?: string | null;
}

const DECISION_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes Requested",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function useExportMilestonePdf({
  milestoneId,
  projectId,
  locale = "en-US",
  generatedByName,
}: UseExportMilestonePdfProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!milestoneId) return;
    setIsExporting(true);

    try {
      const res = await fetch(`/api/milestones/${milestoneId}/export`);
      if (!res.ok) {
        throw new Error(`Export request failed with status ${res.status}`);
      }
      const data = (await res.json()) as MilestoneExportData;

      const fmtDate = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString(locale) : "—";
      const fmtDateTime = (iso: string | null) =>
        iso ? new Date(iso).toLocaleString(locale) : "—";
      const fmtDuration = (seconds: number) =>
        seconds > 0
          ? toHumanReadable(seconds, { isSeconds: true, locale })
          : "—";
      // Color-coded status tokens so statuses are easy to identify, matching
      // the run/session PDF exports.
      const statusTokens = (
        counts: { statusName: string; count: number; colorValue: string }[]
      ): StatusToken[] =>
        counts.map((c) => ({
          text: `${c.statusName}: ${c.count}`,
          color: hexToRgb(c.colorValue),
        }));

      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pdf = new PdfRenderer(doc);

      const generatedAtLabel = fmtDateTime(data.generatedAt);

      // Enable the per-page header band before rendering body content so the
      // first page's title clears it; the band itself is drawn in the finishing
      // pass below.
      pdf.setReportMeta({
        documentName: data.milestone.name,
        generatedAt: generatedAtLabel,
        generatedByName,
      });

      // --- Title + generation line ---
      pdf.renderTitle("Milestone Report");
      pdf.renderMetaLine(
        `Generated: ${generatedAtLabel}`,
        generatedByName ? `By: ${generatedByName}` : undefined
      );
      pdf.addSpace(2);

      // --- Milestone metadata ---
      pdf.renderSectionHeader(data.milestone.name);
      pdf.renderField("Status", data.milestone.status);
      pdf.renderField("Type", data.milestone.typeName);
      pdf.renderField("Owner", data.milestone.ownerName);
      if (data.milestone.parentPath.length > 0) {
        pdf.renderField("Path", data.milestone.parentPath.join(" / "));
      }
      pdf.renderField("Started", fmtDate(data.milestone.startedAt));
      pdf.renderField("Completed", fmtDate(data.milestone.completedAt));
      pdf.renderField("Created", fmtDate(data.milestone.createdAt));

      // --- Aggregate summary (first) ---
      pdf.renderSectionHeader("Summary");
      pdf.renderField(
        "Completion",
        `${Math.round(data.rollup.completionRate)}%`
      );
      pdf.renderField(
        "Executed",
        `${data.rollup.executedItems} of ${data.rollup.totalItems}`
      );
      pdf.renderField("Total Elapsed", fmtDuration(data.rollup.totalElapsed));
      pdf.renderField("Total Estimate", fmtDuration(data.rollup.totalEstimate));
      if (data.rollup.statusCounts.length > 0) {
        pdf.renderStatusBreakdown(
          "Status Breakdown",
          statusTokens(data.rollup.statusCounts)
        );
      }

      // --- Contributing test runs ---
      if (data.testRuns.length > 0) {
        pdf.renderSectionHeader(
          `Contributing Test Runs (${data.testRuns.length})`
        );
        pdf.renderTable({
          columns: [
            { header: "Test Run", width: 3.6 },
            { header: "Executed", width: 1.4 },
            { header: "Total", width: 1, align: "right" },
            { header: "Elapsed", width: 2 },
            { header: "Status Breakdown", width: 3.6 },
          ],
          rows: data.testRuns.map((r) => [
            r.name,
            String(r.executedItems),
            String(r.totalItems),
            fmtDuration(r.elapsed),
            statusTokens(r.statusCounts),
          ]),
        });
      }

      // --- Contributing sessions ---
      if (data.sessions.length > 0) {
        pdf.renderSectionHeader(
          `Contributing Sessions (${data.sessions.length})`
        );
        pdf.renderTable({
          columns: [
            { header: "Session", width: 5 },
            { header: "Latest Status", width: 2 },
            { header: "Elapsed", width: 2 },
          ],
          rows: data.sessions.map((s) => [
            s.name,
            [{ text: s.statusName, color: hexToRgb(s.colorValue) }],
            fmtDuration(s.elapsed),
          ]),
        });
      }

      // --- Descendant sub-milestones ---
      if (data.descendants.length > 0) {
        pdf.renderSectionHeader(`Sub-milestones (${data.descendants.length})`);
        pdf.renderTable({
          columns: [
            { header: "Sub-milestone", width: 5 },
            { header: "Status", width: 3 },
          ],
          rows: data.descendants.map((d) => [d.name, d.status]),
        });
      }

      // --- Linked issues ---
      if (data.issues.length > 0) {
        pdf.renderSectionHeader(`Linked Issues (${data.issues.length})`);
        pdf.renderTable({
          columns: [
            { header: "Issue", width: 2 },
            { header: "Title", width: 5 },
            { header: "Status", width: 2 },
          ],
          rows: data.issues.map((i) => [i.key, i.title, i.status ?? "—"]),
        });
      }

      // --- Member Issues (milestone-sync Issues panel, MLINK-04) ---
      if (data.memberIssues.length > 0) {
        pdf.renderSectionHeader(`Member Issues (${data.memberIssues.length})`);
        const totals = data.memberCoverageTotals;
        const totalsTokens: StatusToken[] = [
          ...statusTokens(totals.statuses),
          ...(totals.untested > 0
            ? [
                {
                  text: `Untested: ${totals.untested}`,
                  color: hexToRgb("#9ca3af"),
                },
              ]
            : []),
          ...(totals.uncoveredIssues > 0
            ? [
                {
                  text: `Uncovered issues: ${totals.uncoveredIssues}`,
                  color: hexToRgb("#d97706"),
                },
              ]
            : []),
        ];
        if (totalsTokens.length > 0) {
          pdf.renderStatusBreakdown("Coverage Totals", totalsTokens);
        }
        pdf.renderTable({
          columns: [
            { header: "Issue", width: 1.8 },
            { header: "Title", width: 4 },
            { header: "Status", width: 1.6 },
            { header: "Coverage", width: 3.2 },
            { header: "Source", width: 1.2 },
          ],
          rows: data.memberIssues.map((member) => [
            member.key,
            member.title,
            member.status ?? "—",
            member.uncovered
              ? ([
                  { text: "Uncovered", color: hexToRgb("#d97706") },
                ] as StatusToken[])
              : ([
                  ...statusTokens(member.coverageStatuses),
                  ...(member.untested > 0
                    ? [
                        {
                          text: `Untested: ${member.untested}`,
                          color: hexToRgb("#9ca3af"),
                        },
                      ]
                    : []),
                ] as StatusToken[]),
            member.source === "SYNCED" ? "Synced" : "Manual",
          ]),
        });
      }

      // --- Review & Approval decisions ---
      if (data.reviewDecisions.length > 0) {
        pdf.renderSectionHeader(
          `Review & Approval Decisions (${data.reviewDecisions.length})`
        );
        pdf.renderTable({
          columns: [
            { header: "Item", width: 3 },
            { header: "Decision", width: 2 },
            { header: "Decided By", width: 2.5 },
            { header: "Date", width: 2 },
            { header: "Comment", width: 4 },
          ],
          rows: data.reviewDecisions.map((d) => [
            d.entityName,
            DECISION_LABELS[d.status] ?? d.status,
            d.decidedByName ?? "—",
            fmtDate(d.decidedAt),
            d.decisionComment ?? "—",
          ]),
        });
      }

      // --- Per-page header/footer + save ---
      pdf.addHeadersAndFooters();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`milestone-export-${timestamp}.pdf`);

      void logDataExport({
        exportType: "PDF",
        entityType: "milestone",
        recordCount: 1,
        projectId: projectId ?? data.projectId,
      });
    } catch (error) {
      console.error("Milestone PDF export failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [milestoneId, projectId, locale, generatedByName]);

  return { isExporting, handleExport };
}
