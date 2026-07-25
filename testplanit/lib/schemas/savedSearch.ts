import type { JsonValue } from "@zenstackhq/orm";
import { z } from "zod/v4";

import {
  SearchableEntityType,
  type UnifiedSearchFilters,
} from "~/types/search";

/**
 * Persistence contract for named saved searches. A saved search is stored as a
 * `ShareLink` row (`entityType: SEARCH`) whose `entityConfig` Json holds the
 * subset of the Unified Search state needed to reconstruct the search. Runtime
 * fields (results, page cursor, active tab, counts) are intentionally excluded.
 *
 * Date filters round-trip through JSON as ISO strings, so the read path coerces
 * them back to `Date` before the criteria reach the search UI/`/api/search`
 * (whose `dateRange` expects real dates). Custom-field values stay as-is — the
 * search route validates them as `z.any()`, matching how they flow today.
 */

export const SAVED_SEARCH_CONFIG_VERSION = 1;

const coercedDate = z.coerce.date();

const dateRangeSchema = z
  .object({
    field: z.enum(["createdAt", "updatedAt", "completedAt"]),
    from: coercedDate.optional(),
    to: coercedDate.optional(),
  })
  .partial({ field: true });

const rangeSchema = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .loose();

const customFieldSchema = z
  .object({
    fieldId: z.number(),
    fieldName: z.string().optional(),
    fieldType: z.string().optional(),
    operator: z.string().optional(),
    // `.optional()` is load-bearing on z.any(): JSON.stringify drops
    // undefined-valued keys, and zod 4.4+ rejects a MISSING key on a bare
    // z.any() property.
    value: z.any().optional(),
    value2: z.any().optional(),
  })
  .loose();

const baseEntityFilterShape = {
  projectIds: z.array(z.number()).optional(),
  creatorIds: z.array(z.string()).optional(),
  tagIds: z.array(z.number()).optional(),
  stateIds: z.array(z.number()).optional(),
  includeDeleted: z.boolean().optional(),
  dateRange: dateRangeSchema.optional(),
};

const repositoryCaseFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    repositoryIds: z.array(z.number()).optional(),
    folderIds: z.array(z.number()).optional(),
    templateIds: z.array(z.number()).optional(),
    automated: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    customFields: z.array(customFieldSchema).optional(),
    source: z.array(z.string()).optional(),
    estimateRange: rangeSchema.optional(),
  })
  .loose();

const testRunFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    configurationIds: z.array(z.number()).optional(),
    milestoneIds: z.array(z.number()).optional(),
    isCompleted: z.boolean().optional(),
    testRunType: z.enum(["REGULAR", "JUNIT"]).optional(),
    customFields: z.array(customFieldSchema).optional(),
    elapsedRange: rangeSchema.optional(),
  })
  .loose();

const sessionFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    templateIds: z.array(z.number()).optional(),
    assignedToIds: z.array(z.string()).optional(),
    configurationIds: z.array(z.number()).optional(),
    milestoneIds: z.array(z.number()).optional(),
    isCompleted: z.boolean().optional(),
    customFields: z.array(customFieldSchema).optional(),
    elapsedRange: rangeSchema.optional(),
    estimateRange: rangeSchema.optional(),
  })
  .loose();

const sharedStepFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    projectIds: z.array(z.number()),
  })
  .loose();

const projectFilterSchema = z
  .object({
    creatorIds: z.array(z.string()).optional(),
    isDeleted: z.boolean().optional(),
    dateRange: dateRangeSchema.optional(),
  })
  .loose();

const issueFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    externalIds: z.array(z.string()).optional(),
    hasExternalId: z.boolean().optional(),
  })
  .loose();

const milestoneFilterSchema = z
  .object({
    ...baseEntityFilterShape,
    milestoneTypeIds: z.array(z.number()).optional(),
    parentIds: z.array(z.number()).optional(),
    isCompleted: z.boolean().optional(),
    dueDateRange: z
      .object({ from: coercedDate.optional(), to: coercedDate.optional() })
      .optional(),
    hasParent: z.boolean().optional(),
  })
  .loose();

const entityTypeSchema = z.enum(SearchableEntityType);

export const unifiedSearchFiltersSchema = z
  .object({
    entityTypes: z.array(entityTypeSchema).optional(),
    query: z.string().optional(),
    includeDeleted: z.boolean().optional(),
    repositoryCase: repositoryCaseFilterSchema.optional(),
    testRun: testRunFilterSchema.optional(),
    session: sessionFilterSchema.optional(),
    sharedStep: sharedStepFilterSchema.optional(),
    project: projectFilterSchema.optional(),
    issue: issueFilterSchema.optional(),
    milestone: milestoneFilterSchema.optional(),
  })
  .loose();

export const savedSearchConfigSchema = z.object({
  version: z.literal(SAVED_SEARCH_CONFIG_VERSION),
  query: z.string(),
  selectedEntities: z.array(entityTypeSchema),
  currentProjectOnly: z.boolean(),
  filters: unifiedSearchFiltersSchema,
});

export type SavedSearchConfig = z.infer<typeof savedSearchConfigSchema>;

/** The applyable slice of Unified Search state a saved search captures. */
export interface SavedSearchCriteria {
  query: string;
  selectedEntities: SearchableEntityType[];
  currentProjectOnly: boolean;
  filters: UnifiedSearchFilters;
}

/**
 * Build the `entityConfig` payload from the live Unified Search criteria. The
 * JSON round-trip yields a Prisma-safe value: `Date` filters become ISO strings
 * (Prisma's Json input rejects `Date`) and `undefined` keys drop.
 * {@link parseSavedSearchConfig} revives the dates on read.
 */
export function buildSavedSearchConfig(
  criteria: SavedSearchCriteria
): JsonValue {
  const config = {
    version: SAVED_SEARCH_CONFIG_VERSION,
    query: criteria.query,
    selectedEntities: criteria.selectedEntities,
    currentProjectOnly: criteria.currentProjectOnly,
    filters: criteria.filters,
  };
  return JSON.parse(JSON.stringify(config)) as JsonValue;
}

/**
 * Validate a persisted `entityConfig` and revive it into applyable criteria.
 * Returns `null` for malformed or unrecognized-version configs so the UI can
 * skip a corrupt saved search instead of throwing.
 */
export function parseSavedSearchConfig(
  raw: unknown
): SavedSearchCriteria | null {
  const result = savedSearchConfigSchema.safeParse(raw);
  if (!result.success) return null;

  const { query, selectedEntities, currentProjectOnly, filters } = result.data;
  return {
    query,
    selectedEntities,
    currentProjectOnly,
    filters: filters as unknown as UnifiedSearchFilters,
  };
}
