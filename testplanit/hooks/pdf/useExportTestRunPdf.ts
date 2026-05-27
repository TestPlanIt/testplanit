"use client";

import { useCallback, useState } from "react";
import { useFindUniqueTestRuns } from "~/lib/hooks";
import { logDataExport } from "~/lib/services/auditClient";
import { toHumanReadable } from "~/utils/duration";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { formatFieldValue, PdfRenderer, preloadImages } from "./pdfHelpers";

/**
 * Relations fetched for the PDF export. This is heavier than the run page's
 * own query (it pulls each case's authored steps plus the latest result and
 * its per-step results), so it is fetched on demand when the user exports
 * rather than on every run-page load.
 */
const EXPORT_INCLUDE = {
  project: { select: { id: true, name: true } },
  configuration: { select: { name: true } },
  milestone: { select: { name: true } },
  state: { select: { name: true } },
  createdBy: { select: { name: true } },
  attachments: true,
  tags: { select: { id: true, name: true } },
  issues: {
    select: {
      name: true,
      title: true,
      externalId: true,
      externalKey: true,
    },
  },
  testCases: {
    where: { isDeleted: false },
    select: {
      id: true,
      order: true,
      status: {
        select: { name: true, color: { select: { value: true } } },
      },
      assignedTo: { select: { name: true } },
      repositoryCase: {
        select: {
          id: true,
          name: true,
          steps: {
            where: { isDeleted: false },
            orderBy: { order: "asc" as const },
            select: {
              id: true,
              order: true,
              step: true,
              expectedResult: true,
              sharedStepGroupId: true,
              sharedStepGroup: {
                select: {
                  id: true,
                  name: true,
                  items: {
                    orderBy: { order: "asc" as const },
                    select: {
                      id: true,
                      order: true,
                      step: true,
                      expectedResult: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      results: {
        where: { isDeleted: false },
        orderBy: { executedAt: "desc" as const },
        take: 1,
        select: {
          id: true,
          executedAt: true,
          elapsed: true,
          notes: true,
          executedBy: { select: { name: true } },
          status: {
            select: { name: true, color: { select: { value: true } } },
          },
          attachments: true,
          stepResults: {
            where: { isDeleted: false },
            select: {
              stepId: true,
              sharedStepItemId: true,
              notes: true,
              elapsed: true,
              stepStatus: {
                select: { name: true, color: { select: { value: true } } },
              },
              attachments: true,
              issues: {
                select: {
                  name: true,
                  title: true,
                  externalId: true,
                  externalKey: true,
                },
              },
            },
          },
          resultFieldValues: {
            select: {
              fieldId: true,
              value: true,
              field: {
                select: { displayName: true, type: { select: { type: true } } },
              },
            },
          },
        },
      },
    },
  },
} as const;

interface UseExportTestRunPdfProps {
  testRunId: number | null | undefined;
  /** Used for the export audit entry; falls back to the run's project. */
  projectId?: number;
  embedImages?: boolean;
  locale?: string;
}

export function useExportTestRunPdf({
  testRunId,
  projectId,
  embedImages = true,
  locale = "en-US",
}: UseExportTestRunPdfProps) {
  const [isExporting, setIsExporting] = useState(false);

  // Disabled query; the heavy data is fetched only when the user exports.
  const { refetch } = useFindUniqueTestRuns(
    { where: { id: testRunId ?? 0 }, include: EXPORT_INCLUDE },
    { enabled: false }
  );

  const handleExport = useCallback(async () => {
    if (!testRunId) return;
    setIsExporting(true);

    try {
      const { data } = await refetch();
      const testRunData = data as any;
      if (!testRunData) return;

      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pdf = new PdfRenderer(doc);

      // --- Title ---
      pdf.renderTitle("Test Run Export");
      pdf.renderMetaLine(
        `Exported: ${new Date().toLocaleString()}`,
        testRunData.project?.name
          ? `Project: ${testRunData.project.name}`
          : undefined
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
        pdf.renderField(
          "Created",
          new Date(testRunData.createdAt).toLocaleString()
        );
      }
      if (testRunData.isCompleted && testRunData.completedAt) {
        pdf.renderField(
          "Completed",
          new Date(testRunData.completedAt).toLocaleString()
        );
      }
      if (testRunData.forecastManual) {
        pdf.renderField(
          "Forecast (Manual)",
          toHumanReadable(testRunData.forecastManual, {
            isSeconds: true,
            locale,
          })
        );
      }
      if (testRunData.forecastAutomated) {
        pdf.renderField(
          "Forecast (Automated)",
          toHumanReadable(testRunData.forecastAutomated, {
            isSeconds: true,
            locale,
          })
        );
      }

      // --- Tags ---
      if (testRunData.tags && testRunData.tags.length > 0) {
        pdf.renderField(
          "Tags",
          testRunData.tags.map((t: any) => t.name).join(", ")
        );
      }

      // --- Issues ---
      if (testRunData.issues && testRunData.issues.length > 0) {
        pdf.renderField("Issues", formatIssues(testRunData.issues));
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
      if (
        embedImages &&
        testRunData.attachments &&
        testRunData.attachments.length > 0
      ) {
        const { images, nonImageNames } = await preloadImages(
          testRunData.attachments
        );
        pdf.renderImages(images);
        pdf.renderAttachmentNames(nonImageNames);
      } else if (
        testRunData.attachments &&
        testRunData.attachments.length > 0
      ) {
        const names = testRunData.attachments
          .filter((a: any) => !a.isDeleted && a.name)
          .map((a: any) => a.name);
        if (names.length > 0) {
          pdf.renderField("Attachments", names.join(", "));
        }
      }

      // --- Test Cases ---
      const testCases = [...(testRunData.testCases || [])].sort(
        (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
      );
      if (testCases.length > 0) {
        pdf.addSpace(5);

        // Summary stats from the latest result (or case-level) status.
        const statusCounts: Record<string, number> = {};
        testCases.forEach((tc: any) => {
          const statusName =
            tc.results?.[0]?.status?.name || tc.status?.name || "Untested";
          statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;
        });
        const summaryParts = Object.entries(statusCounts)
          .map(([name, count]) => `${name}: ${count}`)
          .join("  |  ");

        pdf.renderSectionHeader(`Test Cases (${testCases.length})`);
        pdf.renderField("Summary", summaryParts);
        pdf.addSpace(3);

        for (const tc of testCases) {
          const caseName = tc.repositoryCase?.name || `Test Case #${tc.id}`;
          const latestResult = tc.results?.[0];
          const statusObj = latestResult?.status || tc.status;
          const statusName = statusObj?.name || "Untested";

          pdf.ensureSpace(20);
          pdf.renderSubHeader(caseName);
          pdf.renderField("Status", statusName, {
            color: hexToRgb(statusObj?.color?.value),
          });
          if (tc.assignedTo?.name) {
            pdf.renderField("Assigned To", tc.assignedTo.name);
          }

          // Case-level result details
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
                toHumanReadable(latestResult.elapsed, {
                  isSeconds: true,
                  locale,
                })
              );
            }
            const resultNotes = extractJsonText(latestResult.notes);
            if (resultNotes) {
              pdf.renderTextBlock("Comment", resultNotes);
            }
          }

          // Steps: every authored step (shared groups expanded), with the
          // recorded result overlaid when the step has one.
          const stepRows = buildStepRows(
            tc.repositoryCase?.steps,
            latestResult?.stepResults
          );
          if (stepRows.length > 0) {
            pdf.addSpace(2);
            pdf.renderField("Steps", `${stepRows.length}`);
            for (const row of stepRows) {
              pdf.ensureSpace(18);
              pdf.renderStepHeading(row.num, row.stepText || "");
              if (row.sharedGroup) {
                pdf.renderDetail("Shared step", row.sharedGroup);
              }
              if (row.expectedText) {
                pdf.renderDetail("Expected", row.expectedText);
              }

              const sr = row.result;
              if (sr) {
                if (sr.stepStatus?.name) {
                  pdf.renderDetail("Result", sr.stepStatus.name, {
                    color: hexToRgb(sr.stepStatus?.color?.value),
                  });
                }
                if (sr.elapsed) {
                  pdf.renderDetail(
                    "Time",
                    toHumanReadable(sr.elapsed, { isSeconds: true, locale })
                  );
                }
                const stepNotes = extractJsonText(sr.notes);
                if (stepNotes) {
                  pdf.renderDetail("Notes", stepNotes);
                }
                if (sr.issues && sr.issues.length > 0) {
                  pdf.renderDetail("Issues", formatIssues(sr.issues));
                }
                if (
                  embedImages &&
                  sr.attachments &&
                  sr.attachments.length > 0
                ) {
                  const { images, nonImageNames } = await preloadImages(
                    sr.attachments
                  );
                  pdf.renderImages(images);
                  pdf.renderAttachmentNames(nonImageNames);
                }
              }
            }
          }

          // Result custom fields
          if (latestResult?.resultFieldValues?.length) {
            for (const rfv of latestResult.resultFieldValues) {
              if (rfv.value === null || rfv.value === undefined) continue;
              const displayName =
                rfv.field?.displayName || `Field ${rfv.fieldId}`;
              const formatted = formatFieldValue(
                rfv.value,
                rfv.field?.type?.type
              );
              if (formatted) {
                pdf.renderField(displayName, formatted);
              }
            }
          }

          // Result attachments
          if (
            embedImages &&
            latestResult?.attachments &&
            latestResult.attachments.length > 0
          ) {
            const { images, nonImageNames } = await preloadImages(
              latestResult.attachments
            );
            pdf.renderImages(images);
            pdf.renderAttachmentNames(nonImageNames);
          }

          pdf.renderSeparator();
        }
      }

      // --- Page numbers & save ---
      pdf.addPageNumbers();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      pdf.save(`test-run-export-${timestamp}.pdf`);

      void logDataExport({
        exportType: "PDF",
        entityType: "test-run",
        recordCount: 1,
        projectId: projectId ?? testRunData.project?.id,
      });
    } catch (error) {
      console.error("Test Run PDF export failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [testRunId, projectId, refetch, embedImages, locale]);

  return { isExporting, handleExport };
}

interface StepRow {
  num: number;
  stepText: string | null;
  expectedText: string | null;
  sharedGroup?: string;
  result?: any;
}

/**
 * Flattens a case's authored steps into display rows, expanding shared-step
 * placeholders into their group items, and matches each row to its recorded
 * step result (by step id, plus shared-step item id for shared steps).
 *
 * Exported for unit testing.
 */
export function buildStepRows(
  steps: any[] | undefined,
  stepResults: any[] | undefined
): StepRow[] {
  if (!steps || steps.length === 0) return [];

  const resultByKey = new Map<string, any>();
  for (const sr of stepResults ?? []) {
    resultByKey.set(`${sr.stepId}:${sr.sharedStepItemId ?? ""}`, sr);
  }

  const rows: StepRow[] = [];
  let num = 0;
  const ordered = [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const step of ordered) {
    const sharedItems = step.sharedStepGroup?.items;
    if (sharedItems && sharedItems.length > 0) {
      const items = [...sharedItems].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      for (const item of items) {
        num++;
        rows.push({
          num,
          stepText: extractJsonText(item.step),
          expectedText: extractJsonText(item.expectedResult),
          sharedGroup: step.sharedStepGroup?.name,
          result: resultByKey.get(`${step.id}:${item.id}`),
        });
      }
    } else {
      num++;
      rows.push({
        num,
        stepText: extractJsonText(step.step),
        expectedText: extractJsonText(step.expectedResult),
        result: resultByKey.get(`${step.id}:`),
      });
    }
  }

  return rows;
}

/** Parse a `#rrggbb` color into an RGB tuple for jsPDF, if valid. */
function hexToRgb(
  hex: string | null | undefined
): [number, number, number] | undefined {
  if (!hex) return undefined;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Format linked issues as "KEY: Title" (or whichever parts exist). */
function formatIssues(issues: any[]): string {
  return issues
    .map((i) => {
      const key = i.externalKey || i.externalId || "";
      const title = i.title || i.name || "";
      return key && title ? `${key}: ${title}` : title || key;
    })
    .filter(Boolean)
    .join(", ");
}

/** Extract plain text from a Tiptap JSON field (string or object). */
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
