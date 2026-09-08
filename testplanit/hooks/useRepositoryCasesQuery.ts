import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { serializeWhereForTransport } from "~/lib/repository/whereTransport";
import {
  filterOrphanedFieldValues,
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "./useRepositoryCasesWithFilteredFields";

/**
 * The ONE read path for the case table, in both of its modes
 * (`/api/projects/[projectId]/cases/query`).
 *
 * Repository mode reads RepositoryCases; run mode (`testRunIds` present) reads
 * TestRunCases with the repository predicate nested under `repositoryCase`.
 * Both go through this hook, and the list, the count and the id list all come
 * from the same route — the reason the transport was unified. While the table
 * could pick between a ZenStack GET hook and this route, the list query and the
 * count query each made that choice independently, and any divergence rendered
 * rows and a total that disagreed.
 *
 * `searchCaseIds` stays OUT of the query key: the array is large and hashing it
 * on every render is pure overhead. `searchKey` — the debounced query string the
 * ids were resolved for — moves in lockstep with the array and identifies it
 * exactly, so no cache entry is ever written under a key whose ids it doesn't
 * match. `select` stays out for the same reason (it is kilobytes of constant
 * shape); callers pass a short stable `selectKey` naming the shape instead.
 *
 * CACHE INVALIDATION: a plain useQuery is outside ZenStack's model-keyed query
 * graph, so ZenStack mutations do NOT invalidate it for free the way they did
 * the GET hooks. `useRepositoryCasesInvalidation` below restores that property
 * centrally — see its doc comment.
 */

/** Root segment every query key produced here starts with. */
export const REPOSITORY_CASES_QUERY_ROOT = "repositoryCasesQuery";

/**
 * Window event any non-ZenStack mutation path (raw fetch, server action,
 * import/AI wizards) dispatches after it changes the case list.
 */
export const REPOSITORY_CASES_CHANGED_EVENT = "repositoryCasesChanged";

/**
 * ZenStack models whose invalidation must also refresh the case list. Used only
 * by the query-cache mirror seam (a manual `queryClient.invalidateQueries`
 * cannot be observed any other way); the mutation-cache seam is unconditional
 * and needs no list.
 */
const CASE_LIST_MODELS = new Set([
  "RepositoryCases",
  "TestRunCases",
  "TestRuns",
  "RepositoryFolders",
  "CaseTags",
  "CaseIssues",
  "CaseFieldValues",
  "Steps",
  "Tags",
  "Issues",
  "Attachments",
  "Comments",
  "ReviewRequest",
]);

/** Prefix ZenStack writes at the head of every one of its query keys. */
const ZENSTACK_QUERY_KEY_PREFIX = "zenstack";

export interface RepositoryCasesQueryKeyInput {
  projectId: number;
  /** Run mode: the runs whose TestRunCases rows are being read. */
  testRunIds?: number[];
  where?: unknown;
  /** Run mode: the repository predicate, nested under `repositoryCase`. */
  repositoryCaseWhere?: unknown;
  orderBy?: unknown;
  /**
   * Short stable name of the `select` shape ("list", "ids", "selectAll:9,12").
   * The select itself is deliberately not part of the key.
   */
  selectKey?: string | null;
  skip?: number;
  take?: number;
  /** Identity of `searchCaseIds` — never the array itself. */
  searchKey?: string | null;
  idsOnly?: boolean;
}

/**
 * Canonical key for a case-list request: project, run scope, predicates, folder
 * scope (which travels inside `where`), sort, page and search identity. Every
 * caller builds its key here so the invalidation seam can match them all by
 * prefix and so two callers asking the same question share one cache entry.
 */
export function repositoryCasesQueryKey(
  input: RepositoryCasesQueryKeyInput
): unknown[] {
  return [
    REPOSITORY_CASES_QUERY_ROOT,
    input.projectId,
    input.testRunIds ?? null,
    input.where ?? null,
    input.repositoryCaseWhere ?? null,
    input.orderBy ?? null,
    input.selectKey ?? null,
    input.skip ?? null,
    input.take ?? null,
    input.searchKey ?? null,
    input.idsOnly ?? false,
  ];
}

/**
 * Mark every case-list query stale and refetch the active ones. This is the
 * single entry point — callers never reach for an individual `refetch`.
 */
export function invalidateRepositoryCasesQueries(
  queryClient: QueryClient
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: [REPOSITORY_CASES_QUERY_ROOT],
  });
}

