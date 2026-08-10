/**
 * Dimension registry for repository multi-dimension filtering.
 *
 * Single source of truth for which filter dimensions exist, which operators
 * each accepts, and how their values coerce. Consumed by the predicate Zod
 * schema (lib/schemas/repositoryFilterPredicates.ts), the URL codec
 * (lib/repository/filterUrlCodec.ts), the FilterBar, the where-compiler, and
 * the view-options counts route.
 *
 * Deliberately UI-free: no labelKey/icon here. Presentation metadata lives in
 * the FilterBar layer so this module stays importable from server routes.
 */

export type FilterDimensionScope = "repo" | "run";

/**
 * Drives per-value coercion in the predicate schema:
 *   - idList:   integer ids; per-dimension string sentinels allowed
 *   - userList: user-id strings; per-dimension string sentinels allowed
 *   - boolean:  exactly 0 | 1 (strings "0" | "1" coerce)
 *   - options:  dynamic-field option ids (integers)
 *   - number:   finite numbers (Integer / Number fields)
 *   - date:     ISO-8601 date strings, kept as strings on the wire
 *   - text:     free text (capped at FILTER_VALUE_MAX_LENGTH)
 *   - link:     free text (URL fragments / domains)
 *   - steps:    step counts (numbers)
 */
export type FilterValueType =
  | "idList"
  | "userList"
  | "boolean"
  | "options"
  | "number"
  | "date"
  | "text"
  | "link"
  | "steps";

export interface FilterDimension {
  /** Registry key; must match FILTER_DIMENSION_KEY_PATTERN (letter-first). */
  key: string;
  scope: FilterDimensionScope;
  valueType: FilterValueType;
  operators: readonly string[];
  /**
   * String values accepted alongside the coerced value type (e.g. "untested"
   * for status ids, "unassigned" for assignedTo user ids).
   */
  sentinels?: readonly string[];
  /** Dynamic-field dimensions only: the source CaseField id. */
  fieldId?: number;
  /** Dynamic-field dimensions only: the raw field type (e.g. "Text Long"). */
  fieldType?: string;
}

export type FilterDimensionRegistry = ReadonlyMap<string, FilterDimension>;

/**
 * Letter-first keys keep the URL grammar unambiguous: a future OR grammar
 * prefixes an all-digits groupId token, which can never collide with a
 * dimension key.
 */
export const FILTER_DIMENSION_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export const DYNAMIC_FIELD_DIMENSION_PREFIX = "field_";

/** Free-text values longer than this drop the whole predicate at parse. */
export const FILTER_VALUE_MAX_LENGTH = 256;

export const STATUS_UNTESTED_SENTINEL = "untested";
export const ASSIGNED_TO_UNASSIGNED_SENTINEL = "unassigned";

/**
 * "Has a PENDING ReviewRequest" — the list-wide twin of the per-row pending
 * review badge. Not in REPO_STATIC_DIMENSIONS: it only exists while the
 * project runs the review workflow (system flag AND
 * Projects.reviewWorkflowEnabled), so it is opt-in per
 * `buildFilterDimensions({ includeInReview })`. Everywhere else it is absent
 * from the registry, which drops any `inReview` predicate at parse.
 */
export const IN_REVIEW_DIMENSION = "inReview";

/** Valueless relative-date operators (Date fields). */
export const RELATIVE_DATE_OPERATORS = [
  "last7",
  "last30",
  "last90",
  "thisYear",
] as const;

export const BETWEEN_OPERATOR = "between";

export interface OperatorArity {
  min: number;
  /** null = unbounded. */
  max: number | null;
}

const EXACTLY_ONE: OperatorArity = { min: 1, max: 1 };
const ZERO: OperatorArity = { min: 0, max: 0 };

/**
 * Value-count contract per operator, shared by every dimension that lists the
 * operator. `between` values are additionally normalized ASCENDING at parse
 * time (repositoryFilterPredicates.ts), which makes value-sorted cache keys
 * safe by construction.
 */
