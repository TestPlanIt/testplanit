import { useState, useCallback } from "react";
import Papa from "papaparse";
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
            item.attachments?.map((att: any) => att.name).join(", ") ?? "";
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

        // Transform and format data
        const transformedAndFormattedData = dataToExportInitial.flatMap(
          (item) => {
            const activeSteps =
              item.steps?.filter((step) => !step.isDeleted) ?? [];

            if (options.rowMode === "single") {
              let combinedStepData = "";
              if (options.stepsFormat === "json") {
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
                options,
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
                    options,
                    exportableColumns,
                    t
                  )
                );
              } else {
                activeSteps.forEach((step, index) => {
                  const stepContent = formatStepContent(
                    step.step,
                    options.stepsFormat
                  );
                  // Check isDeleted before formatting expectedResult
                  const expectedResultContent =
                    !step.expectedResult || step.expectedResult.isDeleted
                      ? ""
                      : formatStepContent(
                          step.expectedResult.expectedResult,
                          options.stepsFormat
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
                        options,
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
                        options,
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
        // PDF Export Logic (Placeholder)
        else if (options.format === "pdf") {
          console.warn("PDF export is not yet implemented.");
          // TODO: Implement PDF export logic or show message
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
    ]
  );

  return { isExporting, handleExport };
}
