"use client";

import { useTranslations } from "next-intl";

import { MatrixGrid } from "@/components/matrix/MatrixGrid";
import { useMatrixAggregation } from "~/hooks/useMatrixAggregation";
import { useMatrixFilters } from "~/hooks/useMatrixFilters";

/**
 * Client-side orchestrator for the matrix page.
 *
 * Owns:
 *   - URL-backed filter state (`useMatrixFilters`)
 *   - Server data fetching (`useMatrixAggregation`)
 *   - Render dispatch to chrome (filter bar, cap notice, toolbar — all
 *     ship in a follow-up plan) and to the virtualized grid.
 *
 * Mount-point layout (top to bottom):
 *   1. Filter bar — added by a follow-up plan; the back-patch is a
 *      single import + JSX line at the marked anchor below.
 *   2. Toolbar — same back-patch pattern; mount between filter bar and
 *      the grid.
 *   3. Cell-cap notice — rendered when the aggregate route refuses with
 *      a 422; back-patched in the same follow-up plan.
 *   4. Grid — owned by this plan (Task 4.3).
 */
export function MatrixPageClient({ projectId }: { projectId: number }) {
  const t = useTranslations("projects.matrix");
  const { filters } = useMatrixFilters();
  const query = useMatrixAggregation(projectId, filters);

  return (
    <div className="flex h-full flex-col" data-testid="matrix-page-client">
      {/* MOUNT_POINT: MatrixFilterBar — follow-up plan adds the import + JSX line here */}
      {/* MOUNT_POINT: MatrixToolbar — follow-up plan adds the import + JSX line here */}

      {query.isLoading && (
        <div
          className="flex flex-1 items-center justify-center text-muted-foreground"
          data-testid="matrix-loading"
        >
          {t("loading")}
        </div>
      )}

      {query.error?.matrixError?.type === "cell_cap_exceeded" && (
        <div
          className="m-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900"
          data-testid="matrix-cell-cap-placeholder"
        >
          {t("cellCapShort", {
            cells: query.error.matrixError.cellCount,
            threshold: query.error.matrixError.threshold,
          })}
          {/* MOUNT_POINT: MatrixCellCapNotice — follow-up plan replaces this placeholder with the full component */}
        </div>
      )}

      {query.error && !query.error.matrixError && (
        <div
          className="m-4 rounded-md border border-destructive bg-destructive/10 p-4 text-destructive"
          data-testid="matrix-error"
        >
          {t("loadError")}
        </div>
      )}

      {query.data && <MatrixGrid axes={query.data} projectId={projectId} />}
    </div>
  );
}
