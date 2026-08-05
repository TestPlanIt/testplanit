"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { type LucideIcon, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { FilterDimension } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { getDateFnsLocale } from "~/utils/locales";
import { chipOperatorLabelKey } from "./dimensionPresentation";
import { FilterChipEditor } from "./FilterChipEditor";
import type { FilterValueOption } from "./valueOptions";

export interface FilterChipProps {
  dimension: FilterDimension;
  predicate: FilterPredicate;
  /** Localized dimension label (getDimensionLabel). */
  label: string;
  icon: LucideIcon;
  /** Value options for label hydration and the editor's value list. */
  options: FilterValueOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editor commit path; the bar maps it onto onUpdate/onAdd. */
  onChange: (next: FilterPredicate) => void;
  onRemove: () => void;
  countsMuted?: boolean;
  /** Lets the bar move focus to a neighboring chip after a removal. */
  removeButtonRef?: (element: HTMLButtonElement | null) => void;
}

/**
 * One active filter as an editable chip: icon + "Label: op values" + X.
 * Anatomy follows ReportFilterChips' Badge chips (which use
 * variant="secondary"; outline here is deliberate — spec §5), with the chip
 * body wrapped in a Popover that opens the editor.
 */
export function FilterChip({
  dimension,
  predicate,
  label,
  icon: Icon,
  options,
  open,
  onOpenChange,
  onChange,
  onRemove,
  countsMuted,
  removeButtonRef,
}: FilterChipProps) {
  const t = useTranslations();
  const locale = useLocale();

  const chipText = useMemo(() => {
    const operatorLabel = t(
      chipOperatorLabelKey(predicate.operator, predicate.values.length)
    );
    const formatValue = (value: string | number): string => {
      const option = options.find((o) => String(o.id) === String(value));
      if (option) return option.name;
      if (dimension.valueType === "date") {
        const parsed = new Date(String(value));
        if (!isNaN(parsed.getTime())) {
          return format(parsed, "PP", { locale: getDateFnsLocale(locale) });
        }
      }
      if (
        typeof value === "number" &&
        (dimension.valueType === "number" || dimension.valueType === "steps")
      ) {
        return value.toLocaleString(locale);
      }
      return String(value);
    };
    const valuesText = predicate.values.map(formatValue).join(", ");
    return valuesText
      ? `${label}: ${operatorLabel} ${valuesText}`
      : `${label}: ${operatorLabel}`;
  }, [t, predicate, options, dimension.valueType, label, locale]);

  return (
    <Badge
      variant="outline"
      className="ps-2 pe-1 py-1 gap-1.5 max-w-full"
      data-testid={`filter-chip-${predicate.dimension}-${predicate.operator}`}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center min-w-0"
            aria-label={t("repository.filterBar.editFilter", {
              name: chipText,
            })}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon className="w-3 h-3 shrink-0" />
              <span className="text-xs truncate max-w-60">{chipText}</span>
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <FilterChipEditor
            dimension={dimension}
            predicate={predicate}
            options={options}
            onChange={onChange}
            countsMuted={countsMuted}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="sm"
        className="h-4 w-4 p-0 hover:bg-transparent"
        onClick={onRemove}
        aria-label={t("repository.filterBar.removeFilter", { name: chipText })}
        data-testid={`filter-chip-${predicate.dimension}-${predicate.operator}-remove`}
        ref={removeButtonRef}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}
