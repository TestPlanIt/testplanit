/**
 * Filter-aware facet-count engine for the repository view-options route
 * (spec §8). The route's hard branch activates it when the request carries
 * `predicates` / `searchCaseIds`; legacy bodies keep the legacy code path.
 *
 * Counting model: every facet dimension D is counted under `whereExcept(D)` —
 * the scope plus every active predicate EXCEPT D's own (self-exclusion), so a
 * chipped dimension still shows what its other options would yield.
 * `searchCaseIds` is cross-cutting: it intersects the scope itself and is
 * never self-excluded. For dimensions without an active predicate
 * `whereExcept(D)` IS `whereAll` (same object), so only chipped dimensions
 * cost extra queries.
 *
 * `totalCount` is counted under ALL predicates, so it is NOT the base the
 * self-excluded option counts sit on. `dimensionTotals` reports that base per
 * dimension (`count(whereExcept(D))`) for the client's "All …"/"Mixed" rows.
 *
 * Predicates partition into:
 *   - WHERE-expressible: compiled to Prisma fragments via the shared
 *     where-compiler (one self-contained fragment per predicate);
 *   - id-set: text/link/steps operator predicates whose semantics live in the
 *     shared post-fetch matchers — resolved once to a case-id list and
 *     embedded as `{ id: { in: [...] } }` fragments;
 *   - run-scoped (status/assignedTo): evaluated row-wise over the single
 *     testRunCases fetch; they contribute case-level id-set fragments to the
 *     repo-side wheres and row filters to the run facets.
 */

import { DbNull } from "@zenstackhq/orm";

