"use client";

import { Alert } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import {
  buildRowSchemaFromParameters,
  type ParameterShape,
} from "~/lib/schemas/datasetRowSchema";
import { cn } from "~/utils";

const PREVIEW_LIMIT = 50;
const SKIP_VALUE = "__skip__";

export interface PreviewStepProps {
  rows: Record<string, unknown>[];
  /** csvHeader -> paramName | "__skip__" */
  mapping: Record<string, string>;
  parameters: ParameterShape[];
  /** Reports the validation error count (rows with at least one issue). */
  onValidityChange: (errorCount: number) => void;
}

interface ValidationOutput {
  cellErrors: Map<string, string>;
  errorRowCount: number;
}

/**
 * Surface E.4 — Step 3 (Preview + validate).
 *
 * Validates every row up-front via `buildRowSchemaFromParameters` (the
 * SAME factory the server uses in the import-csv endpoint, per Plan
 * 02-02 SUMMARY). Cells that fail coercion render a red border + an
 * AlertCircle with a tooltip showing the issue message. Only the first
 * 50 rows are shown; all rows are validated.
 */
export function PreviewStep({
  rows,
  mapping,
  parameters,
  onValidityChange,
}: PreviewStepProps) {
  const t = useTranslations("parameters");

  const validation = useMemo<ValidationOutput>(() => {
    const schema = buildRowSchemaFromParameters(parameters);
    const cellErrors = new Map<string, string>();
    let errorRowCount = 0;
    rows.forEach((csvRow, rowIdx) => {
      const mapped: Record<string, unknown> = {};
      for (const [csvHeader, paramName] of Object.entries(mapping)) {
        if (paramName === SKIP_VALUE) continue;
        mapped[paramName] = csvRow[csvHeader];
      }
      const result = (schema as any).safeParse(mapped);
      if (!result.success) {
        errorRowCount += 1;
        const issues = result.error?.issues ?? [];
        for (const issue of issues) {
          const path = (issue.path ?? []).join(".");
          cellErrors.set(`${rowIdx}.${path}`, issue.message ?? "Invalid value");
        }
      }
    });
    return { cellErrors, errorRowCount };
  }, [rows, mapping, parameters]);

  useEffect(() => {
    onValidityChange(validation.errorRowCount);
  }, [validation.errorRowCount, onValidityChange]);

  const totalRows = rows.length;
  const previewRows = rows.slice(0, PREVIEW_LIMIT);
  const mappedHeaders = useMemo(
    () =>
      Object.entries(mapping)
        .filter(([, p]) => p !== SKIP_VALUE)
        .map(([csvHeader, paramName]) => ({ csvHeader, paramName })),
    [mapping]
  );

  return (
    <div
      className="p-6 space-y-4"
      data-testid="dataset-import-wizard-step-preview"
    >
      <Alert
        variant={validation.errorRowCount === 0 ? "default" : "destructive"}
        data-testid="dataset-import-wizard-preview-summary"
      >
        {validation.errorRowCount === 0
          ? t("importStep3SummaryOk", { totalRows })
          : t("importStep3SummaryErrors", {
              totalRows,
              errorCount: validation.errorRowCount,
            })}
      </Alert>

      <p className="text-xs text-muted-foreground">
        {t("importStep3PreviewLimit", { limit: String(PREVIEW_LIMIT) })}
      </p>

      <ScrollArea className="border rounded-md max-h-96">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 sticky top-0">
            <tr>
              {mappedHeaders.map(({ paramName }) => (
                <th key={paramName} className="px-2 py-1 text-left font-mono">
                  {`@${paramName}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {mappedHeaders.map(({ csvHeader, paramName }) => {
                  const errorKey = `${rowIdx}.${paramName}`;
                  const error = validation.cellErrors.get(errorKey);
                  return (
                    <td
                      key={paramName}
                      className={cn(
                        "px-2 py-1 relative align-top",
                        error && "border border-destructive"
                      )}
                      data-testid={
                        error
                          ? `dataset-import-wizard-preview-cell-error-${rowIdx}-${paramName}`
                          : undefined
                      }
                    >
                      {String(row[csvHeader] ?? "")}
                      {error ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="absolute top-0 right-0 p-0.5">
                              <AlertCircle className="text-destructive w-3 h-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{error}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
