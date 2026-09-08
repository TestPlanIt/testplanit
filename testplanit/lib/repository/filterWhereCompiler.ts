/**
 * Predicate → Prisma-where compiler for repository multi-dimension filtering.
 *
 * Pure module: FilterPredicate[] + the active mode's dimension registry in,
 * self-contained where fragments out — one fragment per predicate, combined by
 * the caller with an explicit AND array. Folder scoping is deliberately NOT
 * handled here: the folder wall / descendant expansion stays a caller-owned
 * base condition (spec §7.1), so the compiler works identically for the table
 * query, the counts route, and export.
 *
 * The dynamic-field fragments are ported byte-identical from the legacy
 * where-builder in app/[locale]/projects/repository/[projectId]/Cases.tsx
 * (which built them inside untyped arrays). Several legacy JSON-value shapes
 * (`{ value: { lt: … } }` ranges, `{ value: { equals: null } }`) are not
 * representable in the generated JsonFilter input type, so dynamic fragments
 * are built as raw objects and cast at one boundary (`asWhere`) — the shapes
 * are exactly what ships to the DB today and must not be "fixed" here.
 */

import { JsonNull } from "@zenstackhq/orm";

import type {
  RepositoryCasesWhereInput,
  TestRunCasesWhereInput,
} from "~/zenstack/input";
import { attachmentsWhereClause } from "~/lib/repositoryCaseAttachmentsFilter";
import type { PostFetchFilter } from "~/lib/repositoryCaseFieldMatchers";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  ASSIGNED_TO_UNASSIGNED_SENTINEL,
  IN_REVIEW_DIMENSION,
  STATUS_UNTESTED_SENTINEL,
  type FilterDimension,
  type FilterDimensionRegistry,
} from "./filterDimensions";

/** Raw fragment shape for the legacy-ported JSON-value conditions. */
type RawFragment = Record<string, unknown>;

/**
 * Single cast boundary for the legacy JSON-value shapes the generated
 * JsonFilter type cannot express.
 */
function asWhere(fragment: RawFragment): RepositoryCasesWhereInput {
  return fragment as RepositoryCasesWhereInput;
}

/** Text/link/steps operators resolved post-fetch via the shared matchers. */
const TEXT_POST_FETCH_OPERATORS: ReadonlySet<string> = new Set([
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "eq",
]);
const LINK_POST_FETCH_OPERATORS: ReadonlySet<string> = new Set([
  "contains",
  "domain",
  "startsWith",
  "endsWith",
  "eq",
]);
const STEPS_POST_FETCH_OPERATORS: ReadonlySet<string> = new Set([
  "eq",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
]);

/** The matchers (lib/repositoryCaseFieldMatchers.ts) speak "equals", not "eq". */
function toMatcherOperator(operator: string): string {
  return operator === "eq" ? "equals" : operator;
}

function numericValues(values: readonly (string | number)[]): number[] {
  return values.map(Number).filter((value) => Number.isFinite(value));
}

function stringValues(values: readonly (string | number)[]): string[] {
  return values.map(String);
}

function booleanFromIsValue(
  values: readonly (string | number)[]
): boolean | null {
  if (values[0] === 1) return true;
  if (values[0] === 0) return false;
  return null;
}

// --- Legacy dynamic-field value-condition builders (Cases.tsx parity) -------

/** Dropdown values are matched as string OR native (`"7"` or `7`). */
function dropdownEqualsCondition(
  fieldId: number,
  value: string | number
): RawFragment {
  return {
    caseFieldValues: {
      some: {
        fieldId,
        OR: [
          { value: { equals: String(value) } },
          { value: { equals: value } },
        ],
      },
    },
  };
}

function multiSelectContainsCondition(
  fieldId: number,
  value: string | number
): RawFragment {
  return {
    caseFieldValues: {
      some: { fieldId, value: { array_contains: [value] } },
    },
  };
}

