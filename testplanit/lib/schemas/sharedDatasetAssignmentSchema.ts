import { z } from "zod/v4";

/**
 * Payload schema for the per-case shared-dataset assignment endpoint.
 *
 * `mappingJson` is keyed by dataset COLUMN name (the column name as it
 * appears in the pinned `DataSetVersion.parametersJson`/`rowsJson`). The
 * value is the parameter name on the case OR the literal string
 * `"__skip__"` to explicitly drop a column. Both string lengths are bounded
 * to 80 chars to defuse pathological keys (prototype-pollution-style large
 * strings, slow JSON parses).
 *
 * The mapping schema purposely does NOT enforce a value-side enum: the
 * skip-sentinel is a single literal string, and any further validation
 * (column-exists, parameter-exists, required-coverage) requires reading
 * the live case + version state, so the route handler runs that check
 * rather than the parser.
 */
export const sharedDatasetAssignmentSchema = z.object({
  sharedDataSetId: z.number().int().positive(),
  pinnedVersionId: z.number().int().positive().nullable(),
  mappingJson: z.record(z.string().min(1).max(80), z.string().min(1).max(80)),
});

export type SharedDatasetAssignmentPayload = z.infer<
  typeof sharedDatasetAssignmentSchema
>;

/**
 * Sentinel value used in `mappingJson` to indicate "this column is
 * intentionally not mapped to any parameter." Mirrors the existing
 * `wizard/MapColumnsStep.tsx` convention so the mapping dialog and the
 * server share the same vocabulary.
 */
export const SKIP_MAPPING_SENTINEL = "__skip__";
