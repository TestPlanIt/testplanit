"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertCircleIcon, CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  autoMapColumns,
  findUnmappedRequiredParameters,
  SKIP_SENTINEL,
} from "~/lib/utils/datasetMapping";

export interface SharedDatasetMappingFieldsParameter {
  name: string;
  required: boolean;
}

export interface SharedDatasetMappingFieldsProps {
  /** Column names from the pinned dataset version (or latest, when following). */
  datasetColumns: string[];
  /** Parameters declared on the case. */
  parameters: SharedDatasetMappingFieldsParameter[];
  /** column → parameter | "__skip__" mapping (controlled). */
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  /** Reports whether every required parameter has at least one column mapped to it. */
  onValidityChange: (valid: boolean) => void;
}

/**
 * Surface for the shared-dataset assignment dialog's "map columns" section.
 *
 * Mirrors the case-insensitive auto-map heuristic from
 * `wizard/MapColumnsStep.tsx` (the `__skip__` sentinel + required-unmapped
 * alert) but with collapsed-by-default rendering for matched rows. Two
 * visual states per row:
 *
 *   - Auto-matched (column == parameter, case-insensitive): single-line
 *     summary with green check + "Change" link to expand the row.
 *   - Mismatched / required-unmapped: fully expanded with a Select.
 *
 * A "Show all columns" Switch at the top expands every collapsed row for
 * advanced users.
 */
export function SharedDatasetMappingFields({
  datasetColumns,
  parameters,
  mapping,
  onMappingChange,
  onValidityChange,
}: SharedDatasetMappingFieldsProps) {
  const t = useTranslations("parameters");
  const autoMappedRef = useRef(false);
  const [showAll, setShowAll] = useState(false);
  // Per-row "expanded" override — once a user clicks "Change" on an
  // auto-matched row, keep it expanded for the rest of the session even if
  // the user re-matches it.
  const [forceExpanded, setForceExpanded] = useState<Set<string>>(new Set());

  // Auto-map once on mount when the parent did not seed a mapping.
  useEffect(() => {
    if (autoMappedRef.current) return;
    if (Object.keys(mapping).length > 0) {
      autoMappedRef.current = true;
      return;
    }
    if (datasetColumns.length === 0) return;
    autoMappedRef.current = true;
    onMappingChange(autoMapColumns(datasetColumns, parameters));
  }, [datasetColumns, parameters, mapping, onMappingChange]);

  const unmappedRequired = useMemo(
    () => findUnmappedRequiredParameters(mapping, parameters),
    [mapping, parameters]
  );

  useEffect(() => {
    onValidityChange(unmappedRequired.length === 0);
  }, [unmappedRequired, onValidityChange]);

  const isAutoMatch = (column: string, value: string | undefined): boolean => {
    if (!value || value === SKIP_SENTINEL) return false;
    return column.toLowerCase() === value.toLowerCase();
  };

  const isUnknownTarget = (column: string): boolean => {
    const value = mapping[column];
    if (!value || value === SKIP_SENTINEL) return false;
    return !parameters.some((p) => p.name === value);
  };

  return (
    <div className="space-y-3" data-testid="shared-mapping-fields">
      {unmappedRequired.length > 0 && (
        <Alert
          variant="destructive"
          data-testid="shared-mapping-required-alert"
        >
          <AlertCircleIcon className="w-4 h-4" />
          <AlertDescription>
            {t("mappingRequiredAlert", {
              names: unmappedRequired.map((p) => p.name).join(", "),
            })}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t("mappingHint")}
        </span>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={showAll}
            onCheckedChange={setShowAll}
            data-testid="shared-mapping-show-all"
            aria-label={t("mappingShowAll")}
          />
          <span>{t("mappingShowAll")}</span>
        </label>
      </div>

      <div className="space-y-2">
        {datasetColumns.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {t("mappingNoColumns")}
          </div>
        )}
        {datasetColumns.map((column) => {
          const value = mapping[column] ?? SKIP_SENTINEL;
          const matched = isAutoMatch(column, value);
          const expanded = showAll || forceExpanded.has(column) || !matched;
          const unknownTarget = isUnknownTarget(column);
          const showRedBorder = unknownTarget;
          return (
            <div
              key={column}
              className={
                showRedBorder
                  ? "border border-destructive rounded-md p-3"
                  : "border rounded-md p-3"
              }
              data-testid={`shared-mapping-row-${column}`}
            >
              {!expanded ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckIcon className="w-3 h-3 text-emerald-600" />
                    <span className="font-mono text-sm">{column}</span>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    onClick={() =>
                      setForceExpanded((prev) => {
                        const next = new Set(prev);
                        next.add(column);
                        return next;
                      })
                    }
                    data-testid={`shared-mapping-change-${column}`}
                  >
                    {t("mappingChange")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm shrink-0 w-1/3">
                    {column}
                  </span>
                  <div className="flex-1">
                    <Select
                      value={value}
                      onValueChange={(v) =>
                        onMappingChange({ ...mapping, [column]: v })
                      }
                    >
                      <SelectTrigger
                        data-testid={`shared-mapping-select-${column}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP_SENTINEL}>
                          {t("mappingSkipColumn")}
                        </SelectItem>
                        {parameters.map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            {p.name}
                            {p.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showRedBorder && (
                      <div className="flex items-start gap-1 text-xs text-destructive mt-1">
                        <AlertCircleIcon className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>
                          {t("mappingRequiredUnmapped", { name: column })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
