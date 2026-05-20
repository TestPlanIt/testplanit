import { z } from "zod/v4";

/**
 * Zod validators for the Matrix view's filter request body.
 *
 * Shared by:
 *   - POST /api/projects/[projectId]/matrix/cell-count
 *   - POST /api/projects/[projectId]/matrix/aggregate
 *   - GET  /api/projects/[projectId]/matrix/export
 *
 * Filter semantics mirror the SQL composition in `lib/matrix/matrixCellCount.ts`
 * and `lib/matrix/matrixAggregation.ts`:
 *
 *   - statusIds  -> EXISTS subquery on TestRunCaseIteration.statusId
 *   - configIds  -> COALESCE(tr."configId", 0) IN (...); the `0` sentinel
 *                   represents "no configuration", so the validator allows
 *                   non-negative integers (NOT positive-only).
 *   - datasetIds -> EXISTS subquery on TestRunCaseDataSetSnapshot.sourceDataSetId
 *   - dateFrom / dateTo -> ISO-8601 datetime bounds on TestRuns."createdAt"
 *
 * Filters are validated as ISO strings; the SQL composers parse them via
 * `new Date(...)` at the SQL boundary so the wire format stays portable.
 */
export const matrixFiltersSchema = z.object({
  statusIds: z.array(z.number().int().positive()).optional(),
  configIds: z.array(z.number().int().nonnegative()).optional(),
  datasetIds: z.array(z.number().int().positive()).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

/**
 * Wraps `matrixFiltersSchema` into the `{ filters }` envelope used by the
 * matrix route bodies. Defaulting `filters` to `{}` lets clients POST an
 * empty body when they want the full unfiltered grid.
 */
export const matrixFiltersBodySchema = z.object({
  filters: matrixFiltersSchema.default({}),
});

export type MatrixFiltersInput = z.infer<typeof matrixFiltersSchema>;
export type MatrixFiltersPayload = z.infer<typeof matrixFiltersBodySchema>;