import { ReviewEntityType } from "~/zenstack/models";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";
import type { baseDb } from "~/lib/db";
import {
  attachmentsWhereClause,
  shapeAttachmentsFacet,
} from "~/lib/repositoryCaseAttachmentsFilter";
import {
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "~/lib/repositoryCaseFieldMatchers";
import {
  ASSIGNED_TO_UNASSIGNED_SENTINEL,
  IN_REVIEW_DIMENSION,
  STATUS_UNTESTED_SENTINEL,
  buildFilterDimensions,
  dynamicFieldDimensionKey,
  type FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import {
  compileRepoPredicates,
  extractPostFetchFilters,
} from "~/lib/repository/filterWhereCompiler";
import {
  parseFilterPredicates,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";

export type FacetCountsDb = typeof baseDb;

// --- Pure composition helpers (unit-tested without a database) --------------

export interface FacetScopeOptions {
  projectId: number;
  /** Run-mode membership (unique repositoryCase ids); null/absent outside run mode. */
  runCaseIds?: readonly number[] | null;
  /**
   * ES-search result ids. Present (even empty) = intersect; absent = no
   * search. Cross-cutting: lives in the scope, never self-excluded.
   */
  searchCaseIds?: readonly number[] | null;
}

/**
 * The base scope every facet query shares. Mirrors the legacy baseWhere core;
 * legacy quirk kept: an EMPTY run membership does not scope (`if length > 0`),
 * while present-but-empty searchCaseIds means zero matches.
 */
export function buildFacetScopeWhere(
  options: FacetScopeOptions
): RepositoryCasesWhereInput {
  const { projectId, runCaseIds, searchCaseIds } = options;
  const where: RepositoryCasesWhereInput = {
    isDeleted: false,
    isArchived: false,
    projectId,
    folder: { isDeleted: false },
  };
  const hasRunIds = runCaseIds != null && runCaseIds.length > 0;
  if (hasRunIds && searchCaseIds != null) {
    const runSet = new Set(runCaseIds);
    where.id = { in: searchCaseIds.filter((id) => runSet.has(id)) };
  } else if (hasRunIds) {
    where.id = { in: [...runCaseIds] };
  } else if (searchCaseIds != null) {
    where.id = { in: [...searchCaseIds] };
  }
  return where;
}

export interface DimensionWhereFragment {
  dimension: string;
  where: RepositoryCasesWhereInput;
}

export interface IdSetPredicateSpec {
  dimension: string;
  fieldId: number;
  filter: PostFetchFilter;
}

export interface FacetPredicatePartition {
  /** WHERE-expressible predicates, one compiled fragment each. */
  whereFragments: DimensionWhereFragment[];
  /** Text/link/steps operator predicates — resolve to id-sets via matchers. */
  idSetPredicates: IdSetPredicateSpec[];
  /** Run-scoped predicates (status/assignedTo) — evaluated row-wise. */
  runPredicates: FilterPredicate[];
}

/**
 * Splits parsed predicates into the three engine lanes. A predicate is id-set
 * iff extractPostFetchFilters maps it (text/link operators with a value,
 * steps count operators); its compiled SQL half (value-not-null pre-filter,
 * or nothing for steps) is deliberately NOT emitted — the resolved id-set
 * subsumes it.
 */
export function partitionFacetPredicates(
  predicates: readonly FilterPredicate[],
  registry: FilterDimensionRegistry,
  now: Date,
  /** Pending-review case ids for the `inReview` dimension (see the compiler). */
  inReviewCaseIds: readonly number[] = []
): FacetPredicatePartition {
  const whereFragments: DimensionWhereFragment[] = [];
  const idSetPredicates: IdSetPredicateSpec[] = [];
  const runPredicates: FilterPredicate[] = [];

  for (const predicate of predicates) {
    const dimension = registry.get(predicate.dimension);
    if (!dimension) continue;
    if (dimension.scope === "run") {
      runPredicates.push(predicate);
      continue;
    }
    const postFetch = extractPostFetchFilters([predicate], registry);
    if (postFetch.length > 0 && dimension.fieldId !== undefined) {
      idSetPredicates.push({
        dimension: dimension.key,
        fieldId: dimension.fieldId,
        filter: postFetch[0],
      });
      continue;
    }
    const fragment = compileRepoPredicates([predicate], registry, {
      now,
      inReviewCaseIds,
    })[0];
    if (fragment) {
      whereFragments.push({ dimension: dimension.key, where: fragment });
    }
  }

  return { whereFragments, idSetPredicates, runPredicates };
}

/** Resolved id-set predicates re-enter the composition as plain fragments. */
export function caseIdSetFragment(
  ids: readonly number[]
): RepositoryCasesWhereInput {
  return { id: { in: [...ids] } };
}

export interface FacetWhereComposer {
  /** scope AND every active predicate fragment. */
  whereAll: RepositoryCasesWhereInput;
  /** Dimensions with at least one active fragment. */
  activeDimensions: ReadonlySet<string>;
  /**
   * scope AND all fragments except the named dimensions'. Returns the
   * `whereAll` object itself when none of the named dimensions is active —
   * callers can rely on reference equality to skip duplicate queries.
   */
  whereExcept(...dimensions: string[]): RepositoryCasesWhereInput;
}

export function createFacetWhereComposer(
  scopeWhere: RepositoryCasesWhereInput,
  fragments: readonly DimensionWhereFragment[]
): FacetWhereComposer {
  const whereAll: RepositoryCasesWhereInput = {
    AND: [scopeWhere, ...fragments.map((fragment) => fragment.where)],
  };
  const activeDimensions: ReadonlySet<string> = new Set(
    fragments.map((fragment) => fragment.dimension)
  );
  return {
    whereAll,
    activeDimensions,
    whereExcept(...dimensions) {
      const excluded = new Set(
        dimensions.filter((dimension) => activeDimensions.has(dimension))
      );
      if (excluded.size === 0) return whereAll;
      return {
        AND: [
          scopeWhere,
          ...fragments
            .filter((fragment) => !excluded.has(fragment.dimension))
            .map((fragment) => fragment.where),
        ],
      };
    },
  };
}

export interface RunFacetRow {
  repositoryCaseId: number;
  statusId: number | null;
  assignedToId: string | null;
}

export type RunRowFilterMap = ReadonlyMap<
  string,
  (row: RunFacetRow) => boolean
>;

/**
 * Row-level evaluators for run-scoped predicates, mirroring
 * compileRunPredicates' semantics (ids OR the null sentinel; multiple
 * predicates per dimension AND; a predicate with no usable branches — which
 * the compiler also skips — contributes no filter).
 */
export function buildRunRowFilters(
  runPredicates: readonly FilterPredicate[]
): RunRowFilterMap {
  const perDimension = new Map<string, Array<(row: RunFacetRow) => boolean>>();
  const add = (dimension: string, fn: (row: RunFacetRow) => boolean) => {
    const list = perDimension.get(dimension) ?? [];
    list.push(fn);
    perDimension.set(dimension, list);
  };

  for (const predicate of runPredicates) {
    if (predicate.dimension === "status") {
      const ids = new Set(
        predicate.values.filter(
          (value): value is number => typeof value === "number"
        )
      );
      const untested = predicate.values.includes(STATUS_UNTESTED_SENTINEL);
      if (ids.size === 0 && !untested) continue;
      add(
        "status",
        (row) =>
          (row.statusId !== null && ids.has(row.statusId)) ||
          (untested && row.statusId === null)
      );
    } else if (predicate.dimension === "assignedTo") {
      const ids = new Set(
        predicate.values
          .filter((value) => value !== ASSIGNED_TO_UNASSIGNED_SENTINEL)
          .map(String)
      );
      const unassigned = predicate.values.includes(
        ASSIGNED_TO_UNASSIGNED_SENTINEL
      );
      if (ids.size === 0 && !unassigned) continue;
      add(
        "assignedTo",
        (row) =>
          (row.assignedToId !== null && ids.has(row.assignedToId)) ||
          (unassigned && row.assignedToId === null)
      );
    }
  }

  return new Map(
    [...perDimension].map(([dimension, fns]) => [
      dimension,
      (row: RunFacetRow) => fns.every((fn) => fn(row)),
    ])
  );
}

/** All run-dimension filters pass, optionally self-excluding one dimension. */
export function runRowPasses(
  filters: RunRowFilterMap,
  row: RunFacetRow,
  exceptDimension?: string
): boolean {
  for (const [dimension, fn] of filters) {
    if (dimension === exceptDimension) continue;
    if (!fn(row)) return false;
  }
  return true;
}

// --- Engine -----------------------------------------------------------------

const RUN_DIMENSION_KEYS = ["status", "assignedTo"] as const;

/** Bounded concurrency for the per-dynamic-field queries. */
const DYNAMIC_FIELD_CHUNK_SIZE = 5;

const COUNTABLE_FIELD_TYPES = [
  "Dropdown",
  "Multi-Select",
  "Checkbox",
  "Integer",
  "Number",
  "Link",
  "Steps",
  "Date",
  "Text Long",
  "Text String",
] as const;

interface DynamicFieldOptionMeta {
  id: number;
  name: string;
  order: number;
  icon: { name: string } | null;
  iconColor: { value: string } | null;
}

interface DynamicFieldMeta {
  fieldId: number;
  displayName: string;
  type: string;
  options?: DynamicFieldOptionMeta[];
}

export interface DynamicFieldFacet {
  type: string;
  fieldId: number;
  options?: Array<DynamicFieldOptionMeta & { count: number }>;
  counts?: { hasValue: number; noValue: number };
  values?: unknown[];
}

/**
 * Per-dimension self-excluded totals: for each dimension key, the count under
 * `whereExcept(thatDimension)` — "what you'd see if you cleared this
 * dimension's filters". The client's "All …"/"Mixed" rows read these instead
 * of `totalCount`, which is counted under ALL predicates and therefore sits on
 * a different (smaller) base than the self-excluded per-option counts.
 *
 * Every value is derived from numbers the facet queries already produced, so
 * the field costs no extra round trips — unchipped dimensions share the
 * `whereAll` base by construction.
 */
export type FacetDimensionTotals = Record<string, number>;

export interface RepositoryCaseFacetCounts {
  templates: Array<{ id: number; name: string; count: number }>;
  states: Array<{
    id: number;
    name: string;
    icon?: { name: string } | null;
    iconColor?: { value: string } | null;
    count: number;
  }>;
  creators: Array<{ id: string; name: string; count: number }>;
  automated: Array<{ value: boolean; count: number }>;
  parameterized: Array<{ value: boolean; count: number }>;
  attachments: Array<{ value: boolean; count: number }>;
  /**
   * Present only while the review workflow is live for the project — the
   * dimension does not exist otherwise, and an all-zero facet would put a
   * dead "In Review" axis in the ViewSelector of every other project.
   */
  inReview?: Array<{ value: boolean; count: number }>;
  tags: Array<{ id: number | "any" | "none"; name: string; count: number }>;
  issues: Array<{
    id: number | "any" | "none";
    name: string;
    title?: string | null;
    count: number;
  }>;
  dynamicFields: Record<string, DynamicFieldFacet>;
  testRunOptions: {
    statuses: Array<{
      id: number;
      name: string;
      color?: { value: string } | null;
      count: number;
    }>;
    assignedTo: Array<{ id: string; name: string; count: number }>;
    untestedCount: number;
    unassignedCount: number;
    totalCount: number;
  } | null;
  totalCount: number;
  /** Self-excluded per-dimension totals (additive; see FacetDimensionTotals). */
  dimensionTotals: FacetDimensionTotals;
}

export interface ComputeFacetCountsOptions {
  projectId: number;
  isRunMode?: boolean;
  /** Already-normalized run ids (runIds ?? [runId]). */
  effectiveRunIds?: readonly number[];
  /** Legacy fallback when run mode has no runIds. */
  selectedTestCases?: readonly number[];
  /** Raw request field; parsed leniently against the server registry. */
  predicates?: unknown;
  searchCaseIds?: readonly number[];
  /** Injectable reference time for relative-date predicates. */
  now?: Date;
}

function andWhere(
  base: RepositoryCasesWhereInput,
  extra: RepositoryCasesWhereInput
): RepositoryCasesWhereInput {
  return { AND: [base, extra] };
}

/** Derived bucket sizes are subtractions; a stale/edge input never goes below 0. */
function nonNegative(value: number): number {
  return value > 0 ? value : 0;
}

function sumValues(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function countByKey<T, K>(items: readonly T[], key: (item: T) => K | null) {
  const counts = new Map<K, number>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export async function computeRepositoryCaseFacetCounts(
  db: FacetCountsDb,
  options: ComputeFacetCountsOptions
): Promise<RepositoryCaseFacetCounts> {
  const now = options.now ?? new Date();
  const projectId = options.projectId;
  const isRunMode = options.isRunMode === true;
  const effectiveRunIds = options.effectiveRunIds ?? [];
  const searchCaseIds = options.searchCaseIds ?? null;

  // Kicked off here so the two flag reads overlap the dynamic-field metadata
  // query below; awaited at step 1b.
  const reviewEnabledPromise = Promise.all([
    isReviewFeatureSystemEnabled(db),
    db.projects.findUnique({
      where: { id: projectId },
      select: { reviewWorkflowEnabled: true },
    }),
  ]).then(
    ([systemEnabled, project]) =>
      systemEnabled && project?.reviewWorkflowEnabled === true
  );

  // 1. Dynamic-field metadata first — the registry needs the field types
  //    before predicates can be parsed.
  const dynamicFieldInfo = await db.templates.findMany({
    where: {
      isDeleted: false,
      projects: { some: { projectId } },
    },
    select: {
      id: true,
      templateName: true,
      caseFields: {
        where: {
          caseField: { isEnabled: true, isDeleted: false },
        },
        select: {
          caseField: {
            select: {
              id: true,
              displayName: true,
              type: { select: { type: true } },
              fieldOptions: {
                select: {
                  fieldOption: {
                    select: {
                      id: true,
                      name: true,
                      order: true,
                      icon: { select: { name: true } },
                      iconColor: { select: { value: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const dynamicFieldsMap = new Map<number, DynamicFieldMeta>();
  for (const template of dynamicFieldInfo) {
    for (const cf of template.caseFields) {
      const field = cf.caseField;
      const fieldType = field.type.type;
      if (
        !(COUNTABLE_FIELD_TYPES as readonly string[]).includes(fieldType) ||
        dynamicFieldsMap.has(field.id)
      ) {
        continue;
      }
      dynamicFieldsMap.set(field.id, {
        fieldId: field.id,
        displayName: field.displayName,
        type: fieldType,
        options:
          fieldType === "Dropdown" || fieldType === "Multi-Select"
            ? field.fieldOptions
                .map((fo) => ({
                  id: fo.fieldOption.id,
                  name: fo.fieldOption.name,
                  order: fo.fieldOption.order,
                  icon: fo.fieldOption.icon,
                  iconColor: fo.fieldOption.iconColor,
                }))
                .sort((a, b) => a.order - b.order)
            : undefined,
      });
    }
  }

  // 1b. Review-workflow gate, then the PENDING-review case ids the `inReview`
  //     dimension resolves through. ReviewRequest references its entity
  //     polymorphically (no FK back-relation to RepositoryCases), so the set
  //     is materialized here and compiles to an id fragment — the same lane
  //     the text/link/steps id-set predicates use. Indexed on
  //     (projectId, status); off-project rows can't leak in, so the set is
  //     one project's review queue rather than a scan of the repository.
  const reviewEnabled = await reviewEnabledPromise;
  let inReviewCaseIds: number[] = [];
  if (reviewEnabled) {
    const pendingRows = await db.reviewRequest.findMany({
      where: {
        projectId,
        entityType: ReviewEntityType.CASE,
        status: "PENDING",
        isDeleted: false,
      },
      select: { entityId: true },
    });
    inReviewCaseIds = [...new Set(pendingRows.map((row) => row.entityId))];
  }
  const inReviewCaseIdSet = new Set(inReviewCaseIds);

  // 2. Registry + lenient parse (invalid predicates drop silently).
  const registry = buildFilterDimensions({
    dynamicFields: [...dynamicFieldsMap.values()].map((field) => ({
      fieldId: field.fieldId,
      type: field.type,
    })),
    includeRunDimensions: isRunMode,
    includeInReview: reviewEnabled,
  });
  const predicates = parseFilterPredicates(options.predicates ?? [], registry);

  // 3. Run membership + the single testRunCases fetch (run facets, run-dim
  //    id-sets, and multi-config weighting all read from it).
  let testRunRows: Array<
    RunFacetRow & {
      testRunId: number;
      status: {
        id: number;
        name: string;
        color: { value: string } | null;
      } | null;
      assignedTo: { id: string; name: string } | null;
    }
  > | null = null;
  let allTestRunCaseIds: number[] = [];
  let runCaseIds: number[] | null = null;

  if (isRunMode && effectiveRunIds.length > 0) {
    testRunRows = await db.testRunCases.findMany({
      where: {
        testRunId: { in: [...effectiveRunIds] },
        isDeleted: false,
      },
      select: {
        repositoryCaseId: true,
        statusId: true,
        assignedToId: true,
        testRunId: true,
        status: {
          select: {
            id: true,
            name: true,
            color: { select: { value: true } },
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    allTestRunCaseIds = testRunRows.map((row) => row.repositoryCaseId);
    runCaseIds = [...new Set(allTestRunCaseIds)];
  } else if (isRunMode && (options.selectedTestCases?.length ?? 0) > 0) {
    runCaseIds = [...options.selectedTestCases!];
    allTestRunCaseIds = [...options.selectedTestCases!];
  }

  // 4. Scope (search intersects here — BEFORE any self-exclusion snapshot).
  const scopeWhere = buildFacetScopeWhere({
    projectId,
    runCaseIds,
    searchCaseIds,
  });

  // 5. Partition predicates.
  const partition = partitionFacetPredicates(
    predicates,
    registry,
    now,
    inReviewCaseIds
  );

  // 6. Resolve id-set predicates (text/link/steps operators) — one bounded
  //    fetch per field / one steps GROUP BY, all in parallel.
  const idSetFragments: DimensionWhereFragment[] = [];
  if (partition.idSetPredicates.length > 0) {
    const scopeIds = (
      await db.repositoryCases.findMany({
        where: scopeWhere,
        select: { id: true },
      })
    ).map((row) => row.id);

    const textLinkSpecs = partition.idSetPredicates.filter(
      (spec) => spec.filter.type !== "steps"
    );
    const stepsSpecs = partition.idSetPredicates.filter(
      (spec) => spec.filter.type === "steps"
    );

    const specsByField = new Map<number, IdSetPredicateSpec[]>();
    for (const spec of textLinkSpecs) {
      const list = specsByField.get(spec.fieldId) ?? [];
      list.push(spec);
      specsByField.set(spec.fieldId, list);
    }

    await Promise.all([
      ...[...specsByField].map(async ([fieldId, specs]) => {
        const rows = await db.caseFieldValues.findMany({
          where: {
            fieldId,
            testCaseId: { in: scopeIds },
            value: { not: DbNull },
          },
          select: { testCaseId: true, value: true },
        });
        for (const spec of specs) {
          const ids = rows
            .filter((row) =>
              matchesPostFetchFilters(
                { caseFieldValues: [{ fieldId, value: row.value }] },
                [spec.filter]
              )
            )
            .map((row) => row.testCaseId);
          idSetFragments.push({
            dimension: spec.dimension,
            where: caseIdSetFragment(ids),
          });
        }
      }),
      (async () => {
        if (stepsSpecs.length === 0) return;
        const stepCounts = await db.$queryRaw<
          Array<{ id: number; count: bigint }>
        >`
          SELECT rc.id, COUNT(s.id)::bigint AS count
          FROM "public"."RepositoryCases" rc
          LEFT JOIN "public"."Steps" s
            ON s."testCaseId" = rc.id AND s."isDeleted" = false
          WHERE rc.id = ANY(${scopeIds})
          GROUP BY rc.id
        `;
        for (const spec of stepsSpecs) {
          const ids = stepCounts
            .filter((row) =>
              // Synthesized case: a sparse array of the counted length lets
              // the shared matcher pipeline (which reads steps.length) run
              // byte-identical to the client table path.
              matchesPostFetchFilters(
                { caseFieldValues: [], steps: new Array(Number(row.count)) },
                [spec.filter]
              )
            )
            .map((row) => row.id);
          idSetFragments.push({
            dimension: spec.dimension,
            where: caseIdSetFragment(ids),
          });
        }
      })(),
    ]);
  }

  // 7. Run-dim case-level id-sets (some row of the case passes the
  //    dimension's predicates). Used by repo-side wheres; the run facets
  //    themselves re-apply run predicates row-wise instead.
  const runRowFilters = buildRunRowFilters(partition.runPredicates);
  const runDimFragments: DimensionWhereFragment[] = [];
  if (testRunRows) {
    for (const [dimension, passes] of runRowFilters) {
      const ids = [
        ...new Set(
          testRunRows.filter(passes).map((row) => row.repositoryCaseId)
        ),
      ];
      runDimFragments.push({ dimension, where: caseIdSetFragment(ids) });
    }
  }

  // 8. Composition + memoized id materialization. Cache key = the set of
  //    ACTIVE dimensions excluded, so every unchipped dimension shares the
  //    whereAll entry.
  const composer = createFacetWhereComposer(scopeWhere, [
    ...partition.whereFragments,
    ...idSetFragments,
    ...runDimFragments,
  ]);

  const idsCache = new Map<string, Promise<number[]>>();
  const idsExcept = (...dimensions: string[]): Promise<number[]> => {
    const excluded = [
      ...new Set(
        dimensions.filter((dimension) =>
          composer.activeDimensions.has(dimension)
        )
      ),
    ].sort();
    const key = excluded.join("|");
    let cached = idsCache.get(key);
    if (!cached) {
      cached = db.repositoryCases
        .findMany({
          where: composer.whereExcept(...excluded),
          select: { id: true },
        })
        .then((rows) => rows.map((row) => row.id));
      idsCache.set(key, cached);
    }
    return cached;
  };

  const multiConfig =
    isRunMode && allTestRunCaseIds.length > 0 && effectiveRunIds.length > 1;

  // Multi-config: per-dimension eligible (run × case) rows — repo predicates
  // via the case-id set (run-dim fragments excluded: they re-apply row-wise),
  // run predicates row-wise. Shared helper so the per-facet recounts cannot
  // drift.
  const weightedRowsCache = new Map<string, Promise<RunFacetRow[]>>();
  const weightedRowsExcept = (dimension?: string): Promise<RunFacetRow[]> => {
    const key = dimension ?? "";
    let cached = weightedRowsCache.get(key);
    if (!cached) {
      cached = (async () => {
        const set = new Set(
          await idsExcept(
            ...(dimension ? [dimension] : []),
            ...RUN_DIMENSION_KEYS
          )
        );
        return testRunRows!.filter(
          (row) =>
            set.has(row.repositoryCaseId) && runRowPasses(runRowFilters, row)
        );
      })();
      weightedRowsCache.set(key, cached);
    }
    return cached;
  };

  interface CaseProps {
    templateId: number;
    stateId: number;
    creatorId: string;
    automated: boolean;
    hasParameters: boolean;
  }
  let casePropertiesMap: Map<number, CaseProps> | null = null;
  if (multiConfig) {
    const caseProperties = await db.repositoryCases.findMany({
      where: { id: { in: runCaseIds! } },
      select: {
        id: true,
        templateId: true,
        stateId: true,
        creatorId: true,
        automated: true,
        hasParameters: true,
      },
    });
    casePropertiesMap = new Map(
      caseProperties.map((c) => [
        c.id,
        {
          templateId: c.templateId,
          stateId: c.stateId,
          creatorId: c.creatorId,
          automated: c.automated,
          hasParameters: c.hasParameters,
        },
      ])
    );
  }

  // 9. Facet counting.

  const scalarCounts = async <K>(
    dimension: string,
    groupField: "templateId" | "stateId" | "creatorId",
    prop: (props: CaseProps) => K
  ): Promise<Map<K, number>> => {
    if (multiConfig) {
      const rows = await weightedRowsExcept(dimension);
      return countByKey(rows, (row) => {
        const props = casePropertiesMap!.get(row.repositoryCaseId);
        return props ? prop(props) : null;
      });
    }
    const groups = await db.repositoryCases.groupBy({
      by: [groupField],
      where: composer.whereExcept(dimension),
      _count: true,
    });
    return new Map(
      groups.map((group) => [
        group[groupField] as unknown as K,
        group._count as number,
      ])
    );
  };

  const booleanCounts = async (
    dimension: string,
    groupField: "automated" | "hasParameters",
    prop: (props: CaseProps) => boolean
  ): Promise<Array<{ value: boolean; count: number }>> => {
    if (multiConfig) {
      const rows = await weightedRowsExcept(dimension);
      const counts = countByKey(rows, (row) => {
        const props = casePropertiesMap!.get(row.repositoryCaseId);
        return props ? prop(props) : null;
      });
      return [...counts].map(([value, count]) => ({ value, count }));
    }
    const groups = await db.repositoryCases.groupBy({
      by: [groupField],
      where: composer.whereExcept(dimension),
      _count: true,
    });
    return groups.map((group) => ({
      value: group[groupField] as unknown as boolean,
      count: group._count as number,
    }));
  };

  // Tags / issues per-value counts. Raw SQL keeps the proven join shape; a
  // single-array bind carries whereExcept(D) whenever anything beyond the
  // bare project scope is active.
  const tagIssueBindIds = async (
    dimension: "tags" | "issues"
  ): Promise<number[] | null> => {
    const othersActive = [...composer.activeDimensions].some(
      (active) => active !== dimension
    );
    if (othersActive || scopeWhere.id !== undefined) {
      return idsExcept(dimension);
    }
    return null;
  };

  const tagCountsTask = (async () => {
    if (multiConfig) {
      const rows = await weightedRowsExcept("tags");
      const uniqueIds = [...new Set(rows.map((row) => row.repositoryCaseId))];
      const associations = await db.repositoryCases.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          caseTags: { select: { tag: { select: { id: true } } } },
        },
      });
      const caseTagsMap = new Map<number, number[]>(
        associations.map((c) => [c.id, c.caseTags.map((ct) => ct.tag.id)])
      );
      const perTag = new Map<number, number>();
      let withTags = 0;
      for (const row of rows) {
        const tagIds = caseTagsMap.get(row.repositoryCaseId) ?? [];
        if (tagIds.length > 0) withTags++;
        for (const tagId of tagIds) {
          perTag.set(tagId, (perTag.get(tagId) ?? 0) + 1);
        }
      }
      return {
        perTag: [...perTag].map(([tagId, count]) => ({ tagId, count })),
        withTags,
        totalExcept: rows.length,
      };
    }

    const bindIds = await tagIssueBindIds("tags");
    const rows =
      bindIds !== null
        ? await db.$queryRaw<Array<{ tagId: number; count: bigint }>>`
            SELECT rct."tagId" as "tagId", COUNT(*)::bigint as count
            FROM "public"."RepositoryCaseTag" rct
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rct."caseId"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND rc.id = ANY(${bindIds})
            GROUP BY rct."tagId"
          `
        : await db.$queryRaw<Array<{ tagId: number; count: bigint }>>`
            SELECT rct."tagId" as "tagId", COUNT(*)::bigint as count
            FROM "public"."RepositoryCaseTag" rct
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rct."caseId"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
            GROUP BY rct."tagId"
          `;

    const [withTags, totalExcept] = await Promise.all([
      db.repositoryCases.count({
        where: andWhere(composer.whereExcept("tags"), {
          caseTags: { some: {} },
        }),
      }),
      idsExcept("tags").then((ids) => ids.length),
    ]);
    return {
      perTag: rows.map((row) => ({
        tagId: row.tagId,
        count: Number(row.count),
      })),
      withTags,
      totalExcept,
    };
  })();

  const issueCountsTask = (async () => {
    if (multiConfig) {
      const rows = await weightedRowsExcept("issues");
      const uniqueIds = [...new Set(rows.map((row) => row.repositoryCaseId))];
      const associations = await db.repositoryCases.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          caseIssues: {
            select: { issue: { select: { id: true } } },
            where: { issue: { isDeleted: false } },
          },
        },
      });
      const caseIssuesMap = new Map<number, number[]>(
        associations.map((c) => [c.id, c.caseIssues.map((ci) => ci.issue.id)])
      );
      const perIssue = new Map<number, number>();
      let withIssues = 0;
      for (const row of rows) {
        const issueIds = caseIssuesMap.get(row.repositoryCaseId) ?? [];
        if (issueIds.length > 0) withIssues++;
        for (const issueId of issueIds) {
          perIssue.set(issueId, (perIssue.get(issueId) ?? 0) + 1);
        }
      }
      return {
        perIssue: [...perIssue].map(([issueId, count]) => ({
          issueId,
          count,
        })),
        withIssues,
        totalExcept: rows.length,
      };
    }

    const bindIds = await tagIssueBindIds("issues");
    const rows =
      bindIds !== null
        ? await db.$queryRaw<Array<{ issueId: number; count: bigint }>>`
            SELECT rci."issueId" as "issueId", COUNT(*)::bigint as count
            FROM "public"."RepositoryCaseIssue" rci
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rci."caseId"
            INNER JOIN "public"."Issue" i ON i.id = rci."issueId"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND i."isDeleted" = false
              AND rc.id = ANY(${bindIds})
            GROUP BY rci."issueId"
          `
        : await db.$queryRaw<Array<{ issueId: number; count: bigint }>>`
            SELECT rci."issueId" as "issueId", COUNT(*)::bigint as count
            FROM "public"."RepositoryCaseIssue" rci
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rci."caseId"
            INNER JOIN "public"."Issue" i ON i.id = rci."issueId"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND i."isDeleted" = false
            GROUP BY rci."issueId"
          `;

    const [withIssues, totalExcept] = await Promise.all([
      db.repositoryCases.count({
        where: andWhere(composer.whereExcept("issues"), {
          caseIssues: { some: { issue: { isDeleted: false } } },
        }),
      }),
      idsExcept("issues").then((ids) => ids.length),
    ]);
    return {
      perIssue: rows.map((row) => ({
        issueId: row.issueId,
        count: Number(row.count),
      })),
      withIssues,
      totalExcept,
    };
  })();

  const attachmentsTask = (async () => {
    if (multiConfig) {
      const rows = await weightedRowsExcept("attachments");
      const uniqueIds = [...new Set(rows.map((row) => row.repositoryCaseId))];
      const withSet = new Set(
        (
          await db.repositoryCases.findMany({
            where: {
              id: { in: uniqueIds },
              ...attachmentsWhereClause(true),
            },
            select: { id: true },
          })
        ).map((c) => c.id)
      );
      const withAttachments = rows.filter((row) =>
        withSet.has(row.repositoryCaseId)
      ).length;
      return shapeAttachmentsFacet(rows.length, withAttachments);
    }
    const [withAttachments, totalExcept] = await Promise.all([
      db.repositoryCases.count({
        where: andWhere(
          composer.whereExcept("attachments"),
          attachmentsWhereClause(true)
        ),
      }),
      idsExcept("attachments").then((ids) => ids.length),
    ]);
    return shapeAttachmentsFacet(totalExcept, withAttachments);
  })();

  // Both buckets come from ONE materialization of `whereExcept(inReview)` —
  // the id list is already in memory, so the split is a Set membership test
  // rather than a second COUNT. Unchipped, that id list is the same promise
  // totalCountTask awaits (idsExcept memoizes on the excluded-dimension set).
  const inReviewTask = (async (): Promise<
    Array<{ value: boolean; count: number }> | undefined
  > => {
    if (!reviewEnabled) return undefined;
    if (multiConfig) {
      const rows = await weightedRowsExcept(IN_REVIEW_DIMENSION);
      const withReview = rows.filter((row) =>
        inReviewCaseIdSet.has(row.repositoryCaseId)
      ).length;
      return [
        { value: true, count: withReview },
        { value: false, count: nonNegative(rows.length - withReview) },
      ];
    }
    const ids = await idsExcept(IN_REVIEW_DIMENSION);
    const withReview = ids.filter((id) => inReviewCaseIdSet.has(id)).length;
    return [
      { value: true, count: withReview },
      { value: false, count: nonNegative(ids.length - withReview) },
    ];
  })();

  const totalCountTask = (async () => {
    if (multiConfig) {
      return (await weightedRowsExcept()).length;
    }
    return (await idsExcept()).length;
  })();

  const [
    templateCountMap,
    stateCountMap,
    creatorCountMap,
    automatedWithCounts,
    parameterizedWithCounts,
    tagCounts,
    issueCounts,
    attachmentsWithCounts,
    inReviewWithCounts,
    totalCount,
  ] = await Promise.all([
    scalarCounts<number>("templates", "templateId", (p) => p.templateId),
    scalarCounts<number>("states", "stateId", (p) => p.stateId),
    scalarCounts<string>("creators", "creatorId", (p) => p.creatorId),
    booleanCounts("automated", "automated", (p) => p.automated),
    booleanCounts("parameterized", "hasParameters", (p) => p.hasParameters),
    tagCountsTask,
    issueCountsTask,
    attachmentsTask,
    inReviewTask,
    totalCountTask,
  ]);

  // 10. Detail lookups for the ids that surfaced.
  const [
    templateDetails,
    stateDetails,
    creatorDetails,
    tagDetails,
    issueDetails,
  ] = await Promise.all([
    db.templates.findMany({
      where: { id: { in: [...templateCountMap.keys()] }, isDeleted: false },
      select: { id: true, templateName: true },
    }),
    db.workflows.findMany({
      where: { id: { in: [...stateCountMap.keys()] }, isDeleted: false },
      select: {
        id: true,
        name: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
    }),
    db.user.findMany({
      where: { id: { in: [...creatorCountMap.keys()] } },
      select: { id: true, name: true },
    }),
    tagCounts.perTag.length > 0
      ? db.tags.findMany({
          where: {
            id: { in: tagCounts.perTag.map((t) => t.tagId) },
            isDeleted: false,
          },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    issueCounts.perIssue.length > 0
      ? db.issue.findMany({
          where: {
            id: { in: issueCounts.perIssue.map((i) => i.issueId) },
            isDeleted: false,
          },
          select: { id: true, name: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  // 11. Dynamic-field facets, bounded-concurrency chunks. Each chipped field
  //     self-excludes via whereExcept(field_<id>); unchipped fields share the
  //     whereAll id list. hasValue/noValue pairs derive from the SAME
  //     per-field base (fixes the legacy mixed-base negative-noValue bug).
  const computeDynamicFieldFacet = async (
    fieldInfo: DynamicFieldMeta
  ): Promise<[string, DynamicFieldFacet]> => {
    const dimensionKey = dynamicFieldDimensionKey(fieldInfo.fieldId);
    const ids = await idsExcept(dimensionKey);
    const total = ids.length;
    const fieldId = fieldInfo.fieldId;

    if (fieldInfo.options) {
      const fieldValues = await db.caseFieldValues.findMany({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { not: DbNull },
        },
        select: { value: true },
      });
      const optionCountMap = new Map<number, number>();
      // Per-CASE has-value tally. It is not the sum of the option counts: a
      // Multi-Select case contributes to several options but is one case.
      let withValueCount = 0;
      for (const fv of fieldValues) {
        if (fv.value === null || fv.value === undefined) continue;
        if (Array.isArray(fv.value)) {
          if (fv.value.length > 0) withValueCount++;
          for (const optionId of fv.value) {
            if (typeof optionId === "number") {
              optionCountMap.set(
                optionId,
                (optionCountMap.get(optionId) ?? 0) + 1
              );
            }
          }
        } else if (typeof fv.value === "number") {
          withValueCount++;
          optionCountMap.set(fv.value, (optionCountMap.get(fv.value) ?? 0) + 1);
        }
      }
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          options: fieldInfo.options.map((opt) => ({
            ...opt,
            count: optionCountMap.get(opt.id) ?? 0,
          })),
          // Option fields emit the hasValue/noValue pair every other field
          // type already does, derived from the SAME self-excluded base the
          // option counts use. Without it the client had to subtract the
          // option sum from `totalCount` (a different, smaller base) and the
          // "None" row went negative.
          counts: {
            hasValue: withValueCount,
            noValue: nonNegative(total - withValueCount),
          },
        },
      ];
    }

    if (fieldInfo.type === "Link") {
      const linkCount = await db.caseFieldValues.count({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { not: DbNull },
          AND: [{ value: { not: "" } }],
        },
      });
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          counts: { hasValue: linkCount, noValue: total - linkCount },
        },
      ];
    }

    if (fieldInfo.type === "Steps") {
      const withStepsCount = await db.repositoryCases.count({
        where: andWhere(composer.whereExcept(dimensionKey), {
          steps: { some: { isDeleted: false } },
        }),
      });
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          counts: {
            hasValue: withStepsCount,
            noValue: total - withStepsCount,
          },
        },
      ];
    }

    if (fieldInfo.type === "Checkbox") {
      const checkedCount = await db.caseFieldValues.count({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { equals: true },
        },
      });
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          counts: { hasValue: checkedCount, noValue: total - checkedCount },
        },
      ];
    }

    if (fieldInfo.type === "Integer" || fieldInfo.type === "Number") {
      const fieldValues = await db.caseFieldValues.findMany({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { not: DbNull },
        },
        select: { value: true },
      });
      const valueCounts = new Map<number, number>();
      for (const fv of fieldValues) {
        if (fv.value === null || fv.value === undefined) continue;
        const numValue =
          typeof fv.value === "number"
            ? fv.value
            : parseFloat(fv.value as string);
        if (!isNaN(numValue)) {
          valueCounts.set(numValue, (valueCounts.get(numValue) ?? 0) + 1);
        }
      }
      const sortedValues = [...valueCounts.keys()].sort((a, b) => a - b);
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          options: sortedValues.map((value) => ({
            id: value,
            name: value.toString(),
            count: valueCounts.get(value) ?? 0,
          })) as DynamicFieldFacet["options"],
          counts: {
            hasValue: fieldValues.length,
            noValue: total - fieldValues.length,
          },
        },
      ];
    }

    if (fieldInfo.type === "Date") {
      const fieldValues = await db.caseFieldValues.findMany({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { not: DbNull },
        },
        select: { value: true },
      });
      const withDateCount = fieldValues.filter((fv) => {
        if (fv.value === null || fv.value === undefined) return false;
        if (typeof fv.value === "string") return fv.value.trim() !== "";
        return true;
      }).length;
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          counts: { hasValue: withDateCount, noValue: total - withDateCount },
        },
      ];
    }

    if (fieldInfo.type === "Text Long" || fieldInfo.type === "Text String") {
      const fieldValues = await db.caseFieldValues.findMany({
        where: {
          fieldId,
          testCaseId: { in: ids },
          value: { not: DbNull },
        },
        select: { value: true },
      });
      let withTextCount = 0;
      for (const fv of fieldValues) {
        if (!isTiptapEmpty(fv.value)) withTextCount++;
      }
      return [
        fieldInfo.displayName,
        {
          type: fieldInfo.type,
          fieldId,
          counts: { hasValue: withTextCount, noValue: total - withTextCount },
        },
      ];
    }

    return [
      fieldInfo.displayName,
      { type: fieldInfo.type, fieldId, values: [] },
    ];
  };

  // The self-excluded base each field's facet was counted under, reported as
  // that dimension's total. `idsExcept` is memoized, so re-reading it here
  // costs nothing (unchipped fields share the whereAll entry).
  const computeDynamicFieldEntry = async (fieldInfo: DynamicFieldMeta) => {
    const [displayName, facet] = await computeDynamicFieldFacet(fieldInfo);
    const dimensionKey = dynamicFieldDimensionKey(fieldInfo.fieldId);
    return {
      displayName,
      facet,
      dimensionKey,
      total: (await idsExcept(dimensionKey)).length,
    };
  };

  const dynamicFields: Record<string, DynamicFieldFacet> = {};
  const dynamicFieldTotals: FacetDimensionTotals = {};
  for (const fieldChunk of chunk(
    [...dynamicFieldsMap.values()],
    DYNAMIC_FIELD_CHUNK_SIZE
  )) {
    const results = await Promise.all(fieldChunk.map(computeDynamicFieldEntry));
    for (const entry of results) {
      dynamicFields[entry.displayName] = entry.facet;
      dynamicFieldTotals[entry.dimensionKey] = entry.total;
    }
  }

  // 12. Run facets: repo predicates via the shared exclusion id-set, the
  //     OTHER run dimension applied row-wise (self-exclusion per dimension).
  let testRunOptions: RepositoryCaseFacetCounts["testRunOptions"] = null;
  const runDimensionTotals: FacetDimensionTotals = {};
  if (testRunRows) {
    const baseIds = new Set(await idsExcept(...RUN_DIMENSION_KEYS));
    const eligible = testRunRows.filter((row) =>
      baseIds.has(row.repositoryCaseId)
    );

    const statusMap = new Map<
      number,
      {
        id: number;
        name: string;
        color?: { value: string } | null;
        count: number;
      }
    >();
    let untestedCount = 0;
    for (const row of eligible) {
      if (!runRowPasses(runRowFilters, row, "status")) continue;
      if (row.statusId && row.status) {
        const existing = statusMap.get(row.statusId);
        if (existing) {
          existing.count++;
        } else {
          statusMap.set(row.statusId, {
            id: row.statusId,
            name: row.status.name,
            color: row.status.color,
            count: 1,
          });
        }
      } else {
        untestedCount++;
      }
    }

    const assignedToMap = new Map<
      string,
      { id: string; name: string; count: number }
    >();
    let unassignedCount = 0;
    for (const row of eligible) {
      if (!runRowPasses(runRowFilters, row, "assignedTo")) continue;
      if (row.assignedToId && row.assignedTo) {
        const existing = assignedToMap.get(row.assignedToId);
        if (existing) {
          existing.count++;
        } else {
          assignedToMap.set(row.assignedToId, {
            id: row.assignedToId,
            name: row.assignedTo.name,
            count: 1,
          });
        }
      } else {
        unassignedCount++;
      }
    }

    testRunOptions = {
      statuses: [...statusMap.values()],
      assignedTo: [...assignedToMap.values()],
      untestedCount,
      unassignedCount,
      totalCount: eligible.filter((row) => runRowPasses(runRowFilters, row))
        .length,
    };

    // Run-dimension totals are ROW totals (matching their row-counted facets,
    // multi-config duplicates included), self-excluded per dimension — so
    // "All statuses" >= every status row and >= untested.
    runDimensionTotals.status = eligible.filter((row) =>
      runRowPasses(runRowFilters, row, "status")
    ).length;
    runDimensionTotals.assignedTo = eligible.filter((row) =>
      runRowPasses(runRowFilters, row, "assignedTo")
    ).length;
  }

  // 13. Assemble — same keys, sorting, sentinel ids, and fallback names as
  //     the legacy response, plus the additive `dimensionTotals`.
  //     Every total is read off numbers the facet queries already produced:
  //     each facet's buckets partition its own self-excluded base, so their
  //     sum IS `count(whereExcept(dimension))`.
  const dimensionTotals: FacetDimensionTotals = {
    templates: sumValues(templateCountMap.values()),
    states: sumValues(stateCountMap.values()),
    creators: sumValues(creatorCountMap.values()),
    automated: sumValues(automatedWithCounts.map((entry) => entry.count)),
    parameterized: sumValues(
      parameterizedWithCounts.map((entry) => entry.count)
    ),
    attachments: sumValues(attachmentsWithCounts.map((entry) => entry.count)),
    ...(inReviewWithCounts
      ? {
          [IN_REVIEW_DIMENSION]: sumValues(
            inReviewWithCounts.map((entry) => entry.count)
          ),
        }
      : {}),
    tags: tagCounts.totalExcept,
    issues: issueCounts.totalExcept,
    ...dynamicFieldTotals,
    ...runDimensionTotals,
  };

  return {
    templates: [...templateCountMap]
      .map(([id, count]) => ({
        id,
        name:
          templateDetails.find((t) => t.id === id)?.templateName || "Unknown",
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    states: [...stateCountMap]
      .map(([id, count]) => {
        const state = stateDetails.find((s) => s.id === id);
        return {
          id,
          name: state?.name || "Unknown",
          icon: state?.icon,
          iconColor: state?.color,
          count,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    creators: [...creatorCountMap]
      .map(([id, count]) => ({
        id,
        name: creatorDetails.find((c) => c.id === id)?.name || "Unknown",
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    automated: automatedWithCounts,
    parameterized: parameterizedWithCounts,
    attachments: attachmentsWithCounts,
    ...(inReviewWithCounts ? { inReview: inReviewWithCounts } : {}),
    tags: [
      { id: "any" as const, name: "Any Tag", count: tagCounts.withTags },
      {
        id: "none" as const,
        name: "No Tags",
        count: tagCounts.totalExcept - tagCounts.withTags,
      },
      // Sorted by name like every other facet: the GROUP BY behind perTag has
      // no ORDER BY, and its two query branches (with/without the id-array
      // bind) swap exactly when a predicate becomes active — so raw order can
      // change between refetches and reshuffle an open value list mid-click.
      ...tagCounts.perTag
        .map((t) => ({
          id: t.tagId,
          name: tagDetails.find((td) => td.id === t.tagId)?.name || "Unknown",
          count: t.count,
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    ],
    issues: [
      {
        id: "any" as const,
        name: "Any Issue",
        count: issueCounts.withIssues,
      },
      {
        id: "none" as const,
        name: "No Issues",
        count: issueCounts.totalExcept - issueCounts.withIssues,
      },
      ...issueCounts.perIssue
        .map((i) => {
          const issue = issueDetails.find((d) => d.id === i.issueId);
          return {
            id: i.issueId,
            name: issue?.name || "Unknown",
            title: issue?.title,
            count: i.count,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    ],
    dynamicFields,
    testRunOptions,
    totalCount,
    dimensionTotals,
  };
}
