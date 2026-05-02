import { useMemo } from "react";
import type { PageSizeOption } from "~/lib/contexts/PaginationContext";

/**
 * Compute the page-size dropdown options dynamically from the total row count.
 *
 * - `totalItems <= 10` → only `["All"]` is offered (a paginator over ≤10 rows
 *   adds no value).
 * - Otherwise, filter `[10, 25, 50, 100, 250]` to sizes strictly less than
 *   `totalItems`, then append `"All"`.
 *
 * Mirrors the convention established in
 * `app/[locale]/projects/repository/[projectId]/Cases.tsx` so every PaginationInfo
 * surface in the app offers the same options for the same data size.
 */
export function usePageSizeOptions(totalItems: number): PageSizeOption[] {
  return useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);
}