export const OPERATOR_ARITY: Readonly<Record<string, OperatorArity>> = {
  in: { min: 1, max: null },
  any: { min: 0, max: null },
  all: { min: 1, max: null },
  none: { min: 0, max: null },
  is: EXACTLY_ONE,
  eq: EXACTLY_ONE,
  ne: EXACTLY_ONE,
  lt: EXACTLY_ONE,
  lte: EXACTLY_ONE,
  gt: EXACTLY_ONE,
  gte: EXACTLY_ONE,
  [BETWEEN_OPERATOR]: { min: 2, max: 2 },
  on: EXACTLY_ONE,
  before: EXACTLY_ONE,
  after: EXACTLY_ONE,
  last7: ZERO,
  last30: ZERO,
  last90: ZERO,
  thisYear: ZERO,
  contains: EXACTLY_ONE,
  notContains: EXACTLY_ONE,
  startsWith: EXACTLY_ONE,
  endsWith: EXACTLY_ONE,
  domain: EXACTLY_ONE,
};

export function getOperatorArity(operator: string): OperatorArity | undefined {
  return OPERATOR_ARITY[operator];
}

const OPTION_OPERATORS = ["in", "any", "none"] as const;
const BOOLEAN_OPERATORS = ["is"] as const;
const NUMBER_OPERATORS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  BETWEEN_OPERATOR,
  "any",
  "none",
] as const;
const DATE_OPERATORS = [
  "on",
  "before",
  "after",
  BETWEEN_OPERATOR,
  ...RELATIVE_DATE_OPERATORS,
  "any",
  "none",
] as const;
const TEXT_OPERATORS = [
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "eq",
  "any",
  "none",
] as const;
const LINK_OPERATORS = [
  "contains",
  "domain",
  "startsWith",
  "endsWith",
  "eq",
  "any",
  "none",
] as const;
const STEPS_OPERATORS = [
  "eq",
  "lt",
  "lte",
  "gt",
  "gte",
  BETWEEN_OPERATOR,
  "any",
  "none",
] as const;

export const REPO_STATIC_DIMENSIONS: readonly FilterDimension[] = [
  { key: "templates", scope: "repo", valueType: "idList", operators: ["in"] },
  { key: "states", scope: "repo", valueType: "idList", operators: ["in"] },
  { key: "creators", scope: "repo", valueType: "userList", operators: ["in"] },
  {
    key: "automated",
    scope: "repo",
    valueType: "boolean",
    operators: BOOLEAN_OPERATORS,
  },
  {
    key: "parameterized",
    scope: "repo",
    valueType: "boolean",
    operators: BOOLEAN_OPERATORS,
  },
  {
    key: "attachments",
    scope: "repo",
    valueType: "boolean",
    operators: BOOLEAN_OPERATORS,
  },
  {
    key: "tags",
    scope: "repo",
    valueType: "idList",
    operators: ["any", "all", "none"],
  },
  {
    key: "issues",
    scope: "repo",
    valueType: "idList",
    operators: ["any", "all", "none"],
  },
];

/**
 * Review-workflow-only repo dimension. ReviewRequest is polymorphic (no FK
 * back-relation to RepositoryCases), so this one is not SQL-expressible from
 * the case row alone — the compiler resolves it through an injected id set.
 */
export const IN_REVIEW_DIMENSION_DEF: FilterDimension = {
  key: IN_REVIEW_DIMENSION,
  scope: "repo",
  valueType: "boolean",
  operators: BOOLEAN_OPERATORS,
};

export const RUN_DIMENSIONS: readonly FilterDimension[] = [
  {
    key: "status",
    scope: "run",
    valueType: "idList",
    operators: ["in"],
    sentinels: [STATUS_UNTESTED_SENTINEL],
  },
  {
    key: "assignedTo",
    scope: "run",
    valueType: "userList",
    operators: ["in"],
    sentinels: [ASSIGNED_TO_UNASSIGNED_SENTINEL],
  },
];

