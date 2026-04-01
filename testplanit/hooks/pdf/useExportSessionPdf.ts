"use client";

import { useCallback, useState } from "react";
import { logDataExport } from "~/lib/services/auditClient";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { toHumanReadable } from "~/utils/duration";
import { PdfRenderer, preloadImages, formatFieldValue } from "./pdfHelpers";

interface SessionExportData {
  id: number;
  name: string;
  template?: {
    templateName?: string;
    caseFields?: {
      caseField: {
        id: number;
        displayName: string;
        type?: { type?: string };
        fieldOptions?: { fieldOption: { id: number; name: string } }[];
      };
    }[];
  } | null;
  configuration?: { name?: string } | null;
  milestone?: { name?: string } | null;
  state?: { name?: string } | null;
  assignedTo?: { name?: string | null } | null;
  createdBy?: { name?: string | null } | null;
  estimate?: number | null;
  elapsed?: number | null;
  note?: any;
  mission?: any;
  isCompleted?: boolean;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
  tags?: { id: number; name: string }[];
  issues?: { name?: string; title?: string | null; externalId?: string | null; externalKey?: string | null }[];
  attachments?: { url?: string; name?: string; mimeType?: string | null; isDeleted?: boolean }[];
  sessionFieldValues?: {
    fieldId: number;
    value: any;
    field?: {
      displayName?: string;
      type?: { type?: string };
    };
  }[];
  sessionResults?: {
    id: number;
    resultData?: any;
    elapsed?: number | null;
    createdAt?: Date | string;
    createdBy?: { name?: string | null } | null;
    status?: { name?: string; color?: { value?: string } | null } | null;
    attachments?: { url?: string; name?: string; mimeType?: string | null; isDeleted?: boolean }[];
    issues?: { name?: string; title?: string | null; externalId?: string | null; externalKey?: string | null }[];
    resultFieldValues?: {
      fieldId: number;
      value: any;
      field?: {
        displayName?: string;
        type?: { type?: string };
      };
    }[];
  }[];
  project?: { id?: number; name?: string } | null;
}

interface UseExportSessionPdfProps {
  sessionData: SessionExportData | null;
  embedImages?: boolean;
  locale?: string;
}

