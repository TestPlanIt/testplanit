import { useState, useCallback } from "react";
import Papa from "papaparse";
import jsPDF from "jspdf";
import { ExportOptions } from "../app/[locale]/projects/repository/[projectId]/ExportModal";
import { CustomColumnDef } from "../components/tables/ColumnSelection";
import { Projects, CaseFields } from "@prisma/client";
import { format } from "date-fns";
import { extractTextFromNode } from "../utils/extractTextFromJson";
import { logDataExport } from "../lib/services/auditClient";

// --- Start: Added Helper Functions ---
// Helper function to parse JSON safely
const safeJsonParse = (jsonString: any, defaultValue: any = null): any => {
  // If it's not a string, return it directly (might already be an object)
  if (typeof jsonString !== "string") return jsonString;
  try {
    // Handle empty strings specifically, return defaultValue (e.g., null)
    if (jsonString.trim() === "") return defaultValue;
    return JSON.parse(jsonString);
  } catch (e) {
    console.warn(
      "[Export Debug] Failed to parse JSON, returning raw value:",
      jsonString,
      e
    );
    return jsonString; // Return original string if parsing fails
  }
};

// Helper to format step/expected result based on options
const formatStepContent = (
  content: any, // Can be JSON string or already parsed object
  formatOption: "json" | "plainText"
): string => {
  // Ensure always returns string for consistency
  if (content === null || content === undefined) return "";
  // Attempt to parse only if it looks like stringified JSON
  const potentialJson =
    typeof content === "string" &&
    content.startsWith("{") &&
    content.endsWith("}");
  const parsedContent = potentialJson ? safeJsonParse(content) : content;

  if (formatOption === "plainText") {
    // If parsing failed/skipped and it's still a string, use it directly
    if (typeof parsedContent === "string") return parsedContent;
    // Otherwise, extract text from the parsed object
    return extractTextFromNode(parsedContent) ?? "";
  } else {
    // format === 'json'
    // Return stringified JSON or the original string if it wasn't JSON
    return typeof parsedContent === "string"
      ? parsedContent
      : JSON.stringify(parsedContent ?? null);
  }
};

// Helper to sanitize text for PDF export by replacing problematic Unicode characters
const sanitizeTextForPdf = (text: string): string => {
  if (!text) return text;
  return text
    // Replace narrow no-break space (U+202F) with regular space
    .replace(/\u202f/g, " ")
    // Replace other problematic whitespace characters
    .replace(/\u00a0/g, " ") // Non-breaking space
    .replace(/\u2007/g, " ") // Figure space
    .replace(/\u2008/g, " ") // Punctuation space
    .replace(/\u2009/g, " ") // Thin space
    .replace(/\u200a/g, " ") // Hair space
    .replace(/\u200b/g, "")  // Zero-width space (remove)
    .replace(/\u2060/g, ""); // Word joiner (remove)
};

// Image MIME types that can be embedded in PDF
const EMBEDDABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
];

// Helper to check if a MIME type is an embeddable image
const isEmbeddableImage = (mimeType: string | null | undefined): boolean => {
  if (!mimeType) return false;
  return EMBEDDABLE_IMAGE_TYPES.includes(mimeType.toLowerCase());
};

// Helper to load an image from URL and convert to data URL for PDF embedding
const loadImageAsDataUrl = (
  url: string,
  mimeType: string
): Promise<{ dataUrl: string; width: number; height: number } | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        // Add white background for transparency support
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // Convert to JPEG for smaller file size (PNG if transparency needed)
        const outputFormat =
          mimeType === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(outputFormat, 0.85);
        resolve({
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch (e) {
        console.warn("[PDF Export] Failed to process image:", url, e);
        resolve(null);
      }
    };

    img.onerror = () => {
      console.warn("[PDF Export] Failed to load image:", url);
      resolve(null);
    };

    // Set timeout to prevent hanging on slow images
    setTimeout(() => {
      if (!img.complete) {
        console.warn("[PDF Export] Image load timeout:", url);
        resolve(null);
      }
    }, 10000);

    img.src = url;
  });
};
// --- End: Added Helper Functions ---

