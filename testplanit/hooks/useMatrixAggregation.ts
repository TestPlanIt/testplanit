"use client";

import { useQuery } from "@tanstack/react-query";

import type { AxesShape, CellSummary, MatrixFilters } from "~/lib/matrix/types";

/**
 * Typed payload of a 422 cell-cap refusal from
 * `POST /api/projects/[projectId]/matrix/aggregate`. Surfaced via a thrown
 * Error whose `matrixError` field carries the structured details so the
 * UI can render the cell-cap notice without re-parsing the response body.
 */
export interface MatrixCellCapError {
  type: "cell_cap_exceeded";
  cellCount: number;
  threshold: number;
  axisCounts: {
    caseCount: number;
    configCount: number;
    perCaseMaxIterations: Array<{
      caseId: number;
      maxIterations: number;
    }>;
  };
}

/**
 * Error subclass raised when the aggregate route returns a 422 cell-cap
 * refusal. Tagged via `matrixError.type === "cell_cap_exceeded"` so callers
 * can branch on the structured payload without `instanceof` discipline.
 */
export class MatrixAggregationError extends Error {
  public readonly matrixError?: MatrixCellCapError;
  constructor(message: string, matrixError?: MatrixCellCapError) {
    super(message);
    this.name = "MatrixAggregationError";
    this.matrixError = matrixError;
  }
}

/**
 * Server response shape from the aggregate route. The route serializes
 * `cells` as `Array<[key, CellSummary]>` because `JSON.stringify(new Map())`
 * returns `{}`; this hook reconstructs the Map client-side.
 */
interface MatrixAggregationResponse {
  caseAxis: AxesShape["caseAxis"];
  configAxis: AxesShape["configAxis"];
  cells: Array<[string, CellSummary]>;
  cellCount: number;
  statusMap: AxesShape["statusMap"];
}

/**
 * React Query hook for the matrix aggregation endpoint.
 *
 * POSTs the filter envelope to `/api/projects/{projectId}/matrix/aggregate`
 * and reconstructs the `cells` Map for O(1) cell lookup at render time.
 *
 * Behavior contract:
 *   - 200 → resolves with the full `AxesShape` (cells re-hydrated as Map).
 *   - 422 with `error: "cell_cap_exceeded"` → throws `MatrixAggregationError`
 *     carrying `matrixError` so the UI can render the cap notice.
 *   - Any other non-2xx → throws a generic Error.
 *
 * `retry: false` is intentional — the 422 cap refusal MUST NOT be retried
 * because the user needs to change filters, not retry the same payload.
 * `keepPreviousData` is intentionally NOT set — when filters change the
 * old grid should clear so the loading state is visible.
 */
export function useMatrixAggregation(
  projectId: number | null,
  filters: MatrixFilters
) {
  return useQuery<AxesShape, MatrixAggregationError>({
    queryKey: ["matrix", "aggregate", projectId, filters],
    enabled: projectId != null && projectId > 0,
    retry: false,
    queryFn: async (): Promise<AxesShape> => {
      const res = await fetch(`/api/projects/${projectId}/matrix/aggregate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });

      if (res.status === 422) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === "cell_cap_exceeded") {
          throw new MatrixAggregationError("cell_cap_exceeded", {
            type: "cell_cap_exceeded",
            cellCount: body.cellCount,
            threshold: body.threshold,
            axisCounts: body.axisCounts,
          });
        }
        throw new MatrixAggregationError(
          `Matrix aggregation rejected (422): ${JSON.stringify(body)}`
        );
      }

      if (!res.ok) {
        throw new MatrixAggregationError(
          `Matrix aggregation failed: ${res.status}`
        );
      }

      const json = (await res.json()) as MatrixAggregationResponse;
      const cells = new Map<string, CellSummary>(json.cells);
      return {
        caseAxis: json.caseAxis,
        configAxis: json.configAxis,
        cells,
        cellCount: json.cellCount,
        statusMap: json.statusMap,
      };
    },
  });
}
