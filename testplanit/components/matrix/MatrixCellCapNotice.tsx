"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MatrixCellCapError } from "~/hooks/useMatrixAggregation";
import type { MatrixFilters } from "~/lib/matrix/types";

interface MatrixCellCapNoticeProps {
  error: MatrixCellCapError;
  filters: MatrixFilters;
  onChange: (next: Partial<MatrixFilters>) => void;
}

/**
 * Actionable refusal UI for the matrix aggregation 422 cell-cap response.
 *
 * Picks one of three suggestions by naming the largest contributing axis:
 * cases, configurations, or parameter rows (max iterations across cases).
 * If the user already has filters applied, also shows a "Reset filters"
 * button as a release valve.
 */
export function MatrixCellCapNotice({
  error,
  filters,
  onChange,
}: MatrixCellCapNoticeProps) {
  const t = useTranslations("projects.matrix");

  const { caseCount, configCount, perCaseMaxIterations } = error.axisCounts;
  const maxIters = Math.max(
    ...perCaseMaxIterations.map((p) => p.maxIterations),
    1
  );

  const suggestion =
    caseCount > configCount && caseCount > maxIters
      ? t("cellCapSuggestionFilterCases")
      : configCount > maxIters
        ? t("cellCapSuggestionFilterConfigs")
        : t("cellCapSuggestionFilterDates");

  const hasActiveFilters =
    (filters.statusIds && filters.statusIds.length > 0) ||
    (filters.configIds && filters.configIds.length > 0) ||
    (filters.datasetIds && filters.datasetIds.length > 0) ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  return (
    <Alert
      variant="default"
      className="m-3"
      data-testid="matrix-cell-cap-notice"
    >
      <AlertTitle>
        {t("cellCapTitle", {
          cellCount: error.cellCount,
          threshold: error.threshold,
        })}
      </AlertTitle>
      <AlertDescription>
        <p>{suggestion}</p>
        <ul className="mt-2 space-y-1 text-sm">
          <li>{t("cellCapAxisCases", { count: caseCount })}</li>
          <li>{t("cellCapAxisConfigs", { count: configCount })}</li>
          <li>{t("cellCapAxisMaxIters", { count: maxIters })}</li>
        </ul>
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() =>
              onChange({
                statusIds: [],
                configIds: [],
                datasetIds: [],
                dateFrom: undefined,
                dateTo: undefined,
              })
            }
          >
            {t("cellCapResetFilters")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
