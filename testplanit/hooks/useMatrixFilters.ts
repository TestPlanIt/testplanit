"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { usePathname, useRouter } from "~/lib/navigation";
import type { MatrixFilters } from "~/lib/matrix/types";

/**
 * URL-backed filter state for the Matrix view.
 *
 * Multi-value filters (statusIds, configIds, datasetIds) live as repeated
 * keys in the query string (e.g. `?status=1&status=2&config=7`) so the URL
 * stays human-readable + shareable. Date bounds are single-value strings
 * (`?from=ISO&to=ISO`).
 *
 * Reads via `useSearchParams()` from `next/navigation` (cheap subscription).
 * Writes via `router.replace()` from `~/lib/navigation` so the i18n locale
 * prefix is preserved. The `scroll: false` option preserves the grid scroll
 * position when filters change.
 *
 * The filter shape mirrors `lib/schemas/matrixFiltersSchema.ts` exactly —
 * the aggregate route's Zod schema validates the same fields, so the URL
 * parameter names (`status`, `config`, `dataset`, `from`, `to`) and the
 * payload field names (`statusIds`, `configIds`, `datasetIds`, `dateFrom`,
 * `dateTo`) are translated 1:1 here.
 */
export function useMatrixFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: MatrixFilters = useMemo(
    () => ({
      statusIds: params.getAll("status").map(Number).filter(Number.isFinite),
      configIds: params.getAll("config").map(Number).filter(Number.isFinite),
      datasetIds: params.getAll("dataset").map(Number).filter(Number.isFinite),
      // Date bounds piggy-back on the report-builder shell's `startDate`/
      // `endDate` URL convention so the existing date-range picker drives
      // the matrix filter state too — no parallel date inputs needed.
      dateFrom: params.get("startDate") ?? undefined,
      dateTo: params.get("endDate") ?? undefined,
    }),
    [params]
  );

  const setFilters = useCallback(
    (next: Partial<MatrixFilters>) => {
      const sp = new URLSearchParams(params);
      if (next.statusIds !== undefined) {
        sp.delete("status");
        next.statusIds.forEach((id) => sp.append("status", String(id)));
      }
      if (next.configIds !== undefined) {
        sp.delete("config");
        next.configIds.forEach((id) => sp.append("config", String(id)));
      }
      if (next.datasetIds !== undefined) {
        sp.delete("dataset");
        next.datasetIds.forEach((id) => sp.append("dataset", String(id)));
      }
      if (next.dateFrom !== undefined) {
        if (next.dateFrom) {
          sp.set("startDate", next.dateFrom);
        } else {
          sp.delete("startDate");
        }
      }
      if (next.dateTo !== undefined) {
        if (next.dateTo) {
          sp.set("endDate", next.dateTo);
        } else {
          sp.delete("endDate");
        }
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname]
  );

  return { filters, setFilters };
}