/**
 * Announce a case-list change from a path React Query cannot see (a raw fetch
 * to a bulk route, a server action, a wizard). Prefer this over dispatching the
 * event by hand so the event name has exactly one definition.
 */
export function notifyRepositoryCasesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPOSITORY_CASES_CHANGED_EVENT));
}

/**
 * Keeps the case list fresh after ANY mutation, without each mutation site
 * having to remember to say so.
 *
 * The GET hooks this route replaced were model-keyed, so ZenStack invalidated
 * them automatically. A `useQuery` is outside that graph, so the property is
 * rebuilt here from three seams — mount this hook once next to the list:
 *
 *  1. MUTATION CACHE (unconditional). Every settled-successful mutation in the
 *     app invalidates the list. This is the seam that cannot be forgotten: a
 *     new `useCreate`/`useUpdate`/`useDelete` call site anywhere is covered the
 *     moment it is written, with no registration step. It over-invalidates
 *     (saving an unrelated setting refetches the list) — deliberately, because
 *     the failure mode it trades away is a silently stale table.
 *  2. QUERY CACHE MIRROR. Some paths bypass mutation hooks entirely and call
 *     `queryClient.invalidateQueries` themselves after a server action (the
 *     inline Add Case form does exactly this). Those are observed by watching
 *     for an `invalidate` action landing on any ZenStack query key whose model
 *     is in CASE_LIST_MODELS. This seam only fires while such a query is in the
 *     cache to receive it — the project-wide `repositoryCases.useCount` on the
 *     repository page is that anchor.
 *  3. WINDOW EVENT. `repositoryCasesChanged`, dispatched by the raw-fetch flows
 *     (bulk delete, import wizard, AI generation) that touch neither cache.
 *
 * Bursts are coalesced into one invalidation, so a drag-reorder that issues one
 * update per row still refetches once.
 *
 * Returns the manual invalidator for the handful of places that know they just
 * changed something and want the list refreshed now (a bulk-edit modal closing,
 * a failed reorder rolling back).
 */
export function useRepositoryCasesInvalidation(): () => Promise<void> {
  const queryClient = useQueryClient();

  useEffect(() => {
    let scheduled = false;
    let cancelled = false;

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (cancelled) return;
        void invalidateRepositoryCasesQueries(queryClient);
      });
    };

    // Seam 1 — every successful mutation, whatever model it touched.
    const unsubscribeMutations = queryClient
      .getMutationCache()
      .subscribe((event) => {
        if (event?.type !== "updated") return;
        if ((event.action as { type?: string } | undefined)?.type !== "success")
          return;
        schedule();
      });

    // Seam 2 — a ZenStack query for a case-list model being invalidated by
    // hand. Our own keys are not ZenStack keys, so this cannot self-trigger.
    const unsubscribeQueries = queryClient
      .getQueryCache()
      .subscribe((event) => {
        if (event?.type !== "updated") return;
        if (
          (event.action as { type?: string } | undefined)?.type !== "invalidate"
        )
          return;
        const key = event.query?.queryKey;
        if (!Array.isArray(key) || key[0] !== ZENSTACK_QUERY_KEY_PREFIX) return;
        if (!CASE_LIST_MODELS.has(String(key[1]))) return;
        schedule();
      });

    // Seam 3 — the raw-fetch flows.
    const handleChanged = () => schedule();
    window.addEventListener(REPOSITORY_CASES_CHANGED_EVENT, handleChanged);

    return () => {
      cancelled = true;
      unsubscribeMutations();
      unsubscribeQueries();
      window.removeEventListener(REPOSITORY_CASES_CHANGED_EVENT, handleChanged);
    };
  }, [queryClient]);

  return useCallback(
    () => invalidateRepositoryCasesQueries(queryClient),
    [queryClient]
  );
}

interface Params extends RepositoryCasesQueryKeyInput {
  /** Omit for a count-only request (the response carries `cases: null`). */
  select?: unknown;
  /** Relevance-ordered CASE id set from Elasticsearch; intersected server-side. */
  searchCaseIds?: number[];
  enabled?: boolean;
  keepPreviousData?: boolean;
  /** Run rows carry other people's live results; the repository list does not. */
  refetchOnWindowFocus?: boolean;
}