/** "Has any value (not null)" — dropdown/multi-select/number `any`. */
function hasValueNotNullFragment(fieldId: number): RawFragment {
  return {
    caseFieldValues: { some: { fieldId, value: { not: JsonNull } } },
  };
}

/** "No value": record missing OR value explicitly JSON-null. */
function noValueFragment(fieldId: number): RawFragment {
  return {
    OR: [
      { caseFieldValues: { none: { fieldId } } },
      {
        caseFieldValues: {
          some: { fieldId, value: { equals: JsonNull } },
        },
      },
    ],
  };
}

/** Text/link "has a value": not JSON-null AND not empty string. */
function textHasValueFragment(fieldId: number): RawFragment {
  return {
    caseFieldValues: {
      some: {
        fieldId,
        AND: [{ value: { not: JsonNull } }, { value: { not: { equals: "" } } }],
      },
    },
  };
}

/** Text/link "no value": record missing OR JSON-null OR empty string. */
function textNoValueFragment(fieldId: number): RawFragment {
  return {
    OR: [
      { caseFieldValues: { none: { fieldId } } },
      {
        caseFieldValues: {
          some: {
            fieldId,
            OR: [{ value: { equals: JsonNull } }, { value: { equals: "" } }],
          },
        },
      },
    ],
  };
}

/** Date "has a value" carries the legacy four-guard AND. */
function dateHasValueFragment(fieldId: number): RawFragment {
  return {
    caseFieldValues: {
      some: {
        fieldId,
        AND: [
          { value: { not: JsonNull } },
          { NOT: { value: { equals: JsonNull } } },
          { NOT: { value: { equals: "" } } },
          { NOT: { value: { equals: null } } },
        ],
      },
    },
  };
}

/**
 * Number comparisons match dually as native number OR its string form,
 * because JSON values were historically stored either way.
 */
function numberDualFragment(
  fieldId: number,
  operator: "equals" | "lt" | "lte" | "gt" | "gte",
  value: number
): RawFragment {
  return {
    caseFieldValues: {
      some: {
        fieldId,
        OR: [
          { value: { [operator]: value } },
          { value: { [operator]: String(value) } },
        ],
      },
    },
  };
}

function numberNotEqualsFragment(fieldId: number, value: number): RawFragment {
  return {
    OR: [
      { caseFieldValues: { none: { fieldId } } },
      {
        caseFieldValues: {
          some: { fieldId, value: { equals: JsonNull } },
        },
      },
      {
        caseFieldValues: {
          some: {
            fieldId,
            AND: [
              { value: { not: { equals: value } } },
              { value: { not: { equals: String(value) } } },
            ],
          },
        },
      },
    ],
  };
}

