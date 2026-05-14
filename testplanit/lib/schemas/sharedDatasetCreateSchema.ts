import { z } from "zod/v4";

/**
 * Zod schema for the project-scoped shared-dataset create payload.
 *
 * The shared dataset is project-owned (no `ownerCaseId`) and starts at
 * `version: 1` with zero `DataSetVersion` rows; the lazy v1 backfill on
 * first explicit Save inserts the v1 baseline + the v2 post-save row.
 */
export const sharedDatasetCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

export type SharedDatasetCreatePayload = z.infer<
  typeof sharedDatasetCreateSchema
>;