/** The subset of a view-options dynamicFields entry the registry needs. */
export interface DynamicFieldDescriptor {
  fieldId: number;
  type: string;
}

const DYNAMIC_FIELD_TYPE_CONFIG: Readonly<
  Record<string, { valueType: FilterValueType; operators: readonly string[] }>
> = {
  Dropdown: { valueType: "options", operators: OPTION_OPERATORS },
  "Multi-Select": { valueType: "options", operators: OPTION_OPERATORS },
  Checkbox: { valueType: "boolean", operators: BOOLEAN_OPERATORS },
  Integer: { valueType: "number", operators: NUMBER_OPERATORS },
  Number: { valueType: "number", operators: NUMBER_OPERATORS },
  Date: { valueType: "date", operators: DATE_OPERATORS },
  "Text Long": { valueType: "text", operators: TEXT_OPERATORS },
  "Text String": { valueType: "text", operators: TEXT_OPERATORS },
  Link: { valueType: "link", operators: LINK_OPERATORS },
  Steps: { valueType: "steps", operators: STEPS_OPERATORS },
};

export function dynamicFieldDimensionKey(fieldId: number): string {
  return `${DYNAMIC_FIELD_DIMENSION_PREFIX}${fieldId}`;
}

/**
 * Builds a `field_<fieldId>` dimension from a view-options dynamicFields
 * entry. Returns null for field types that are not filterable.
 */
export function buildDynamicFieldDimension(
  field: DynamicFieldDescriptor
): FilterDimension | null {
  const config = DYNAMIC_FIELD_TYPE_CONFIG[field.type];
  if (!config || !Number.isSafeInteger(field.fieldId)) return null;
  return {
    key: dynamicFieldDimensionKey(field.fieldId),
    scope: "repo",
    valueType: config.valueType,
    operators: config.operators,
    fieldId: field.fieldId,
    fieldType: field.type,
  };
}

export interface BuildFilterDimensionsOptions {
  /**
   * viewOptions.dynamicFields-shaped input: either the Record keyed by
   * displayName that the view-options route returns, or a plain array.
   */
  dynamicFields?:
    | Readonly<Record<string, DynamicFieldDescriptor>>
    | readonly DynamicFieldDescriptor[];
  /**
   * Include the run-only dimensions (status, assignedTo). False for
   * repository view mode and selection mode — run-dim predicates found in
   * the URL are then dropped at parse.
   */
  includeRunDimensions?: boolean;
  /**
   * Include the `inReview` dimension. True only when the review workflow is
   * live for the project (system flag AND Projects.reviewWorkflowEnabled) —
   * elsewhere the dimension must not exist at all, so a shared link carrying
   * an `inReview` predicate degrades to "no such filter" rather than
   * silently filtering by a feature the project does not run.
   */
  includeInReview?: boolean;
}

export function buildFilterDimensions(
  options: BuildFilterDimensionsOptions = {}
): FilterDimensionRegistry {
  const {
    dynamicFields,
    includeRunDimensions = false,
    includeInReview = false,
  } = options;
  const registry = new Map<string, FilterDimension>();

  for (const dimension of REPO_STATIC_DIMENSIONS) {
    registry.set(dimension.key, dimension);
  }
  if (includeInReview) {
    registry.set(IN_REVIEW_DIMENSION_DEF.key, IN_REVIEW_DIMENSION_DEF);
  }
  if (includeRunDimensions) {
    for (const dimension of RUN_DIMENSIONS) {
      registry.set(dimension.key, dimension);
    }
  }
  if (dynamicFields) {
    const fields: readonly DynamicFieldDescriptor[] = Array.isArray(
      dynamicFields
    )
      ? dynamicFields
      : Object.values(dynamicFields);
    for (const field of fields) {
      const dimension = buildDynamicFieldDimension(field);
      if (dimension && !registry.has(dimension.key)) {
        registry.set(dimension.key, dimension);
      }
    }
  }
  return registry;
}