function numberBetweenFragment(
  fieldId: number,
  low: number,
  high: number
): RawFragment {
  return {
    caseFieldValues: {
      some: {
        fieldId,
        OR: [
          { AND: [{ value: { gte: low } }, { value: { lte: high } }] },
          {
            AND: [
              { value: { gte: String(low) } },
              { value: { lte: String(high) } },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Date comparisons match dually as date-only string OR full ISO, mirroring
 * the two storage forms.
 */
function dateDualFragment(
  fieldId: number,
  operator: "equals" | "lt" | "gt" | "gte",
  date: Date
): RawFragment {
  const dateStr = date.toISOString().split("T")[0];
  return {
    caseFieldValues: {
      some: {
        fieldId,
        OR: [
          { value: { [operator]: dateStr } },
          { value: { [operator]: date.toISOString() } },
        ],
      },
    },
  };
}

function dateBetweenFragment(
  fieldId: number,
  from: Date,
  to: Date
): RawFragment {
  const fromStr = from.toISOString().split("T")[0];
  const toStr = to.toISOString().split("T")[0];
  return {
    caseFieldValues: {
      some: {
        fieldId,
        OR: [
          { AND: [{ value: { gte: fromStr } }, { value: { lte: toStr } }] },
          {
            AND: [
              { value: { gte: from.toISOString() } },
              { value: { lte: to.toISOString() } },
            ],
          },
        ],
      },
    },
  };
}

function parseDateValue(value: string | number | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

const RELATIVE_DATE_DAYS: Readonly<Record<string, number>> = {
  last7: 7,
  last30: 30,
  last90: 90,
};

// --- Per-type dynamic-field compilation -------------------------------------

function compileOptionsFragment(
  fieldId: number,
  fieldType: string,
  predicate: FilterPredicate
): RepositoryCasesWhereInput | null {
  const buildEquals =
    fieldType === "Multi-Select"
      ? multiSelectContainsCondition
      : dropdownEqualsCondition;
  switch (predicate.operator) {
    case "in":
    case "any": {
      if (predicate.values.length === 0) {
        // Bare `any` = has a value.
        return predicate.operator === "any"
          ? asWhere(hasValueNotNullFragment(fieldId))
          : null;
      }
      return asWhere({
        OR: predicate.values.map((value) => buildEquals(fieldId, value)),
      });
    }
    case "none": {
      if (predicate.values.length === 0) {
        return asWhere(noValueFragment(fieldId));
      }
      // None-of listed options = inverse of the any-of shape. Cases without a
      // value match, consistent with tags/issues `none:[ids]`.
      return asWhere({
        NOT: {
          OR: predicate.values.map((value) => buildEquals(fieldId, value)),
        },
      });
    }
    default:
      return null;
  }
}

function compileNumberFragment(
  fieldId: number,
  predicate: FilterPredicate
): RepositoryCasesWhereInput | null {
  const { operator, values } = predicate;
  if (operator === "any") return asWhere(hasValueNotNullFragment(fieldId));
  if (operator === "none") return asWhere(noValueFragment(fieldId));

  const value1 = Number(values[0]);
  if (!Number.isFinite(value1)) return null;
  switch (operator) {
    case "eq":
      return asWhere(numberDualFragment(fieldId, "equals", value1));
    case "ne":
      return asWhere(numberNotEqualsFragment(fieldId, value1));
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return asWhere(numberDualFragment(fieldId, operator, value1));
    case "between": {
      const value2 = Number(values[1]);
      if (!Number.isFinite(value2)) return null;
      return asWhere(numberBetweenFragment(fieldId, value1, value2));
    }
    default:
      return null;
  }
}

function compileDateFragment(
  fieldId: number,
  predicate: FilterPredicate,
  now: Date
): RepositoryCasesWhereInput | null {
  const { operator, values } = predicate;
  if (operator === "any") return asWhere(dateHasValueFragment(fieldId));
  if (operator === "none") return asWhere(noValueFragment(fieldId));

  const relativeDays = RELATIVE_DATE_DAYS[operator];
  if (relativeDays !== undefined) {
    const since = new Date(now.getTime() - relativeDays * 24 * 60 * 60 * 1000);
    return asWhere(dateDualFragment(fieldId, "gte", since));
  }
  if (operator === "thisYear") {
    // Legacy quirk kept: local-timezone start of year.
    return asWhere(
      dateDualFragment(fieldId, "gte", new Date(now.getFullYear(), 0, 1))
    );
  }

  const date1 = parseDateValue(values[0]);
  if (!date1) return null;
  switch (operator) {
    case "on":
      return asWhere(dateDualFragment(fieldId, "equals", date1));
    case "before":
      return asWhere(dateDualFragment(fieldId, "lt", date1));
    case "after":
      return asWhere(dateDualFragment(fieldId, "gt", date1));
    case "between": {
      const date2 = parseDateValue(values[1]);
      if (!date2) return null;
      return asWhere(dateBetweenFragment(fieldId, date1, date2));
    }
    default:
      return null;
  }
}

function compileTextOrLinkFragment(
  fieldId: number,
  predicate: FilterPredicate,
  postFetchOperators: ReadonlySet<string>
): RepositoryCasesWhereInput | null {
  const { operator, values } = predicate;
  if (operator === "any") return asWhere(textHasValueFragment(fieldId));
  if (operator === "none") return asWhere(textNoValueFragment(fieldId));
  if (!postFetchOperators.has(operator)) return null;
  // Empty search value = no filter (legacy `if (searchValue)` gate).
  if (String(values[0] ?? "") === "") return null;
  // SQL pre-filter only — the operator itself resolves post-fetch through
  // extractPostFetchFilters + the shared matchers.
  return asWhere(hasValueNotNullFragment(fieldId));
}

function compileStepsFragment(
  predicate: FilterPredicate
): RepositoryCasesWhereInput | null {
  // Live-steps existence is SQL-expressible; the count comparisons have no
  // SQL pre-filter today (they resolve entirely post-fetch), so they compile
  // to no fragment — legacy parity.
  if (predicate.operator === "any") {
    return { steps: { some: { isDeleted: false } } };
  }
  if (predicate.operator === "none") {
    return { steps: { none: { isDeleted: false } } };
  }
  return null;
}

function compileDynamicFieldFragment(
  dimension: FilterDimension,
  predicate: FilterPredicate,
  now: Date
): RepositoryCasesWhereInput | null {
  const fieldId = dimension.fieldId;
  if (fieldId === undefined) return null;
  switch (dimension.fieldType) {
    case "Dropdown":
    case "Multi-Select":
      return compileOptionsFragment(fieldId, dimension.fieldType, predicate);
    case "Checkbox": {
      const checked = booleanFromIsValue(predicate.values);
      if (checked === null) return null;
      return asWhere({
        caseFieldValues: {
          some: { fieldId, value: { equals: checked } },
        },
      });
    }
    case "Integer":
    case "Number":
      return compileNumberFragment(fieldId, predicate);
    case "Date":
      return compileDateFragment(fieldId, predicate, now);
    case "Text Long":
    case "Text String":
      return compileTextOrLinkFragment(
        fieldId,
        predicate,
        TEXT_POST_FETCH_OPERATORS
      );
    case "Link":
      return compileTextOrLinkFragment(
        fieldId,
        predicate,
        LINK_POST_FETCH_OPERATORS
      );
    case "Steps":
      return compileStepsFragment(predicate);
    default:
      return null;
  }
}

// --- Tags / issues ----------------------------------------------------------

// The spec's §7 shapes plus the soft-delete guard today's where-builder
// applies (`tag/issue: { isDeleted: false }`) — both Tags and Issue soft-
// delete, and dropping the guard would resurrect deleted links in filters.
function compileTagsFragment(
  predicate: FilterPredicate
): RepositoryCasesWhereInput | null {
  const ids = numericValues(predicate.values);
  switch (predicate.operator) {
    case "any":
      return ids.length === 0
        ? { caseTags: { some: { tag: { isDeleted: false } } } }
        : {
            caseTags: {
              some: { tagId: { in: ids }, tag: { isDeleted: false } },
            },
          };
    case "all":
      if (ids.length === 0) return null;
      return {
        AND: ids.map((id) => ({
          caseTags: { some: { tagId: id, tag: { isDeleted: false } } },
        })),
      };
    case "none":
      return ids.length === 0
        ? { caseTags: { none: { tag: { isDeleted: false } } } }
        : {
            caseTags: {
              none: { tagId: { in: ids }, tag: { isDeleted: false } },
            },
          };
    default:
      return null;
  }
}

function compileIssuesFragment(
  predicate: FilterPredicate
): RepositoryCasesWhereInput | null {
  const ids = numericValues(predicate.values);
  switch (predicate.operator) {
    case "any":
      return ids.length === 0
        ? { caseIssues: { some: { issue: { isDeleted: false } } } }
        : {
            caseIssues: {
              some: { issueId: { in: ids }, issue: { isDeleted: false } },
            },
          };
    case "all":
      if (ids.length === 0) return null;
      return {
        AND: ids.map((id) => ({
          caseIssues: { some: { issueId: id, issue: { isDeleted: false } } },
        })),
      };
    case "none":
      return ids.length === 0
        ? { caseIssues: { none: { issue: { isDeleted: false } } } }
        : {
            caseIssues: {
              none: { issueId: { in: ids }, issue: { isDeleted: false } },
            },
          };
    default:
      return null;
  }
}

// --- Public API -------------------------------------------------------------

export interface CompileRepoPredicatesOptions {
  /**
   * Reference time for relative date operators (last7/last30/last90/thisYear).
   * Defaults to `new Date()`; inject for deterministic tests and so the
   * counts route can evaluate every dimension against one timestamp.
   */
  now?: Date;
  /**
   * Case ids carrying a PENDING ReviewRequest, for the `inReview` dimension.
   * ReviewRequest references its entity polymorphically (no FK back-relation),
   * so there is no relation to traverse from a RepositoryCases where — the
   * caller resolves the set and it compiles to an id fragment.
   *
   * Omitted (or undefined) is treated as the EMPTY set, not as "no filter":
   * an unresolved set must never widen `inReview:is:1` into the whole
   * repository. Callers that can tell "still loading" from "genuinely none"
   * should hold their query off instead of rendering the empty-set answer.
   */
  inReviewCaseIds?: readonly number[];
}

/**
 * Compiles repo-scoped predicates to self-contained RepositoryCases where
 * fragments — one per predicate, in predicate order. The caller combines them
 * with an explicit AND array: `{ AND: [...baseConditions, ...fragments] }`.
 *
 * Skipped (never thrown): predicates whose dimension is unknown to the
 * registry, run-scoped predicates, operators outside the dimension's
 * whitelist, and malformed values. Text/link operator predicates compile to
 * their value-not-null SQL pre-filter only — pair with
 * extractPostFetchFilters for the in-memory half; steps count comparisons
 * have no SQL half at all (legacy parity).
 *
 * Folder scoping is intentionally absent — it stays a caller-owned base
 * condition (spec §7.1).
 */
export function compileRepoPredicates(
  predicates: readonly FilterPredicate[],
  registry: FilterDimensionRegistry,
  options?: CompileRepoPredicatesOptions
): RepositoryCasesWhereInput[] {
  const now = options?.now ?? new Date();
  const inReviewCaseIds = options?.inReviewCaseIds ?? [];
  const fragments: RepositoryCasesWhereInput[] = [];

  for (const predicate of predicates) {
    const dimension = registry.get(predicate.dimension);
    if (!dimension || dimension.scope !== "repo") continue;
    if (!dimension.operators.includes(predicate.operator)) continue;

    let fragment: RepositoryCasesWhereInput | null = null;
    switch (dimension.key) {
      case "templates":
        fragment = { templateId: { in: numericValues(predicate.values) } };
        break;
      case "states":
        fragment = { stateId: { in: numericValues(predicate.values) } };
        break;
      case "creators":
        fragment = { creatorId: { in: stringValues(predicate.values) } };
        break;
      case "automated": {
        const value = booleanFromIsValue(predicate.values);
        fragment = value === null ? null : { automated: value };
        break;
      }
      case "parameterized": {
        const value = booleanFromIsValue(predicate.values);
        fragment = value === null ? null : { hasParameters: value };
        break;
      }
      case "attachments": {
        const value = booleanFromIsValue(predicate.values);
        fragment = value === null ? null : attachmentsWhereClause(value);
        break;
      }
      case IN_REVIEW_DIMENSION: {
        const value = booleanFromIsValue(predicate.values);
        const ids = [...inReviewCaseIds];
        fragment =
          value === null
            ? null
            : value
              ? { id: { in: ids } }
              : { NOT: { id: { in: ids } } };
        break;
      }
      case "tags":
        fragment = compileTagsFragment(predicate);
        break;
      case "issues":
        fragment = compileIssuesFragment(predicate);
        break;
      default:
        fragment = compileDynamicFieldFragment(dimension, predicate, now);
        break;
    }
    if (fragment) fragments.push(fragment);
  }

  return fragments;
}

/**
 * Compiles run-scoped predicates (status / assignedTo) to self-contained
 * TestRunCases where fragments, one per predicate.
 *
 * IMPORTANT: every fragment carries an `OR` key, so two fragments spread as
 * siblings would silently overwrite each other. The caller MUST place them in
 * an explicit AND array — `AND: compileRunPredicates(...)` — never spread
 * them into one object.
 *
 * Repo-scoped and unknown-dimension predicates are skipped, not thrown.
 */
export function compileRunPredicates(
  predicates: readonly FilterPredicate[],
  registry: FilterDimensionRegistry
): TestRunCasesWhereInput[] {
  const fragments: TestRunCasesWhereInput[] = [];

  for (const predicate of predicates) {
    const dimension = registry.get(predicate.dimension);
    if (!dimension || dimension.scope !== "run") continue;
    if (!dimension.operators.includes(predicate.operator)) continue;

    if (dimension.key === "status") {
      const ids = predicate.values.filter(
        (value): value is number => typeof value === "number"
      );
      const untested = predicate.values.includes(STATUS_UNTESTED_SENTINEL);
      const branches: TestRunCasesWhereInput[] = [
        ...(ids.length > 0 ? [{ statusId: { in: ids } }] : []),
        ...(untested ? [{ statusId: null }] : []),
      ];
      if (branches.length > 0) fragments.push({ OR: branches });
    } else if (dimension.key === "assignedTo") {
      const ids = stringValues(predicate.values).filter(
        (value) => value !== ASSIGNED_TO_UNASSIGNED_SENTINEL
      );
      const unassigned = predicate.values.includes(
        ASSIGNED_TO_UNASSIGNED_SENTINEL
      );
      const branches: TestRunCasesWhereInput[] = [
        ...(ids.length > 0 ? [{ assignedToId: { in: ids } }] : []),
        ...(unassigned ? [{ assignedToId: null }] : []),
      ];
      if (branches.length > 0) fragments.push({ OR: branches });
    }
  }

  return fragments;
}

/**
 * Maps text/link/steps operator predicates to the PostFetchFilter shape the
 * existing post-fetch pipeline consumes (matchesPostFetchFilters). `eq` is
 * translated to the matchers' "equals" vocabulary; steps operators pass
 * through unchanged. `any`/`none` are fully SQL-expressible and never appear
 * here. Their SQL pre-filter halves come from compileRepoPredicates — always
 * apply both.
 */
export function extractPostFetchFilters(
  predicates: readonly FilterPredicate[],
  registry: FilterDimensionRegistry
): PostFetchFilter[] {
  const filters: PostFetchFilter[] = [];

  for (const predicate of predicates) {
    const dimension = registry.get(predicate.dimension);
    if (!dimension || dimension.scope !== "repo") continue;
    if (dimension.fieldId === undefined) continue;
    if (!dimension.operators.includes(predicate.operator)) continue;

    if (dimension.valueType === "text" || dimension.valueType === "link") {
      const operatorSet =
        dimension.valueType === "text"
          ? TEXT_POST_FETCH_OPERATORS
          : LINK_POST_FETCH_OPERATORS;
      if (!operatorSet.has(predicate.operator)) continue;
      const value1 = String(predicate.values[0] ?? "");
      if (value1 === "") continue;
      filters.push({
        fieldId: dimension.fieldId,
        type: dimension.valueType,
        operator: toMatcherOperator(predicate.operator),
        value1,
      });
    } else if (dimension.valueType === "steps") {
      if (!STEPS_POST_FETCH_OPERATORS.has(predicate.operator)) continue;
      const value1 = Number(predicate.values[0]);
      if (!Number.isFinite(value1)) continue;
      const value2 =
        predicate.operator === "between"
          ? Number(predicate.values[1])
          : undefined;
      if (predicate.operator === "between" && !Number.isFinite(value2))
        continue;
      filters.push({
        fieldId: dimension.fieldId,
        type: "steps",
        operator: predicate.operator,
        value1,
        ...(value2 !== undefined ? { value2 } : {}),
      });
    }
  }

  return filters;
}
