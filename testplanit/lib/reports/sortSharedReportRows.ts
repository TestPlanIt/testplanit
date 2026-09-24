/**
 * Client-side sort for the shared/frozen report viewer, which holds the whole
 * result set in memory. Column ids are metric and dimension ids; rows key a
 * metric by its label ("Test Results Count" for "testResults"), and a
 * dimension's value is often an object ({ id, name, ... }).
 */

export interface SharedReportMetric {
  value: string;
  label: string;
}

/** The value a column sorts by: the metric's stored key, a dimension's name. */
export function sharedReportSortValue(
  row: Record<string, unknown>,
  column: string,
  metrics: readonly SharedReportMetric[]
): unknown {
  const metric = metrics.find((m) => m.value === column);
  const raw = metric && metric.label in row ? row[metric.label] : row[column];

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    return (
      value.name ??
      value.templateName ??
      value.executedAt ??
      value.createdAt ??
      null
    );
  }
  return raw;
}

function compareValues(a: unknown, b: unknown, locale?: string): number {
  if (a === b) return 0;
  // Missing values sort last in either direction (handled by the caller).
  if (typeof a === "number" && typeof b === "number") return a - b;
  const numA = typeof a === "string" ? Number(a) : NaN;
  const numB = typeof b === "string" ? Number(b) : NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && a !== "" && b !== "") {
    return numA - numB;
  }
  return String(a).localeCompare(String(b), locale, { numeric: true });
}

export function sortSharedReportRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  sort: { column: string; direction: "asc" | "desc" } | null,
  metrics: readonly SharedReportMetric[],
  locale?: string
): T[] {
  const sorted = [...rows];
  if (!sort) return sorted;

  sorted.sort((rowA, rowB) => {
    const a = sharedReportSortValue(rowA, sort.column, metrics);
    const b = sharedReportSortValue(rowB, sort.column, metrics);
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      return aMissing ? 1 : -1;
    }
    const comparison = compareValues(a, b, locale);
    return sort.direction === "asc" ? comparison : -comparison;
  });
  return sorted;
}
