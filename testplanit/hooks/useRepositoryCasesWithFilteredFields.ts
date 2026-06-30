import {
  useClientQueries,
  type ClientHooks,
} from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useCallback, useMemo } from "react";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

// Hook signatures for the RepositoryCases grouped client (v3 has no standalone
// useFindMany* symbol, so `typeof useClientQueries(schema)...` is not a valid
// type — index the ClientHooks type instead).
type ZsRepoHooks = ClientHooks<typeof schema>["repositoryCases"];

/**
 * Filters out orphaned field values from a test case
 * (field values that are not part of the test case's current template)
 */
export function filterOrphanedFieldValues<T>(testCase: T): T {
  const tc = testCase as any;
  if (!tc || !tc.template?.caseFields || !tc.caseFieldValues) {
    return testCase;
  }

  const templateFieldIds = new Set(
    tc.template.caseFields.map((cf: any) => cf.caseField.id)
  );

  const filteredFieldValues = tc.caseFieldValues.filter((cfv: any) =>
    templateFieldIds.has(cfv.fieldId)
  );

  return {
    ...tc,
    caseFieldValues: filteredFieldValues,
  };
}

/**
 * Apply text operator filter to a string value
 */
export function matchesTextOperator(
  value: any,
  operator: string,
  searchValue: string
): boolean {
  if (!value) return false;

  // Handle TipTap JSON documents (Text Long fields) and plain strings (Text String fields)
  let textValue: string;
  if (typeof value === "string") {
    textValue = value;
  } else if (typeof value === "object") {
    textValue = extractTextFromNode(value);
    if (!textValue) return false;
  } else {
    return false;
  }

  const lowerValue = textValue.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case "contains":
      return lowerValue.includes(lowerSearch);
    case "startsWith":
      return lowerValue.startsWith(lowerSearch);
    case "endsWith":
      return lowerValue.endsWith(lowerSearch);
    case "equals":
      return lowerValue === lowerSearch;
    case "notContains":
      return !lowerValue.includes(lowerSearch);
    default:
      return false;
  }
}

/**
 * Apply link operator filter to a URL string
 */
export function matchesLinkOperator(
  value: any,
  operator: string,
  searchValue: string
): boolean {
  if (!value || typeof value !== "string") return false;
  const lowerValue = value.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case "contains":
      return lowerValue.includes(lowerSearch);
    case "startsWith":
      return lowerValue.startsWith(lowerSearch);
    case "endsWith":
      return lowerValue.endsWith(lowerSearch);
    case "equals":
      return lowerValue === lowerSearch;
    case "domain":
      // Extract domain from URL and match
      try {
        const url = new URL(
          value.startsWith("http") ? value : `https://${value}`
        );
        return url.hostname.toLowerCase().includes(lowerSearch);
      } catch {
        // If not a valid URL, try simple domain matching
        return lowerValue.includes(lowerSearch);
      }
    default:
      return false;
  }
}

/**
 * Apply steps count operator filter to a steps array
 * For built-in Steps, the testCase object has a `steps` relation array
 * For custom Steps fields, the value would be in caseFieldValues
 */
export function matchesStepsOperator(
  testCase: any,
  operator: string,
  count1: number,
  count2?: number
): boolean {
  // Check if testCase has the built-in steps relation
  const steps = testCase?.steps;
  if (!Array.isArray(steps)) return false;

  // Count steps (already filtered for non-deleted in the query)
  const stepsCount = steps.length;

  switch (operator) {
    case "eq":
      return stepsCount === count1;
    case "lt":
      return stepsCount < count1;
    case "lte":
      return stepsCount <= count1;
    case "gt":
      return stepsCount > count1;
    case "gte":
      return stepsCount >= count1;
    case "between":
      return (
        count2 !== undefined && stepsCount >= count1 && stepsCount <= count2
      );
    default:
      return false;
  }
}

export interface PostFetchFilter {
  fieldId: number;
  type: "text" | "link" | "steps";
  operator: string;
  value1?: string | number;
  value2?: number;
}

