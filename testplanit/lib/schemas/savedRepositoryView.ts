import type { JsonValue } from "@zenstackhq/orm";
import { z } from "zod/v4";

import type { FilterDimensionRegistry } from "~/lib/repository/filterDimensions";
import {
  clampFilterPredicates,
  EMPTY_FILTER_CAP_TRUNCATION,
  parseFilterPredicates,
  reportFilterCapTruncation,
  type FilterCapTruncation,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

/**
 * Persistence contract for named saved repository views, mirroring saved
 * unified searches (lib/schemas/savedSearch.ts). A saved view is a `ShareLink`
 * row (`entityType: REPOSITORY_VIEW`) whose `entityConfig` Json holds the
 * subset of repository state needed to reconstruct what the user was looking
 * at: the filter predicates, the grouping axis (`?view=`), the search text and
 * the project the view belongs to.
 *
 * The read path is lenient in exactly the way the URL read path is: predicates
 * are validated through the same registry-driven parse
 * (`parseFilterPredicates`), so a predicate on a dimension that no longer
 * exists — a deleted custom field, a run-only dimension outside run mode — is
 * DROPPED and the rest of the view still applies. A structurally broken or
 * unknown-version config yields `null` so the UI can skip that view instead of
 * throwing.
 *
 * NOT in v1, deliberately:
 *   - Folder selection (`?node=`). It is tree navigation state, not a filter:
 *     the id dangles as soon as the folder is deleted or moved, and it
 *     interacts with the `folders` grouping axis in ways the FilterBar does
 *     not model. The `folders` filter dimension already expresses "cases in
 *     these folders" as a real, registry-validated predicate.
 *   - Column layout (`?columns=`). Column visibility has a single owner (the
 *     DataTable's remembered per-user settings); a second copy inside a saved
 *     view would make the two fight over which one wins on load.
 * Both are additive later behind SAVED_REPOSITORY_VIEW_CONFIG_VERSION 2 —
 * v1 readers reject a v2 config outright rather than half-applying it.
 */

export const SAVED_REPOSITORY_VIEW_CONFIG_VERSION = 1;

/** The ShareLinkEntityType a saved repository view is stored under. */
export const SAVED_REPOSITORY_VIEW_ENTITY_TYPE = "REPOSITORY_VIEW" as const;

/** Search text is a `contains` term, not a document — bound what we persist. */
export const SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH = 256;

/** Bounds the persisted name/description, matching the save dialog inputs. */
export const SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH = 120;
export const SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH = 500;

/**
 * The static grouping axes ProjectRepository accepts in `?view=`. Dynamic
 * field axes use the `dynamic_<fieldId>_<fieldType>` form instead.
 */
export const REPOSITORY_VIEW_STATIC_AXES = [
  "folders",
  "templates",
  "states",
  "creators",
  "automated",
  "parameterized",
  "attachments",
  // Review-workflow-only axis. Kept in the structural whitelist so a saved
  // view survives the flags still resolving; ProjectRepository degrades it to
  // the default axis once the review workflow is known to be off.
  "inReview",
  "status",
  "assignedTo",
  "tags",
  "issues",
] as const;

export type RepositoryViewStaticAxis =
  (typeof REPOSITORY_VIEW_STATIC_AXES)[number];

const DYNAMIC_VIEW_AXIS_PATTERN = /^dynamic_(\d+)_.+$/;

/** The CaseField id behind a `dynamic_<fieldId>_<fieldType>` axis, else null. */
export function dynamicViewAxisFieldId(axis: string): number | null {
  const match = DYNAMIC_VIEW_AXIS_PATTERN.exec(axis);
  if (!match) return null;
  const fieldId = Number(match[1]);
  return Number.isSafeInteger(fieldId) ? fieldId : null;
}

/** Structural check only — see {@link SanitizeAxisOptions} for existence. */
export function isRepositoryViewAxis(axis: string): boolean {
  return (
    (REPOSITORY_VIEW_STATIC_AXES as readonly string[]).includes(axis) ||
    dynamicViewAxisFieldId(axis) !== null
  );
}

interface SanitizeAxisOptions {
  /**
   * When supplied, a `dynamic_<fieldId>_...` axis whose field is not in the
   * set degrades to `null` (the caller falls back to its default axis) —
   * the axis-level twin of dropping a predicate on a deleted field.
   * Omitted means "structure only": the caller has no view-options list yet
   * and would rather keep the axis than lose it to a race.
   */
  knownDynamicAxisFieldIds?: ReadonlySet<number>;
}

function sanitizeAxis(
  axis: string | undefined,
  options: SanitizeAxisOptions
): string | null {
  if (!axis) return null;
  if ((REPOSITORY_VIEW_STATIC_AXES as readonly string[]).includes(axis)) {
    return axis;
  }
  const fieldId = dynamicViewAxisFieldId(axis);
  if (fieldId === null) return null;
  if (
    options.knownDynamicAxisFieldIds &&
    !options.knownDynamicAxisFieldIds.has(fieldId)
  ) {
    return null;
  }
  return axis;
}

/**
 * Envelope shape. Predicates stay `unknown[]` here on purpose: registry
 * validation happens after the envelope parses, so one bad predicate can be
 * dropped without failing the whole view. `.catch` on each optional member
 * keeps a partially-corrupt config loadable.
 */
const savedRepositoryViewConfigSchema = z.object({
  version: z.number().int(),
  projectId: z.number().int().positive(),
  predicates: z
    .array(z.unknown())
    .catch([])
    .transform((items) => items as unknown[]),
  axis: z.string().optional().catch(undefined),
  search: z.string().optional().catch(undefined),
});

export type SavedRepositoryViewConfig = z.infer<
  typeof savedRepositoryViewConfigSchema
>;

/** The applyable slice of repository state a saved view captures. */
export interface SavedRepositoryViewCriteria {
  projectId: number;
  predicates: FilterPredicate[];
  /** `?view=` grouping axis; null means "use the surface's default". */
  axis: string | null;
  search: string;
}

export type SavedRepositoryViewParseStatus =
  | "ok"
  /** Stored by a newer app version — readable shape, unreadable semantics. */
  | "version-mismatch"
  /** Malformed, or belongs to a different project than the caller asked for. */
  | "invalid";

export interface SavedRepositoryViewParseResult {
  status: SavedRepositoryViewParseStatus;
  criteria: SavedRepositoryViewCriteria | null;
  /**
   * Persisted predicates that did not survive the registry parse — deleted
   * custom fields, retired operators, over-cap entries. Lets the UI say "3
   * filters from this view no longer apply" instead of silently narrowing.
   */
  droppedPredicateCount: number;
  /** What the hard caps would trim off this config (see the URL read path). */
  truncation: FilterCapTruncation;
  /** True when a persisted axis was dropped (unknown or deleted field). */
  axisDropped: boolean;
}

export interface ParseSavedRepositoryViewOptions extends SanitizeAxisOptions {
  /** The active mode's registry — the same validator the URL path uses. */
  registry: FilterDimensionRegistry;
  /**
   * Reject a config whose stored projectId is not this one, so a view can
   * never be applied to the wrong repository.
   */
  expectedProjectId?: number;
}

const INVALID_RESULT: SavedRepositoryViewParseResult = {
  status: "invalid",
  criteria: null,
  droppedPredicateCount: 0,
  truncation: EMPTY_FILTER_CAP_TRUNCATION,
  axisDropped: false,
};

/**
 * Validate a persisted `entityConfig` and revive it into applyable criteria,
 * reporting what degraded on the way in.
 */
export function parseSavedRepositoryViewConfigWithReport(
  raw: unknown,
  options: ParseSavedRepositoryViewOptions
): SavedRepositoryViewParseResult {
  const result = savedRepositoryViewConfigSchema.safeParse(raw);
  if (!result.success) return INVALID_RESULT;

  const { version, projectId, predicates, axis, search } = result.data;
  if (version !== SAVED_REPOSITORY_VIEW_CONFIG_VERSION) {
    return { ...INVALID_RESULT, status: "version-mismatch" };
  }
  if (
    options.expectedProjectId !== undefined &&
    projectId !== options.expectedProjectId
  ) {
    return INVALID_RESULT;
  }

  const parsedPredicates = parseFilterPredicates(predicates, options.registry);
  const sanitizedAxis = sanitizeAxis(axis, options);

  return {
    status: "ok",
    criteria: {
      projectId,
      predicates: parsedPredicates,
      axis: sanitizedAxis,
      search: (search ?? "").slice(0, SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH),
    },
    droppedPredicateCount: Math.max(
      0,
      predicates.length - parsedPredicates.length
    ),
    truncation: reportFilterCapTruncation(predicates),
    axisDropped: axis !== undefined && sanitizedAxis === null,
  };
}

/**
 * Convenience wrapper for callers that only need the applyable criteria.
 * Returns `null` for malformed, wrong-project or unrecognized-version configs.
 */
export function parseSavedRepositoryViewConfig(
  raw: unknown,
  options: ParseSavedRepositoryViewOptions
): SavedRepositoryViewCriteria | null {
  return parseSavedRepositoryViewConfigWithReport(raw, options).criteria;
}

/**
 * Build the `entityConfig` payload from live repository state. Predicates go
 * through the write-path clamp so what is stored is exactly what a re-read
 * keeps, and the JSON round-trip yields a Prisma-safe value (no `undefined`
 * keys, no class instances).
 */
export function buildSavedRepositoryViewConfig(
  criteria: SavedRepositoryViewCriteria
): JsonValue {
  const { predicates } = clampFilterPredicates(criteria.predicates);
  const axis =
    criteria.axis && isRepositoryViewAxis(criteria.axis) ? criteria.axis : null;

  const config = {
    version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
    projectId: criteria.projectId,
    predicates,
    axis,
    search: criteria.search
      .trim()
      .slice(0, SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH),
  };
  return JSON.parse(JSON.stringify(config)) as JsonValue;
}

/** True when there is anything worth saving (a filter, an axis, a search). */
export function hasSavableRepositoryViewState(
  criteria: Omit<SavedRepositoryViewCriteria, "projectId">
): boolean {
  return (
    criteria.predicates.length > 0 ||
    criteria.search.trim().length > 0 ||
    criteria.axis !== null
  );
}
