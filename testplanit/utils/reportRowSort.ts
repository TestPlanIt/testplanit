/**
 * Server-side row ordering for the "dimension × metric" report handlers.
 *
 * `ReportBuilder` sends `sortColumn`/`sortDirection` with every run of a
 * custom report and re-fetches on each header click, so a handler that
 * ignores the pair leaves the table in its default order no matter what
 * the header shows. This is the one implementation behind
 * `reportApiUtils`' two aggregations and the session-analysis,
 * project-health and milestone-readiness routes, which build rows of the
 * same shape: a dimension cell is a display object (`{ id, name }`, or
 * `{ executedAt | createdAt }` for the date dimension) and a metric cell
 * is keyed by the metric's LABEL, not its id.
 *
 * - A dimension column sorts by its display name (falling back to id);
 *   the date dimension by its timestamp.
 * - A metric column is looked up by id, honouring the handful of
 *   frontend→backend aliases `ReportBuilder` applies, and read by label.
 *   An id with no config falls back to the raw property.
 * - Empty cells sort last under either direction.
 * - Numeric and string ties break on the date dimension when the report
 *   has one, so a re-sort keeps a time series readable.
 *
 * Sorts IN PLACE and returns the same array; with no sort configured the
 * rows are left untouched so a handler's default order stands.
 */

export interface ReportSortMetric {
  id: string;
  label: string;
}

export interface ReportSortOptions {
  dimensions: string[];
  metricConfigs: ReportSortMetric[];
  sortColumn?: string | null;
  sortDirection?: string | null;
}

interface DimensionCell {
  name?: string;
  id?: number | string | null;
  executedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

// The ids ReportBuilder sends for metrics whose frontend id differs from
// the registry's.
const METRIC_ID_ALIASES: Record<string, string> = {
  testResultCount: "testResults",
  avgElapsed: "avgElapsedTime",
  sumElapsed: "totalElapsedTime",
};

function dateOf(cell: unknown): string | Date | null | undefined {
  const value = cell as DimensionCell | null | undefined;
  return value?.executedAt || value?.createdAt;
}

function toTime(value: unknown): number {
  return new Date(value as string | number | Date).getTime();
}

export function sortReportRows<T extends Record<string, unknown>>(
  rows: T[],
  { dimensions, metricConfigs, sortColumn, sortDirection }: ReportSortOptions
): T[] {
  if (!sortColumn || (sortDirection !== "asc" && sortDirection !== "desc")) {
    return rows;
  }
  const multiplier = sortDirection === "asc" ? 1 : -1;
  const isDimension = dimensions.includes(sortColumn);
  const metricLabel = isDimension
    ? null
    : (metricConfigs.find(
        (mc) => mc.id === sortColumn || mc.id === METRIC_ID_ALIASES[sortColumn]
      )?.label ?? null);
  const tieBreakOnDate = dimensions.includes("date") && sortColumn !== "date";

  const valueOf = (row: T): unknown => {
    if (isDimension) {
      if (sortColumn === "date") return dateOf(row[sortColumn]);
      const cell = row[sortColumn] as DimensionCell | null | undefined;
      return cell?.name || cell?.id;
    }
    return row[metricLabel ?? sortColumn];
  };
  const byDate = (a: T, b: T): number => {
    const aDate = dateOf(a.date);
    const bDate = dateOf(b.date);
    return aDate && bDate ? toTime(aDate) - toTime(bDate) : 0;
  };

  rows.sort((a, b) => {
    const aVal = valueOf(a);
    const bVal = valueOf(b);

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    if (sortColumn === "date" || aVal instanceof Date || bVal instanceof Date) {
      return (toTime(aVal) - toTime(bVal)) * multiplier;
    }

    const comparison =
      typeof aVal === "number" && typeof bVal === "number"
        ? (aVal - bVal) * multiplier
        : String(aVal).localeCompare(String(bVal)) * multiplier;
    if (comparison === 0 && tieBreakOnDate) return byDate(a, b);
    return comparison;
  });
  return rows;
}