// Revert to simpler TFunction type and export it
export type TFunction = (key: string, values?: Record<string, any>) => string;

// Define the props for the hook
interface UseExportDataProps<TData> {
  // fetchAllData now potentially accepts ExportOptions to determine behavior
  fetchAllData?: (options: ExportOptions) => Promise<TData[]>;
  currentData: TData[];
  selectedIds: number[];
  columns: CustomColumnDef<TData>[];
  columnVisibility: Record<string, boolean>;
  fileNamePrefix: string;
  t: TFunction;
  project?: Projects & { caseFields?: CaseFields[] };
  isRunMode?: boolean;
  testRunCasesData?: any[];
  isDefaultSort?: boolean;
  textLongFormat?: string; // Optional text long format option
  attachmentFormat?: string; // Optional attachment format option
}

// --- Start: Added Centralized Formatting Helper ---
const formatItemData = (
  item: any, // Input item (can be TData or transformed multi-row item)
  options: ExportOptions,
  exportableColumns: CustomColumnDef<any>[], // Pass the final columns list
  t: TFunction // Pass translation function
): Record<string, any> => {
  const formattedRow: Record<string, any> = {};

  // Handle multi-row continuation blanking *before* processing columns
  if (item.isMultiRowContinuation) {
    exportableColumns.forEach((col) => {
      formattedRow[col.id as string] = ""; // Pre-fill with blanks
    });
    // Explicitly fill required continuation columns
    formattedRow["id"] = String(item.id);
    formattedRow["name"] = item.name;
    formattedRow["stepNumber"] = String(item.stepNumber);
    formattedRow["stepContent"] = item.stepContent; // Already formatted
    formattedRow["expectedResultContent"] = item.expectedResultContent; // Already formatted
    return formattedRow; // Skip other processing
  }

  // Process all columns for regular rows or the first row of multi-row
  exportableColumns.forEach((col) => {
    const columnId = col.id as string;
    let value: any = undefined; // Start as undefined

    // --- Value Extraction & Formatting Logic ---
    // Handle specific step columns added dynamically
    if (
      columnId === "combinedStepData" ||
      columnId === "stepNumber" ||
      columnId === "stepContent" ||
      columnId === "expectedResultContent"
    ) {
      value = item[columnId]; // This value was pre-formatted in the transformation step
    }
    // Handle existing special cases
    else if (columnId === "stateId") {
      value = item.state?.name ?? "";
    } else if (columnId === "template") {
      value = item.template?.templateName ?? "";
    } else if (columnId === "creator") {
      value = item.creator?.name ?? "";
    } else if (columnId === "tags") {
      value = item.tags?.map((t: any) => t.name).join(", ") ?? "";
    } else if (columnId === "attachments") {
      switch (options.attachmentFormat) {
        case "names":
          value =
            item.attachments
              ?.map((att: any) => att.name)
              .filter(Boolean)
              .join(", ") ?? "";
          break;
        case "json":
        default:
          try {
            const attachmentsJson = item.attachments?.map((att: any) => ({
              id: att.id,
              url: att.url,
              name: att.name,
              note: att.note,
              size: att.size?.toString(),
              mimeType: att.mimeType,
              createdAt: att.createdAt?.toISOString(),
              isDeleted: att.isDeleted,
              testCaseId: att.testCaseId,
              createdById: att.createdById,
            }));
            value = attachmentsJson ? JSON.stringify(attachmentsJson) : "[]";
          } catch (e) {
            console.error(
              `[Export Error] Failed to stringify attachments for column ${columnId}:`,
              item.attachments,
              e
            );
            value = "[Error Stringifying Attachments]";
          }
          break;
      }
    } else if (columnId === "issues") {
      value = item.issues?.map((issue: any) => issue.name).join(", ") ?? "";
    } else if (columnId === "testRuns") {
      value =
        item.testRuns
          ?.map((trc: any) => trc.testRun?.name)
          .filter(Boolean)
          .join(", ") ?? "";
    }
    // Handle custom fields (numeric IDs)
    else if (!isNaN(parseInt(columnId))) {
      const fieldId = parseInt(columnId);
      const fieldValue = item.caseFieldValues?.find(
        (fv: any) => fv.fieldId === fieldId
      );
      const templateCaseField = item.template?.caseFields?.find(
        (tcf: any) => tcf.caseField.id === fieldId
      )?.caseField;
      if (fieldValue && templateCaseField && fieldValue.value !== null) {
        const rawValue = fieldValue.value as any;
        try {
          const fieldTypeString = templateCaseField.type?.type;
          if (!fieldTypeString) {
            value = "[Unknown Field Type]";
          } else {
            switch (fieldTypeString) {
              case "Dropdown": {
                const opt = templateCaseField.fieldOptions?.find(
                  (fo: any) => fo.fieldOption.id === rawValue
                );
                value = opt?.fieldOption.name ?? "";
                break;
              }
              case "Multi-Select": {
                if (Array.isArray(rawValue)) {
                  const opts = templateCaseField.fieldOptions?.filter(
                    (fo: any) => rawValue.includes(fo.fieldOption.id)
                  );
                  value =
                    opts?.map((fo: any) => fo.fieldOption.name).join(", ") ??
                    "";
                } else {
                  value = "";
                }
                break;
              }
              case "Checkbox":
                value = rawValue === true;
                break;
              case "Text Long":
                if (options.textLongFormat === "plainText") {
                  const p = safeJsonParse(rawValue);
                  value = typeof p === "string" ? p : extractTextFromNode(p);
                } else {
                  value =
                    typeof rawValue === "string"
                      ? rawValue
                      : JSON.stringify(rawValue ?? null);
                }
                break;
              case "Text String":
              case "Link":
              case "Integer":
              default:
                value = rawValue;
                break;
            }
          }
        } catch (formatError) {
          console.error(
            `Error formatting custom field ${columnId}`,
            formatError
          );
          value = "[Formatting Error]";
        }
      } else {
        value = "";
      } // Handle null or missing field value
    }
    // Specific Run Mode fields (assuming item might have these merged)
    else if (columnId === "testRunStatus") {
      value = item.testRunStatus?.name ?? t("common.labels.untested");
    } else if (columnId === "assignedTo") {
      value = item.assignedTo?.name ?? t("repository.fields.unassigned");
    }
    // Automated field
    else if (columnId === "automated") {
      const av = item[columnId];
      value = typeof av === "string" ? av.toLowerCase() === "true" : !!av;
    }
    // General Fallback for other properties
    else if (columnId in item) {
      value = item[columnId];
    }
    // --- End Value Extraction & Formatting ---

    // --- Final Type Conversion for CSV ---
    if (value === undefined || value === null) {
      value = "";
    } else if (value instanceof Date) {
      try {
        value = format(value, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
      } catch (e) {
        value = "[Date Error]";
      }
    } else if (typeof value === "object") {
      try {
        value = JSON.stringify(value);
      } catch (e) {
        value = "[JSON Error]";
      }
    } else if (typeof value !== "string" && typeof value !== "boolean") {
      value = String(value);
    }
    // Booleans and strings pass through

    formattedRow[columnId] = value; // Assign final value
  });

  return formattedRow;
};
// --- End: Added Centralized Formatting Helper ---

export function useExportData<
  TData extends {
    id: number;
    name: string;
    order?: number;
    state?: any;
    template?: any;
    creator?: any;
    tags?: any[];
    steps?: {
      id: number;
      step: any;
      expectedResult?: {
        expectedResult: any;
        isDeleted?: boolean;
      } | null;
      isDeleted?: boolean;
    }[];
    attachments?: any[];
    issues?: any[];
    caseFieldValues?: any[];
    testRunStatus?: any;
    assignedTo?: any;
    automated?: boolean;
    testRuns?: {
      id: number;
      testRun?: {
        id: number;
        name: string;
      };
    }[];
  },
>({
  fetchAllData,
  currentData,
  selectedIds,
  columns,
  columnVisibility,
  fileNamePrefix,
  t,
  project,
  isRunMode = false,
  testRunCasesData = [],
  isDefaultSort = true,
  textLongFormat,
  attachmentFormat,
}: UseExportDataProps<TData>) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(
    async (options: ExportOptions) => {
      setIsExporting(true);
      let dataToExportInitial: TData[] = [];

      try {
        // Fetch data based on scope
        if (options.scope === "selected") {
          // First check if all selected items are in currentData
          const currentDataIds = currentData.map((item) => item.id);
          const allSelectedInCurrentData = selectedIds.every((id) =>
            currentDataIds.includes(id)
          );

          if (allSelectedInCurrentData) {
            // All selected items are in current page data
            dataToExportInitial = currentData.filter((item) =>
              selectedIds.includes(item.id)
            );
          } else {
            // Some selected items are from other pages, need to fetch them
            if (!fetchAllData) {
              console.error(
                "fetchAllData function is required for exporting selected items across multiple pages."
              );
              setIsExporting(false);
              return;
            }

            // Fetch all data that matches the current filters
            const allDataResult = await fetchAllData({
              ...options,
              scope: "allFiltered",
            });

            // Filter to only include selected items
            dataToExportInitial = allDataResult.filter((item) =>
              selectedIds.includes(item.id)
            );
          }
          // console.log(`Using ${dataToExportInitial.length} selected items.`);
        } else {
          if (!fetchAllData) {
            console.error(
              "fetchAllData function is required for 'allFiltered' or 'allProject' scope export."
            );
            setIsExporting(false);
            return;
          }
          // console.log(`Fetching data for scope: ${options.scope}`);
          const allDataResult = await fetchAllData(options);

          // Apply potential run mode merging *before* transformation
          dataToExportInitial = allDataResult.map((item) => ({
            ...item,
            ...(isRunMode
              ? testRunCasesData?.find(
                  (trc) => trc.repositoryCaseId === item.id
                )
              : {}),
          }));

          if (isRunMode && isDefaultSort) {
            dataToExportInitial.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
          }
        }

        if (dataToExportInitial.length === 0) {
          console.warn("No data to export.");
          setIsExporting(false);
          return;
        }

        // Determine export columns
        const visibleColumnIds = Object.entries(columnVisibility)
          .filter(([_, isVisible]) => isVisible)
          .map(([id]) => id);

        const baseColumnsToExport =
          options.columns === "all"
            ? columns
            : columns.filter((col) =>
                visibleColumnIds.includes(col.id as string)
              );

        const exportableColumns = baseColumnsToExport.filter(
          (col) =>
            !["actions", "customSelect", "select", "steps"].includes(
              col.id as string
            )
        );

        // Ensure Name Column
        if (!exportableColumns.some((col) => col.id === "name")) {
          const nameCol = columns.find((col) => col.id === "name");
          if (nameCol) exportableColumns.unshift(nameCol);
        }

        // Add Step Columns Conditionally
        const stepsFieldExists = columns.some((col) => col.id === "steps");
        if (stepsFieldExists) {
          if (options.rowMode === "single") {
            exportableColumns.push({
              id: "combinedStepData",
              header: "Steps Data",
            });
          } else {
            exportableColumns.push({ id: "stepNumber", header: "Step #" });
            exportableColumns.push({
              id: "stepContent",
              header: "Step Content",
            });
            exportableColumns.push({
              id: "expectedResultContent",
              header: "Expected Result",
            });
          }
        }

        // For PDF export, always use plain text formats (except attachmentFormat which can be "embedded")
        const effectiveOptions: ExportOptions =
          options.format === "pdf"
            ? {
                ...options,
                stepsFormat: "plainText",
                textLongFormat: "plainText",
                // Preserve "embedded" option for PDF, otherwise default to "names"
                attachmentFormat:
                  options.attachmentFormat === "embedded" ? "embedded" : "names",
                rowMode: "single", // PDF always uses single row mode
              }
            : options;

        // Transform and format data
        const transformedAndFormattedData = dataToExportInitial.flatMap(
          (item) => {
            const activeSteps =
              item.steps?.filter((step) => !step.isDeleted) ?? [];

            if (effectiveOptions.rowMode === "single") {
              let combinedStepData = "";
              if (effectiveOptions.stepsFormat === "json") {
                const stepsArray =
                  activeSteps.map((step, index) => ({
                    stepNumber: index + 1,
                    step: formatStepContent(step.step, "json"),
                    expectedResult:
                      !step.expectedResult || step.expectedResult.isDeleted
                        ? null
                        : formatStepContent(
                            step.expectedResult.expectedResult,
                            "json"
                          ),
                  })) || [];
                combinedStepData = JSON.stringify(stepsArray);
              } else {
                combinedStepData =
                  activeSteps
                    .map((step, index) => {
                      const stepText = formatStepContent(
                        step.step,
                        "plainText"
                      );
                      // Check isDeleted before formatting expectedResult
                      const expectedText =
                        !step.expectedResult || step.expectedResult.isDeleted
                          ? ""
                          : formatStepContent(
                              step.expectedResult.expectedResult,
                              "plainText"
                            );
                      const stepStr = stepText
                        ? `Step ${index + 1}:\n${stepText}`
                        : "";
                      const expectedStr = expectedText
                        ? `Expected Result ${index + 1}:\n${expectedText}`
                        : "";
                      return [stepStr, expectedStr].filter(Boolean).join("\n");
                    })
                    .filter(Boolean)
                    .join("\n---\n") ?? "";
              }
              const formattedBase = formatItemData(
                { ...item, combinedStepData },
                effectiveOptions,
                exportableColumns,
                t
              );
              return [formattedBase];
            } else {
              // Multi Row Mode
              const multiRows: any[] = [];
              if (!activeSteps || activeSteps.length === 0) {
                multiRows.push(
                  formatItemData(
                    {
                      ...item,
                      stepContent: "",
                      expectedResultContent: "",
                      stepNumber: null,
                    },
                    effectiveOptions,
                    exportableColumns,
                    t
                  )
                );
              } else {
                activeSteps.forEach((step, index) => {
                  const stepContent = formatStepContent(
                    step.step,
                    effectiveOptions.stepsFormat
                  );
                  // Check isDeleted before formatting expectedResult
                  const expectedResultContent =
                    !step.expectedResult || step.expectedResult.isDeleted
                      ? ""
                      : formatStepContent(
                          step.expectedResult.expectedResult,
                          effectiveOptions.stepsFormat
                        );
                  if (index === 0) {
                    multiRows.push(
                      formatItemData(
                        {
                          ...item,
                          stepContent,
                          expectedResultContent,
                          stepNumber: index + 1,
                        },
                        effectiveOptions,
                        exportableColumns,
                        t
                      )
                    );
                  } else {
                    multiRows.push(
                      formatItemData(
                        {
                          id: item.id,
                          name: item.name,
                          stepContent,
                          expectedResultContent,
                          stepNumber: index + 1,
                          isMultiRowContinuation: true,
                        },
                        effectiveOptions,
                        exportableColumns,
                        t
                      )
                    );
                  }
                });
              }
              return multiRows;
            }
          }
        );

        // CSV Export Logic
        if (options.format === "csv") {
          const csvData = transformedAndFormattedData.map(
            (formattedItem: Record<string, any>) => {
              const row: Record<string, any> = {};
              exportableColumns.forEach((col) => {
                const columnId = col.id as string;
                const header =
                  typeof col.header === "string" ? col.header : columnId;
                row[header] = formattedItem[columnId] ?? "";
              });
              return row;
            }
          );

          const csvString = Papa.unparse(csvData, {
            delimiter: options.delimiter,
            header: true,
            quotes: (value) => typeof value !== "boolean",
            escapeFormulae: true,
          });

          const blob = new Blob(["\uFEFF" + csvString], {
            type: "text/csv;charset=utf-8;",
          });
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          link.setAttribute(
            "download",
            `${fileNamePrefix}-export-${timestamp}.csv`
          );
          link.style.visibility = "hidden";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          // Log export for audit trail
          logDataExport({
            exportType: "CSV",
            entityType: fileNamePrefix,
            recordCount: transformedAndFormattedData.length,
            projectId: project?.id,
          });
        }
        // PDF Export Logic
        else if (options.format === "pdf") {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const fileName = `${fileNamePrefix}-export-${timestamp}.pdf`;

          // For embedded images, we need the raw attachment data from the original items
          const itemsWithRawAttachments = transformedAndFormattedData.map(
            (formattedItem, idx) => {
              const originalItem = dataToExportInitial[idx];
              return {
                formatted: formattedItem,
                rawAttachments: originalItem?.attachments ?? [],
              };
            }
          );

          // Pre-load all images if embedding is enabled
          type LoadedImage = {
            name: string;
            dataUrl: string;
            width: number;
            height: number;
          };
          const imageCache = new Map<number, LoadedImage[]>();

          if (effectiveOptions.attachmentFormat === "embedded") {
            // Collect all image attachments that need to be loaded
            const imageLoadPromises: Promise<void>[] = [];

            itemsWithRawAttachments.forEach(({ rawAttachments }, itemIdx) => {
              const imageAttachments = rawAttachments.filter(
                (att: any) =>
                  !att.isDeleted && isEmbeddableImage(att.mimeType) && att.url
              );

              if (imageAttachments.length > 0) {
                const loadPromise = Promise.all(
                  imageAttachments.map(async (att: any) => {
                    const result = await loadImageAsDataUrl(
                      att.url,
                      att.mimeType
                    );
                    if (result) {
                      return {
                        name: att.name,
                        ...result,
                      };
                    }
                    return null;
                  })
                ).then((results) => {
                  const loadedImages = results.filter(
                    (r): r is LoadedImage => r !== null
                  );
                  if (loadedImages.length > 0) {
                    imageCache.set(itemIdx, loadedImages);
                  }
                });
                imageLoadPromises.push(loadPromise);
              }
            });

            // Wait for all images to load
            await Promise.all(imageLoadPromises);
          }

          // Document format - detailed sections per test case
          const doc = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: "a4",
          });

          const pageWidth = doc.internal.pageSize.width;
          const pageHeight = doc.internal.pageSize.height;
          const margin = 15;
          const contentWidth = pageWidth - 2 * margin;
          let yPosition = margin;

          // Reset character spacing to prevent jsPDF rendering issues
          doc.setCharSpace(0);

          // Title
          doc.setFontSize(18);
          doc.setFont("helvetica", "bold");
          doc.text("Test Cases Export", margin, yPosition);
          yPosition += 10;

          // Export metadata
          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(
            `Exported: ${new Date().toLocaleString()}`,
            margin,
            yPosition
          );
          doc.text(
            `Total Cases: ${transformedAndFormattedData.length}`,
            margin + 80,
            yPosition
          );
          yPosition += 10;

          // Max image dimensions for PDF (in mm)
          const maxImageWidth = contentWidth - 10;
          const maxImageHeight = 80;

          // Process each test case
          itemsWithRawAttachments.forEach(
            ({ formatted: item, rawAttachments }, index) => {
              // Check if we need a new page
              if (yPosition > pageHeight - 50) {
                doc.addPage();
                yPosition = margin;
              }

              // Draw separator line
              doc.setDrawColor(200, 200, 200);
              doc.line(margin, yPosition, pageWidth - margin, yPosition);
              yPosition += 8;

              // Test case name/title
              doc.setFontSize(14);
              doc.setFont("helvetica", "bold");
              const name =
                (item as Record<string, any>)["name"] ||
                `Test Case ${index + 1}`;
              const nameLines: string[] = doc.splitTextToSize(
                sanitizeTextForPdf(String(name)),
                contentWidth
              );
              // Render each line individually to avoid jsPDF character spacing issues
              nameLines.forEach((line: string) => {
                doc.text(line, margin, yPosition);
                yPosition += 6;
              });
              yPosition += 4;

              // Reset font for details
              doc.setFontSize(10);
              doc.setFont("helvetica", "normal");

              // Render key fields
              exportableColumns.forEach((col) => {
                const columnId = col.id as string;
                // Skip name (already shown as title), internal step columns, and attachments (handled separately for embedded)
                if (
                  columnId === "name" ||
                  columnId === "stepNumber" ||
                  columnId === "isMultiRowContinuation"
                ) {
                  return;
                }

                // Skip attachments column if we're embedding images (we'll render them separately)
                if (
                  columnId === "attachments" &&
                  effectiveOptions.attachmentFormat === "embedded"
                ) {
                  return;
                }

                const value = (item as Record<string, any>)[columnId];
                if (
                  value !== undefined &&
                  value !== null &&
                  value !== "" &&
                  value !== "[]"
                ) {
                  const header =
                    typeof col.header === "string" ? col.header : columnId;

                  // Check for page break
                  if (yPosition > pageHeight - 30) {
                    doc.addPage();
                    yPosition = margin;
                  }

                  doc.setFont("helvetica", "bold");
                  doc.text(`${header}:`, margin, yPosition);
                  doc.setFont("helvetica", "normal");

                  // Handle long text with wrapping
                  const displayValue = sanitizeTextForPdf(
                    typeof value === "boolean"
                      ? value
                        ? "Yes"
                        : "No"
                      : String(value)
                  );

                  const lines: string[] = doc.splitTextToSize(
                    displayValue,
                    contentWidth - 5
                  );
                  // Position text below the label if it's long
                  if (lines.length > 1 || displayValue.length > 60) {
                    yPosition += 5;
                    lines.forEach((line: string) => {
                      doc.text(String(line), margin + 5, yPosition);
                      yPosition += 5;
                    });
                  } else {
                    doc.text(String(lines[0] || ""), margin + 45, yPosition);
                    yPosition += 6;
                  }
                }
              });

              // Render embedded images if enabled
              if (effectiveOptions.attachmentFormat === "embedded") {
                const loadedImages = imageCache.get(index);
                const nonImageAttachments = rawAttachments.filter(
                  (att: any) =>
                    !att.isDeleted && !isEmbeddableImage(att.mimeType)
                );

                // Render loaded images
                if (loadedImages && loadedImages.length > 0) {
                  // Check for page break before attachments section
                  if (yPosition > pageHeight - 50) {
                    doc.addPage();
                    yPosition = margin;
                  }

                  doc.setFont("helvetica", "bold");
                  doc.text("Attachments:", margin, yPosition);
                  yPosition += 6;
                  doc.setFont("helvetica", "normal");

                  loadedImages.forEach((img) => {
                    // Calculate scaled dimensions to fit within max bounds
                    // Convert pixels to mm (assuming 96 DPI)
                    const pixelsToMm = 0.264583;
                    let imgWidthMm = img.width * pixelsToMm;
                    let imgHeightMm = img.height * pixelsToMm;

                    // Scale down if needed
                    if (imgWidthMm > maxImageWidth) {
                      const scale = maxImageWidth / imgWidthMm;
                      imgWidthMm = maxImageWidth;
                      imgHeightMm = imgHeightMm * scale;
                    }
                    if (imgHeightMm > maxImageHeight) {
                      const scale = maxImageHeight / imgHeightMm;
                      imgHeightMm = maxImageHeight;
                      imgWidthMm = imgWidthMm * scale;
                    }

                    // Check if image fits on current page
                    if (yPosition + imgHeightMm + 10 > pageHeight - 20) {
                      doc.addPage();
                      yPosition = margin;
                    }

                    // Add image first, then the name below it
                    // This avoids jsPDF character spacing bug that occurs when text follows addImage
                    try {
                      doc.addImage(
                        img.dataUrl,
                        "JPEG",
                        margin + 5,
                        yPosition,
                        imgWidthMm,
                        imgHeightMm
                      );
                      yPosition += imgHeightMm + 5;

                      // Add image name caption below the image
                      doc.setFontSize(8);
                      doc.setFont("helvetica", "normal");
                      // Use splitTextToSize to work around jsPDF character spacing issues
                      const nameLines = doc.splitTextToSize(sanitizeTextForPdf(img.name), contentWidth - 10);
                      nameLines.forEach((line: string) => {
                        doc.text(line, margin + 5, yPosition);
                        yPosition += 3;
                      });
                      yPosition += 5;
                    } catch (e) {
                      console.warn(
                        "[PDF Export] Failed to add image to PDF:",
                        img.name,
                        e
                      );
                      doc.setFontSize(8);
                      doc.setFont("helvetica", "normal");
                      const errorLines = doc.splitTextToSize(sanitizeTextForPdf(`[Failed to embed: ${img.name}]`), contentWidth - 10);
                      errorLines.forEach((line: string) => {
                        doc.text(line, margin + 5, yPosition);
                        yPosition += 3;
                      });
                      yPosition += 3;
                    }

                    doc.setFontSize(10);
                    doc.setFont("helvetica", "normal");
                  });
                }

                // List non-image attachments by name
                if (nonImageAttachments.length > 0) {
                  if (!loadedImages || loadedImages.length === 0) {
                    doc.setFont("helvetica", "bold");
                    doc.text("Attachments:", margin, yPosition);
                    yPosition += 6;
                    doc.setFont("helvetica", "normal");
                  }

                  doc.setFontSize(9);
                  const nonImageNames = nonImageAttachments
                    .map((att: any) => att.name)
                    .filter(Boolean)
                    .join(", ");
                  if (nonImageNames) {
                    doc.text(
                      sanitizeTextForPdf(`Other files: ${nonImageNames}`),
                      margin + 5,
                      yPosition
                    );
                    yPosition += 5;
                  }
                  doc.setFontSize(10);
                }
              }

              yPosition += 8; // Space between test cases
            }
          );

          // Add page numbers
          const pageCount = doc.getNumberOfPages();
          for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.text(
              `Page ${i} of ${pageCount}`,
              pageWidth / 2,
              pageHeight - 10,
              { align: "center" }
            );
          }

          doc.save(fileName);

          // Log export for audit trail
          logDataExport({
            exportType: "PDF",
            entityType: fileNamePrefix,
            recordCount: transformedAndFormattedData.length,
            projectId: project?.id,
          });
        }
      } catch (error) {
        console.error("Export failed:", error);
        // TODO: Add user-friendly error handling (e.g., toast notification)
      } finally {
        setIsExporting(false);
      }
    },
    [
      fetchAllData,
      currentData,
      selectedIds,
      columns,
      columnVisibility,
      fileNamePrefix,
      t,
      isRunMode,
      testRunCasesData,
      isDefaultSort,
      project?.id,
    ]
  );

  return { isExporting, handleExport };
}
