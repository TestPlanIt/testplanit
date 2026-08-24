"use client";

import { useCallback, useState } from "react";
import { logDataExport } from "~/lib/services/auditClient";
import type { RequirementTraceabilityData } from "~/app/api/projects/[projectId]/requirements/traceability/route";
import {
  hexToRgb,
  PdfRenderer,
  sanitizeTextForPdf,
  type StatusToken,
} from "./pdfHelpers";

/**
 * The traceability PDF export hook (COV-04's PDF half, per locked decision
 * D-3). Forks `useExportMilestonePdf`'s already-shipped "Traceability
 * matrix (READY, D4)" section (`useExportMilestonePdf.ts:266-298`) onto
 * the requirement traceability matrix loaded from
 * `app/api/projects/[projectId]/requirements/traceability/route.ts`.
 * `hooks/pdf/pdfHelpers.ts` is reused verbatim — imported, not changed.
 *
 * Carve-out 1 (I18N-01): this file's section headers and column labels
 * are English literals on purpose, not by omission. `sanitizeTextForPdf`
 * (`pdfHelpers.ts:34-59`) maps every character outside Latin-1 to "?"
 * because jsPDF's standard fonts carry no other glyphs, and no PDF hook
 * imports `next-intl` — localizing this file's chrome into `ar-SA` or
 * `cs-CZ` would emit a page of question marks instead of a report. The
 * *invocation* (menu label, toast, error) is normal React and IS
 * localized, in `RequirementsWorkspace.tsx`.
 *
 * Carve-out 1 also governs the "Generated:"/per-page-header/"Executed"
 * dates below (F7): `fmtDate`/`fmtDateTime` deliberately format with a
 * fixed Latin-digit locale rather than the viewer's own `locale`, because
 * `toLocaleDateString`/`toLocaleString` under a locale like `ar-SA` emit
 * Arabic-Indic digits, which `sanitizeTextForPdf` then reduces to
 * "???/??/????" — a blank/garbled date instead of a readable one. This
 * is the same carve-out already applied to the surrounding chrome, just
 * honored consistently rather than left half-applied to these two
 * formatters.
 */
const PDF_DATE_LOCALE = "en-US";
interface UseExportRequirementTraceabilityPdfProps {
  projectId: number;
  /**
   * Kept for call-site symmetry with `useExportMilestonePdf` (and because
   * `RequirementsWorkspace.tsx` already threads its own app locale
   * through here) but NOT used to format the "Generated:"/"Executed"
   * dates below — see the F7 carve-out note above `PDF_DATE_LOCALE`.
   * Those always render in a fixed Latin-digit locale regardless of what
   * is passed here.
   */
  locale?: string;
  /** Current user's display name, stamped into the generation header. */
  generatedByName?: string | null;
  /**
   * Called when the export fails, so a caller-owned toast can show a
   * localized error message. The hook itself never rethrows (see the
   * rejection test below) and never imports `next-intl` (carve-out 1),
   * so localization of the failure message stays at the call site —
   * `RequirementsWorkspace.tsx`.
   */
  onError?: (error: unknown) => void;
}

export function useExportRequirementTraceabilityPdf({
  projectId,
  locale = "en-US",
  generatedByName,
  onError,
}: UseExportRequirementTraceabilityPdfProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/traceability`
      );
      if (!res.ok) {
        throw new Error(`Export request failed with status ${res.status}`);
      }
      const data = (await res.json()) as RequirementTraceabilityData;

      const fmtDate = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString(PDF_DATE_LOCALE) : "—";
      const fmtDateTime = (iso: string | null) =>
        iso ? new Date(iso).toLocaleString(PDF_DATE_LOCALE) : "—";

      const { default: jsPDF } = await import("jspdf");
      // A traceability matrix is wide (requirement path, case, result,
      // executed date, project) and is meant to be read as a table — the
      // milestone exporter's portrait default would waste most of the
      // page width here, so this exporter deliberately uses landscape
      // instead.
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const pdf = new PdfRenderer(doc);

      const generatedAtLabel = fmtDateTime(data.generatedAt);

      // Enable the per-page header band before rendering body content so
      // the first page's title clears it; the band itself is drawn in the
      // finishing pass below.
      pdf.setReportMeta({
        documentName: `${data.projectName} — Requirement Traceability`,
        generatedAt: generatedAtLabel,
        generatedByName,
      });

      // --- Title + generation line ---
      pdf.renderTitle("Requirement Traceability Matrix");
      pdf.renderMetaLine(
        `Generated: ${generatedAtLabel}`,
        generatedByName ? `By: ${generatedByName}` : undefined
      );
      pdf.addSpace(2);

      // --- Summary: total requirements, total uncovered ---
      const totalRequirements = new Set(
        data.rows.map((row) => row.requirementId)
      ).size;
      const totalUncovered = new Set(
        data.rows
          .filter((row) => row.caseId === null)
          .map((row) => row.requirementId)
      ).size;

      pdf.renderField("Project", sanitizeTextForPdf(data.projectName));
      pdf.renderField("Total Requirements", String(totalRequirements));
      pdf.renderField("Total Uncovered", String(totalUncovered));
      pdf.addSpace(2);

      // --- Traceability matrix: Requirement -> Case -> latest result ---
      pdf.renderSectionHeader(`Traceability (${data.rows.length})`);
      pdf.renderTable({
        columns: [
          { header: "Requirement", width: 2.6 },
          { header: "Test Case", width: 3.2 },
          { header: "Result", width: 1.6 },
          { header: "Executed", width: 1.8 },
          { header: "Project", width: 1.6 },
        ],
        rows: data.rows.map((row) => [
          sanitizeTextForPdf(row.requirementPath),
          row.caseName ? sanitizeTextForPdf(row.caseName) : "—",
          row.caseId == null
            ? ([
                { text: "Uncovered", color: hexToRgb("#d97706") },
              ] as StatusToken[])
            : row.statusName
              ? ([
                  {
                    text: row.statusName,
                    color: hexToRgb(row.statusColor ?? "#6b7280"),
                  },
                ] as StatusToken[])
              : ([
                  { text: "Not run", color: hexToRgb("#9ca3af") },
                ] as StatusToken[]),
          fmtDate(row.executedAt),
          row.caseProjectName ? sanitizeTextForPdf(row.caseProjectName) : "—",
        ]),
      });

      // --- Per-page header/footer + save ---
      pdf.addHeadersAndFooters();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`requirement-traceability-${timestamp}.pdf`);

      // `logDataExport` is void-ed and never awaited: `auditClient.ts`
      // swallows all of its own errors, so a failed audit write can never
      // fail — or delay — a successful export.
      void logDataExport({
        exportType: "PDF",
        entityType: "requirement",
        recordCount: data.rows.length,
        projectId,
      });
    } catch (error) {
      console.error("Requirement traceability PDF export failed:", error);
      onError?.(error);
    } finally {
      setIsExporting(false);
    }
  }, [projectId, locale, generatedByName, onError]);

  return { isExporting, handleExport };
}
