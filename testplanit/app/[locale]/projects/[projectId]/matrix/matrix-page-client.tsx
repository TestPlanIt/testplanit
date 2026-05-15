"use client";

import { useTranslations } from "next-intl";

import { MatrixCellCapNotice } from "@/components/matrix/MatrixCellCapNotice";
import { MatrixFilterBar } from "@/components/matrix/MatrixFilterBar";
import { MatrixGrid } from "@/components/matrix/MatrixGrid";
import { MatrixToolbar } from "@/components/matrix/MatrixToolbar";
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
  const { filters, setFilters } = useMatrixFilters();
  const query = useMatrixAggregation(projectId, filters);

  return (
    <div className="flex h-full flex-col" data-testid="matrix-page-client">
      <MatrixToolbar
        projectId={projectId}
        filters={filters}
        hasData={Boolean(query.data && query.data.cellCount > 0)}
      />
      <MatrixFilterBar
        projectId={projectId}
        filters={filters}
        onChange={setFilters}
      />

      {query.isLoading && (
        <div
          className="flex flex-1 items-center justify-center text-muted-foreground"
          data-testid="matrix-loading"
        >
          {t("loading")}
        </div>
      )}

      {query.error?.matrixError?.type === "cell_cap_exceeded" && (
        <MatrixCellCapNotice
          error={query.error.matrixError}
          filters={filters}
          onChange={setFilters}
        />
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