export function useExportSessionPdf({
  sessionData,
  embedImages = true,
  locale = "en-US",
}: UseExportSessionPdfProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!sessionData) return;
    setIsExporting(true);

    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdf = new PdfRenderer(doc);

      // --- Title ---
      pdf.renderTitle("Session Export");
      pdf.renderMetaLine(
        `Exported: ${new Date().toLocaleString()}`,
        sessionData.project?.name ? `Project: ${sessionData.project.name}` : undefined
      );
      pdf.addSpace(4);

      // --- Session Header ---
      pdf.renderSectionHeader(sessionData.name);

      // --- Metadata ---
      pdf.renderField("Template", sessionData.template?.templateName);
      pdf.renderField("Configuration", sessionData.configuration?.name);
      pdf.renderField("Milestone", sessionData.milestone?.name);
      pdf.renderField("State", sessionData.state?.name);
      pdf.renderField("Assigned To", sessionData.assignedTo?.name);
      pdf.renderField("Created By", sessionData.createdBy?.name);

      if (sessionData.estimate) {
        pdf.renderField(
          "Estimate",
          toHumanReadable(sessionData.estimate, { isSeconds: true, locale })
        );
      }
      if (sessionData.elapsed) {
        pdf.renderField(
          "Elapsed",
          toHumanReadable(sessionData.elapsed, { isSeconds: true, locale })
        );
      }
      if (sessionData.createdAt) {
        pdf.renderField(
          "Created",
          new Date(sessionData.createdAt).toLocaleString()
        );
      }
      if (sessionData.isCompleted && sessionData.completedAt) {
        pdf.renderField(
          "Completed",
          new Date(sessionData.completedAt).toLocaleString()
        );
      }

      // --- Tags ---
      if (sessionData.tags && sessionData.tags.length > 0) {
        pdf.renderField(
          "Tags",
          sessionData.tags.map((t) => t.name).join(", ")
        );
      }

      // --- Issues ---
      if (sessionData.issues && sessionData.issues.length > 0) {
        pdf.renderField(
          "Issues",
          sessionData.issues
            .map((i) => {
              const key = i.externalKey || i.externalId || "";
              const title = i.title || i.name || "";
              return key && title ? `${key}: ${title}` : title || key;
            })
            .filter(Boolean)
            .join(", ")
        );
      }

      // --- Custom Fields (Session-level) ---
      if (sessionData.sessionFieldValues && sessionData.sessionFieldValues.length > 0) {
        for (const fv of sessionData.sessionFieldValues) {
          if (fv.value === null || fv.value === undefined) continue;
          const fieldDef = sessionData.template?.caseFields?.find(
            (tcf) => tcf.caseField.id === fv.fieldId
          )?.caseField;
          const displayName = fv.field?.displayName || fieldDef?.displayName || `Field ${fv.fieldId}`;
          const fieldType = fv.field?.type?.type || fieldDef?.type?.type;
          const formatted = formatFieldValue(fv.value, fieldType, fieldDef?.fieldOptions);
          if (formatted) {
            pdf.renderField(displayName, formatted);
          }
        }
      }

      // --- Description / Note ---
      const noteText = extractJsonText(sessionData.note);
      if (noteText) {
        pdf.renderTextBlock("Description", noteText);
      }

      // --- Mission ---
      const missionText = extractJsonText(sessionData.mission);
      if (missionText) {
        pdf.renderTextBlock("Mission", missionText);
      }

      // --- Session Attachments ---
      if (embedImages && sessionData.attachments && sessionData.attachments.length > 0) {
        const { images, nonImageNames } = await preloadImages(sessionData.attachments);
        pdf.renderImages(images);
        pdf.renderAttachmentNames(nonImageNames);
      } else if (sessionData.attachments && sessionData.attachments.length > 0) {
        const names = sessionData.attachments
          .filter((a) => !a.isDeleted && a.name)
          .map((a) => a.name!);
        if (names.length > 0) {
          pdf.renderField("Attachments", names.join(", "));
        }
      }

      // --- Session Results ---
      const results = sessionData.sessionResults?.filter((r) => r.status) || [];
      if (results.length > 0) {
        pdf.addSpace(5);
        pdf.renderSectionHeader(`Session Results (${results.length})`);

        // Summary
        const statusCounts: Record<string, number> = {};
        let totalElapsed = 0;
        results.forEach((r) => {
          const statusName = r.status?.name || "Unknown";
          statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;
          if (r.elapsed) totalElapsed += r.elapsed;
        });

        const summaryParts = Object.entries(statusCounts)
          .map(([name, count]) => `${name}: ${count}`)
          .join("  |  ");
        pdf.renderField("Summary", summaryParts);
        if (totalElapsed > 0) {
          pdf.renderField(
            "Total Time",
            toHumanReadable(totalElapsed, { isSeconds: true, locale })
          );
        }
        pdf.addSpace(3);

        // Individual results
        for (let i = 0; i < results.length; i++) {
          const result = results[i];

          pdf.ensureSpace(30);
          pdf.renderSubHeader(`Result #${i + 1}`);
          pdf.renderField("Status", result.status?.name || "Unknown");

          if (result.createdBy?.name) {
            pdf.renderField("Recorded By", result.createdBy.name);
          }
          if (result.createdAt) {
            pdf.renderField("Date", new Date(result.createdAt).toLocaleString());
          }
          if (result.elapsed) {
            pdf.renderField(
              "Elapsed",
              toHumanReadable(result.elapsed, { isSeconds: true, locale })
            );
          }

          // Result data (Tiptap JSON)
          const resultText = extractJsonText(result.resultData);
          if (resultText) {
            pdf.renderTextBlock("Notes", resultText);
          }

          // Result custom fields
          if (result.resultFieldValues && result.resultFieldValues.length > 0) {
            for (const rfv of result.resultFieldValues) {
              if (rfv.value === null || rfv.value === undefined) continue;
              const displayName = rfv.field?.displayName || `Field ${rfv.fieldId}`;
              const fieldType = rfv.field?.type?.type;
              const formatted = formatFieldValue(rfv.value, fieldType);
              if (formatted) {
                pdf.renderField(displayName, formatted);
              }
            }
          }

          // Result issues
          if (result.issues && result.issues.length > 0) {
            pdf.renderField(
              "Issues",
              result.issues
                .map((i) => {
                  const key = i.externalKey || i.externalId || "";
                  const title = i.title || i.name || "";
                  return key && title ? `${key}: ${title}` : title || key;
                })
                .filter(Boolean)
                .join(", ")
            );
          }

          // Result attachments
          if (embedImages && result.attachments && result.attachments.length > 0) {
            const { images, nonImageNames } = await preloadImages(result.attachments);
            pdf.renderImages(images);
            pdf.renderAttachmentNames(nonImageNames);
          } else if (result.attachments && result.attachments.length > 0) {
            const names = result.attachments
              .filter((a) => !a.isDeleted && a.name)
              .map((a) => a.name!);
            if (names.length > 0) {
              pdf.renderField("Attachments", names.join(", "));
            }
          }

          pdf.renderSeparator();
        }
      }

      // --- Page numbers & save ---
      pdf.addPageNumbers();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`session-export-${timestamp}.pdf`);

      logDataExport({
        exportType: "PDF",
        entityType: "session",
        recordCount: 1,
        projectId: sessionData.project?.id,
      });
    } catch (error) {
      console.error("Session PDF export failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [sessionData, embedImages, locale]);

  return { isExporting, handleExport };
}

/** Extract plain text from a Tiptap JSON field (string or object) */
function extractJsonText(value: any): string | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    // Check if it's empty editor content
    if (
      parsed?.type === "doc" &&
      (!parsed.content || parsed.content.length === 0)
    ) {
      return null;
    }
    const text = extractTextFromNode(parsed);
    return text && text.trim() ? text.trim() : null;
  } catch {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
}
