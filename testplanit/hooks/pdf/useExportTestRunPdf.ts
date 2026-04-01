"use client";

import { useCallback, useState } from "react";
import { logDataExport } from "~/lib/services/auditClient";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { toHumanReadable } from "~/utils/duration";
import { PdfRenderer, preloadImages, formatFieldValue } from "./pdfHelpers";

interface TestRunExportData {
  id: number;
  name: string;
  testRunType?: string;
  configuration?: { name?: string } | null;
  milestone?: { name?: string } | null;
  state?: { name?: string } | null;
  createdBy?: { name?: string | null } | null;
  note?: any;
  docs?: any;
  isCompleted?: boolean;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
  forecastManual?: number | null;
  forecastAutomated?: number | null;
  tags?: { id: number; name: string }[];
  issues?: { name?: string; title?: string | null; externalId?: string | null; externalKey?: string | null }[];
  attachments?: { url?: string; name?: string; mimeType?: string | null; isDeleted?: boolean }[];
  testCases?: {
    id: number;
    order?: number;
    repositoryCase?: {
      id: number;
      name: string;
    };
    assignedTo?: { name?: string | null } | null;
    status?: { name?: string; color?: { value?: string } | null } | null;
    results?: {
      id: number;
      executedAt?: Date | string;
      executedBy?: { name?: string | null } | null;
      status?: { name?: string; color?: { value?: string } | null } | null;
      elapsed?: number | null;
      comment?: any;
      attachments?: { url?: string; name?: string; mimeType?: string | null; isDeleted?: boolean }[];
      stepResults?: {
        step?: { step?: any; expectedResult?: any; order?: number };
        status?: { name?: string } | null;
        comment?: any;
      }[];
      resultFieldValues?: {
        fieldId: number;
        value: any;
        field?: {
          displayName?: string;
          type?: { type?: string };
        };
      }[];
    }[];
  }[];
  project?: { id?: number; name?: string } | null;
}

interface UseExportTestRunPdfProps {
  testRunData: TestRunExportData | null;
  embedImages?: boolean;
  locale?: string;
}