export interface RepositoryCasesQueryResult {
  /** Hydrated rows (post-fetch filtered and client-paginated when asked). */
  data: any[] | null | undefined;
  /** Ordered ROW ids, for `idsOnly` requests. */
  ids: number[] | undefined;
  /** Run mode `idsOnly`: the case id parallel to each row id. */
  caseIds: number[] | undefined;
  totalCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  /** Refetch just this query. Prefer `invalidateRepositoryCasesQueries`. */
  refetch: () => void;
}

export function useRepositoryCasesQuery(
  params: Params,
  postFetchFilters?: PostFetchFilter[],
  clientPagination?: { skip: number; take: number | undefined }
): RepositoryCasesQueryResult {
  const {
    projectId,
    testRunIds,
    where,
    repositoryCaseWhere,
    orderBy,
    selectKey,
    select,
    skip,
    take,
    searchCaseIds,
    searchKey,
    idsOnly,
    enabled = true,
    keepPreviousData = true,
    refetchOnWindowFocus = false,
  } = params;

  const runMode = testRunIds !== undefined;

  const query = useQuery({
    queryKey: repositoryCasesQueryKey({
      projectId,
      testRunIds,
      where,
      repositoryCaseWhere,
      orderBy,
      selectKey,
      skip,
      take,
      searchKey,
      idsOnly,
    }),
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/cases/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Json-null sentinels are class instances; they go over the wire in
          // their plain brand form and the route rebuilds them (whereTransport).
          where: serializeWhereForTransport(where),
          testRunIds,
          repositoryCaseWhere: serializeWhereForTransport(repositoryCaseWhere),
          orderBy,
          select,
          skip,
          take,
          searchCaseIds,
          idsOnly,
        }),
      });
      if (!res.ok) {
        throw new Error(
          `Failed to query repository cases (status ${res.status})`
        );
      }
      return res.json() as Promise<{
        cases?: unknown[] | null;
        ids?: number[];
        caseIds?: number[];
        totalCount: number;
      }>;
    },
    // Previous rows are shown only while THIS query is allowed to answer. A
    // gated-off query (an empty folder answered without asking, an unresolved
    // search, a run with no runs) has no answer of its own, and a placeholder
    // would put the last key's rows under the new key's question — selecting a
    // folder emptied of its last case would still show that case.
    placeholderData:
      keepPreviousData && enabled ? (previousData) => previousData : undefined,
    refetchOnWindowFocus,
  });

  const resultCases = query.data?.cases as any[] | null | undefined;
  const resultTotalCount = query.data?.totalCount;

  const { filteredCases, totalFilteredCount } = useMemo(() => {
    if (!resultCases || !Array.isArray(resultCases)) {
      return {
        filteredCases: resultCases ?? undefined,
        totalFilteredCount: resultTotalCount ?? 0,
      };
    }

    // In run mode the case a matcher reads hangs off the row as
    // `repositoryCase`; in repository mode the row IS the case.
    let cases = runMode
      ? resultCases.map((row: any) =>
          row?.repositoryCase
            ? {
                ...row,
                repositoryCase: filterOrphanedFieldValues(row.repositoryCase),
              }
            : row
        )
      : resultCases.map(filterOrphanedFieldValues);

    if (postFetchFilters && postFetchFilters.length > 0) {
      cases = cases.filter((row: any) =>
        matchesPostFetchFilters(
          runMode ? (row?.repositoryCase ?? row) : row,
          postFetchFilters
        )
      );
    }

    // Text/link/steps predicates are matched in memory, so the honest total is
    // the matched row count — the server counted the SQL pre-filter only.
    const totalCount =
      postFetchFilters && postFetchFilters.length > 0
        ? cases.length
        : (resultTotalCount ?? 0);

    return { filteredCases: cases, totalFilteredCount: totalCount };
  }, [resultCases, resultTotalCount, postFetchFilters, runMode]);

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

  return {
    data: paginatedData,
    ids: query.data?.ids,
    caseIds: query.data?.caseIds,
    totalCount: totalFilteredCount,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