/**
 * Wrapper around useClientQueries(schema).repositoryCases.useFindMany that automatically filters orphaned field values
 * and applies post-fetch filtering for text/link/steps operators.
 *
 * Two-phase paginated read (ZenStack v3 perf): a single paginated `useFindMany`
 * with the heavy `select` compiles to one SQL statement that hydrates every
 * selected relation (and the PolicyPlugin's per-row access subqueries) for ALL
 * rows matching `where` before applying LIMIT — O(total rows), not O(pageSize).
 * When the caller asks for a bounded page (`take` is a number) and there are no
 * post-fetch filters, we split the read:
 *   Phase 1 — fetch just the page's `id`s (cheap, no relations).
 *   Phase 2 — hydrate the heavy `select` for `id: { in: pageIds }`.
 * then re-impose phase-1 order. Identical rows/order/policy enforcement, but the
 * expensive work is bounded to the page. Post-fetch-filter mode already fetches
 * every row (`take: undefined`) to filter in JS, and `pageSize: "All"` (also
 * `take: undefined`) has no page to bound, so both keep the single-call path.
 */
export function useFindManyRepositoryCasesFiltered(
  queryOptions: Parameters<ZsRepoHooks["useFindMany"]>[0],
  postFetchFilters?: PostFetchFilter[],
  options?: Parameters<ZsRepoHooks["useFindMany"]>[1],
  clientPagination?: { skip: number; take: number | undefined }
) {
  const hasPostFetchFilters = !!postFetchFilters && postFetchFilters.length > 0;
  const qo = (queryOptions ?? {}) as any;
  const twoPhase = typeof qo.take === "number" && !hasPostFetchFilters;

  // Phase 1 — when two-phase, fetch only the page's ids (same where/orderBy/
  // skip/take, id-only select). Otherwise this is the original single call.
  const phase1 = useClientQueries(schema).repositoryCases.useFindMany(
    (twoPhase
      ? { ...qo, select: { id: true } }
      : queryOptions) as typeof queryOptions,
    options
  );

  const pageIds = useMemo<unknown[]>(() => {
    if (!twoPhase || !phase1.data || !Array.isArray(phase1.data)) return [];
    return (phase1.data as Array<{ id: unknown }>).map((r) => r.id);
  }, [twoPhase, phase1.data]);

  // Phase 2 — hydrate the heavy select for just this page. Gated via `enabled`
  // so both useFindMany calls always run (rules of hooks); it stays idle on the
  // single-call path and while phase 1 returns an empty page.
  const phase2Enabled =
    (options?.enabled ?? true) && twoPhase && pageIds.length > 0;
  const phase2 = useClientQueries(schema).repositoryCases.useFindMany(
    {
      where: { id: { in: pageIds } },
      orderBy: qo.orderBy,
      select: qo.select,
    } as typeof queryOptions,
    { ...options, enabled: phase2Enabled }
  );

  // The rows to post-process: phase-1 rows on the single-call path; on the
  // two-phase path, phase-2 rows re-ordered to match phase 1.
  const orderedData = useMemo(() => {
    if (!twoPhase) return phase1.data;
    // Phase 1 hasn't produced rows yet (loading) — propagate undefined.
    if (!phase1.data || !Array.isArray(phase1.data)) return phase1.data;
    // Phase 1 returned an empty page — no phase 2 to run.
    if (pageIds.length === 0) return [];
    // Phase 2 still loading — propagate undefined.
    if (!phase2.data || !Array.isArray(phase2.data)) return phase2.data;
    const byId = new Map(
      (phase2.data as Array<{ id: unknown }>).map((r) => [r.id, r])
    );
    return pageIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
  }, [twoPhase, phase1.data, phase2.data, pageIds]);

  // Extract totalCount from phase 1 (the query carrying the original `where`)
  // for dependency tracking. Only consulted in post-fetch-filter mode; in plain
  // paginated mode Cases.tsx reads the dedicated useCount instead.
  const resultTotalCount = (phase1 as any).totalCount;

  // First apply filtering (without pagination)
  const { filteredCases, totalFilteredCount } = useMemo(() => {
    if (!orderedData || !Array.isArray(orderedData)) {
      return {
        filteredCases: orderedData,
        totalFilteredCount: resultTotalCount ?? 0,
      };
    }

    // First filter orphaned field values
    let cases = orderedData.map(filterOrphanedFieldValues);

    // Apply post-fetch filters if provided
    if (postFetchFilters && postFetchFilters.length > 0) {
      cases = cases.filter((testCase: any) => {
        // Check all post-fetch filters
        for (const filter of postFetchFilters) {
          // Find the field value for this filter
          const fieldValue = testCase.caseFieldValues?.find(
            (cfv: any) => cfv.fieldId === filter.fieldId
          );

          let matches = false;

          if (filter.type === "text" && typeof filter.value1 === "string") {
            matches = matchesTextOperator(
              fieldValue?.value,
              filter.operator,
              filter.value1
            );
          } else if (
            filter.type === "link" &&
            typeof filter.value1 === "string"
          ) {
            matches = matchesLinkOperator(
              fieldValue?.value,
              filter.operator,
              filter.value1
            );
          } else if (
            filter.type === "steps" &&
            typeof filter.value1 === "number"
          ) {
            // Pass the entire testCase for built-in steps relation
            matches = matchesStepsOperator(
              testCase,
              filter.operator,
              filter.value1,
              filter.value2
            );
          }

          // If any filter doesn't match, exclude this case
          if (!matches) {
            return false;
          }
        }

        return true;
      });
    }

    // Return filtered cases and the total count (before pagination)
    const totalCount =
      postFetchFilters && postFetchFilters.length > 0
        ? cases.length
        : (resultTotalCount ?? 0);

    return { filteredCases: cases, totalFilteredCount: totalCount };
  }, [orderedData, resultTotalCount, postFetchFilters]);

  // Then apply client-side pagination if provided
  const paginatedData = useMemo(() => {
    if (!filteredCases || !Array.isArray(filteredCases)) return filteredCases;

    if (clientPagination && clientPagination.skip !== undefined) {
      const start = clientPagination.skip;
      const end = clientPagination.take
        ? start + clientPagination.take
        : undefined;
      return filteredCases.slice(start, end);
    }

    return filteredCases;
  }, [filteredCases, clientPagination]);

  // Loading is true while phase 1 runs, or (two-phase) while phase 2 hydrates a
  // non-empty page. An empty phase-1 page settles immediately (phase 2 idle).
  const isLoading =
    phase1.isLoading || (twoPhase && pageIds.length > 0 && phase2.isLoading);

  // Refetch both phases so a forced refresh re-reads ids AND re-hydrates them
  // (phase 2's query key is the page ids, which don't change when only relation
  // data changes server-side). Phase 2 is only refetched on the two-phase path.
  const refetch = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      phase1.refetch(),
      twoPhase ? phase2.refetch() : Promise.resolve(undefined),
    ]);
    return twoPhase ? r2 : r1;
    // phase1/phase2 are recreated every render; their `refetch` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase1.refetch, phase2.refetch, twoPhase]);

  return {
    ...phase1,
    data: paginatedData,
    totalCount: totalFilteredCount,
    isLoading,
    refetch,
  } as unknown as ReturnType<ZsRepoHooks["useFindMany"]> & {
    totalCount: number;
  };
}

/**
 * Wrapper around useClientQueries(schema).repositoryCases.useFindFirst that automatically filters orphaned field values
 */
export function useFindFirstRepositoryCasesFiltered(
  ...args: Parameters<ZsRepoHooks["useFindFirst"]>
) {
  const result = useClientQueries(schema).repositoryCases.useFindFirst(...args);

  const filteredData = useMemo(() => {
    if (!result.data) return result.data;
    return filterOrphanedFieldValues(result.data);
  }, [result.data]);

  return {
    ...result,
    data: filteredData,
  };
}
