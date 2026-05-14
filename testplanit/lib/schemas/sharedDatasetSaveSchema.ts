import { z } from "zod/v4";

/**
 * Zod schemas for the shared-dataset Save payload.
 *
 * Save is the explicit commit boundary for shared-dataset edits — every
 * Save inserts a new immutable `DataSetVersion` row (and, on the very
 * first save of a previously-unversioned shared dataset, the lazy v1
 * baseline as well). The 5000-row cap mirrors the Phase 3
 * `PARAMETERIZED_RUN_HARD_CAP` ceiling: a dataset that can never be used
 * in a run is not worth versioning.
 *
 * `branchedFromVersionId` is set when the user is editing a historical
 * version (last-write-wins, no merge UI); the new version is always
 * `currentMax + 1` regardless, and the branch source is captured in the
 * audit trail only.
 */

export const sharedDatasetRowSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  valuesJson: z.record(z.string(), z.unknown()),
});

export const sharedDatasetParameterSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["STRING", "INTEGER", "BOOLEAN", "SELECT"]),
  sensitive: z.boolean().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().int(),
  allowedValues: z.array(z.string()).optional(),
});

export const sharedDatasetSaveSchema = z.object({
  parametersJson: z.array(sharedDatasetParameterSchema).optional(),
  rowsJson: z.array(sharedDatasetRowSchema).max(5000),
  branchedFromVersionId: z.number().int().positive().optional(),
});

export type SharedDatasetSavePayload = z.infer<typeof sharedDatasetSaveSchema>;
export type SharedDatasetParameter = z.infer<typeof sharedDatasetParameterSchema>;
export type SharedDatasetRow = z.infer<typeof sharedDatasetRowSchema>;
