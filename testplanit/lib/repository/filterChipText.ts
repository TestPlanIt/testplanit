import { format, type Locale } from "date-fns";

import type { FilterDimension } from "./filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

/** A selectable value's display name, as the FilterBar's option lists carry it. */
export interface FilterChipValueName {
  id: string | number;
  name: string;
}

export interface FilterChipTextInput {
  dimension: FilterDimension;
  predicate: FilterPredicate;
  /** The dimension's localized label. */
  label: string;
  /** The operator's localized label (chipOperatorLabelKey). */
  operatorLabel: string;
  /** Names for id-valued dimensions; a value without one renders raw. */
  options: readonly FilterChipValueName[];
  /** BCP 47 tag for number formatting; the runtime default when absent. */
  localeTag?: string;
  /** date-fns locale for date values; en-US when absent. */
  dateLocale?: Locale;
}

/**
 * One filter as a chip reads it: "Label: operator values" — ids replaced by
 * their names, dates in the locale's medium form, numbers grouped. Shared by
 * the FilterBar chips and the worker's description of a stored filter so the
 * two never drift.
 */
export function formatFilterChipText({
  dimension,
  predicate,
  label,
  operatorLabel,
  options,
  localeTag,
  dateLocale,
}: FilterChipTextInput): string {
  const formatValue = (value: string | number): string => {
    const option = options.find((o) => String(o.id) === String(value));
    if (option) return option.name;
    if (dimension.valueType === "date") {
      const parsed = new Date(String(value));
      if (!isNaN(parsed.getTime())) {
        return format(parsed, "PP", dateLocale ? { locale: dateLocale } : {});
      }
    }
    if (
      typeof value === "number" &&
      (dimension.valueType === "number" || dimension.valueType === "steps")
    ) {
      return value.toLocaleString(localeTag);
    }
    return String(value);
  };
  const valuesText = predicate.values.map(formatValue).join(", ");
  return valuesText
    ? `${label}: ${operatorLabel} ${valuesText}`
    : `${label}: ${operatorLabel}`;
}