export function useExportTestRunPdf({
  testRunData,
  embedImages = true,
  locale = "en-US",
}: UseExportTestRunPdfProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!testRunData) return;
    setIsExporting(true);

    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdf = new PdfRenderer(doc);

      // --- Title ---
      pdf.renderTitle("Test Run Export");
      pdf.renderMetaLine(
        `Exported: ${new Date().toLocaleString()}`,
        testRunData.project?.name ? `Project: ${testRunData.project.name}` : undefined
      );
      pdf.addSpace(4);

      // --- Test Run Header ---
      pdf.renderSectionHeader(testRunData.name);

      // --- Metadata ---
      if (testRunData.testRunType && testRunData.testRunType !== "REGULAR") {
        pdf.renderField("Type", testRunData.testRunType);
      }
      pdf.renderField("Configuration", testRunData.configuration?.name);
      pdf.renderField("Milestone", testRunData.milestone?.name);
      pdf.renderField("State", testRunData.state?.name);
      pdf.renderField("Created By", testRunData.createdBy?.name);
      if (testRunData.createdAt) {
        pdf.renderField("Created", new Date(testRunData.createdAt).toLocaleString());
      }
      if (testRunData.isCompleted && testRunData.completedAt) {
        pdf.renderField("Completed", new Date(testRunData.completedAt).toLocaleString());
      }
      if (testRunData.forecastManual) {
        pdf.renderField(
          "Forecast (Manual)",
          toHumanReadable(testRunData.forecastManual, { isSeconds: true, locale })
        );
      }
      if (testRunData.forecastAutomated) {
        pdf.renderField(
          "Forecast (Automated)",
          toHumanReadable(testRunData.forecastAutomated, { isSeconds: true, locale })
        );
      }

      // --- Tags ---
      if (testRunData.tags && testRunData.tags.length > 0) {
        pdf.renderField("Tags", testRunData.tags.map((t) => t.name).join(", "));
      }

      // --- Issues ---
      if (testRunData.issues && testRunData.issues.length > 0) {
        pdf.renderField(
          "Issues",
          testRunData.issues
            .map((i) => {
              const key = i.externalKey || i.externalId || "";
              const title = i.title || i.name || "";
              return key && title ? `${key}: ${title}` : title || key;
            })
            .filter(Boolean)
            .join(", ")
        );
      }

      // --- Description / Note ---
      const noteText = extractJsonText(testRunData.note);
      if (noteText) {
        pdf.renderTextBlock("Description", noteText);
      }

      // --- Documentation ---
      const docsText = extractJsonText(testRunData.docs);
      if (docsText) {
        pdf.renderTextBlock("Documentation", docsText);
      }

      // --- Attachments ---
      if (embedImages && testRunData.attachments && testRunData.attachments.length > 0) {
        const { images, nonImageNames } = await preloadImages(testRunData.attachments);
        pdf.renderImages(images);
        pdf.renderAttachmentNames(nonImageNames);
      } else if (testRunData.attachments && testRunData.attachments.length > 0) {
        const names = testRunData.attachments
          .filter((a) => !a.isDeleted && a.name)
          .map((a) => a.name!);
        if (names.length > 0) {
          pdf.renderField("Attachments", names.join(", "));
        }
      }

      // --- Test Cases Summary ---
      const testCases = [...(testRunData.testCases || [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      if (testCases.length > 0) {
        pdf.addSpace(5);

        // Calculate summary stats
        const statusCounts: Record<string, number> = {};
        testCases.forEach((tc) => {
          // Use latest result status, or case-level status, or "Untested"
          const latestResult = tc.results?.[0];
          const statusName =
            latestResult?.status?.name || tc.status?.name || "Untested";
          statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;
        });

        const summaryParts = Object.entries(statusCounts)
          .map(([name, count]) => `${name}: ${count}`)
          .join("  |  ");

        pdf.renderSectionHeader(`Test Cases (${testCases.length})`);
        pdf.renderField("Summary", summaryParts);
        pdf.addSpace(3);

        // Individual test cases
        for (const tc of testCases) {
          const caseName =
            tc.repositoryCase?.name || `Test Case #${tc.id}`;
          const latestResult = tc.results?.[0];
          const statusName =
            latestResult?.status?.name || tc.status?.name || "Untested";

          pdf.ensureSpace(20);
          pdf.renderSubHeader(caseName);
          pdf.renderField("Status", statusName);

          if (tc.assignedTo?.name) {
            pdf.renderField("Assigned To", tc.assignedTo.name);
          }

          // Latest result details
          if (latestResult) {
            if (latestResult.executedBy?.name) {
              pdf.renderField("Executed By", latestResult.executedBy.name);
            }
            if (latestResult.executedAt) {
              pdf.renderField(
                "Executed",
                new Date(latestResult.executedAt).toLocaleString()
              );
            }
            if (latestResult.elapsed) {
              pdf.renderField(
                "Elapsed",
                toHumanReadable(latestResult.elapsed, { isSeconds: true, locale })
              );
            }

            // Result comment
            const commentText = extractJsonText(latestResult.comment);
            if (commentText) {
              pdf.renderTextBlock("Comment", commentText);
            }

            // Step results
            if (latestResult.stepResults && latestResult.stepResults.length > 0) {
              const sortedSteps = [...latestResult.stepResults].sort(
                (a, b) => (a.step?.order || 0) - (b.step?.order || 0)
              );

              for (const sr of sortedSteps) {
                const stepText = extractJsonText(sr.step?.step);
                const expectedText = extractJsonText(sr.step?.expectedResult);
                const stepStatus = sr.status?.name || "";

                if (stepText || expectedText) {
                  pdf.ensureSpace(15);
                  pdf.renderField(
                    `Step ${sr.step?.order ?? ""}`,
                    stepText || ""
                  );
                  if (expectedText) {
                    pdf.renderField("Expected", expectedText);
                  }
                  if (stepStatus) {
                    pdf.renderField("Status", stepStatus);
                  }
                  const stepComment = extractJsonText(sr.comment);
                  if (stepComment) {
                    pdf.renderField("Comment", stepComment);
                  }
                }
              }
            }

            // Result custom fields
            if (latestResult.resultFieldValues && latestResult.resultFieldValues.length > 0) {
              for (const rfv of latestResult.resultFieldValues) {
                if (rfv.value === null || rfv.value === undefined) continue;
                const displayName = rfv.field?.displayName || `Field ${rfv.fieldId}`;
                const fieldType = rfv.field?.type?.type;
                const formatted = formatFieldValue(rfv.value, fieldType);
                if (formatted) {
                  pdf.renderField(displayName, formatted);
                }
              }
            }

            // Result attachments
            if (embedImages && latestResult.attachments && latestResult.attachments.length > 0) {
              const { images, nonImageNames } = await preloadImages(
                latestResult.attachments
              );
              pdf.renderImages(images);
              pdf.renderAttachmentNames(nonImageNames);
            }
          }

          pdf.renderSeparator();
        }
      }

      // --- Page numbers & save ---
      pdf.addPageNumbers();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`test-run-export-${timestamp}.pdf`);

      logDataExport({
        exportType: "PDF",
        entityType: "test-run",
        recordCount: 1,
        projectId: testRunData.project?.id,
      });
    } catch (error) {
      console.error("Test Run PDF export failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [testRunData, embedImages, locale]);

  return { isExporting, handleExport };
}

/** Extract plain text from a Tiptap JSON field (string or object) */
function extractJsonText(value: any): string | null {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
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
