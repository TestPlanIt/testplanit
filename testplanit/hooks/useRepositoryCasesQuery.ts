import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  filterOrphanedFieldValues,
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "./useRepositoryCasesWithFilteredFields";

/**
 * POST read path for the repository case table
 * (`/api/projects/[projectId]/cases/query`).
 *
 * Used instead of the ZenStack GET hooks whenever the request cannot safely be
 * serialized into a URL: an active Elasticsearch search (up to 10,000 ids) or a
 * `where` clause that has grown past the GET budget (deep folder subtrees,
 * id-heavy filter predicates). Both cases produce HTTP 414 on the GET path —
 * the documented reason the fetch-many / by-folder-descendants routes exist.
 *
 * `searchCaseIds` stays OUT of the query key: the array is large and hashing it
 * on every render is pure overhead. `searchKey` — the debounced query string the
 * ids were resolved for — moves in lockstep with the array and identifies it
 * exactly, so no cache entry is ever written under a key whose ids it doesn't
 * match.
 */

interface Params {
  projectId: number;
  where?: unknown;
  /** Omit to let the server order by Elasticsearch relevance (search only). */
  orderBy?: unknown;
  /** Omit for a count-only request (the response carries `cases: null`). */
  select?: unknown;
  skip?: number;
  take?: number;
  /** Relevance-ordered id set from Elasticsearch; intersected server-side. */
  searchCaseIds?: number[];
  /** Identity of `searchCaseIds` for the query key (never the array itself). */
  searchKey?: string;
  /** Returns the full ordered id list instead of hydrated rows. */
  idsOnly?: boolean;
  enabled?: boolean;
  keepPreviousData?: boolean;
}

export interface RepositoryCasesQueryResult {
  /** Hydrated rows (post-fetch filtered and client-paginated when asked). */
  data: any[] | null | undefined;
  /** Ordered ids, for `idsOnly` requests. */
  ids: number[] | undefined;
  totalCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useRepositoryCasesQuery(
  params: Params,
  postFetchFilters?: PostFetchFilter[],
  clientPagination?: { skip: number; take: number | undefined }
): RepositoryCasesQueryResult {
  const {
    projectId,
    where,
    orderBy,
    select,
    skip,
    take,
    searchCaseIds,
    searchKey,
    idsOnly,
    enabled = true,
    keepPreviousData = true,
  } = params;

  const query = useQuery({
    queryKey: [
      "repositoryCasesQuery",
      projectId,
      where,
      orderBy,
      select,
      skip,
      take,
      searchKey ?? null,
      searchCaseIds ? searchCaseIds.length : null,
      idsOnly ?? false,
    ],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/cases/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          where,
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
        totalCount: number;
      }>;
    },
    placeholderData: keepPreviousData
      ? (previousData) => previousData
      : undefined,
    refetchOnWindowFocus: false,
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

    let cases = resultCases.map(filterOrphanedFieldValues);

    if (postFetchFilters && postFetchFilters.length > 0) {
      cases = cases.filter((testCase: any) =>
        matchesPostFetchFilters(testCase, postFetchFilters)
      );
    }

    // Text/link/steps predicates are matched in memory, so the honest total is
    // the matched row count — the server counted the SQL pre-filter only.
    const totalCount =
      postFetchFilters && postFetchFilters.length > 0
        ? cases.length
        : (resultTotalCount ?? 0);

    return { filteredCases: cases, totalFilteredCount: totalCount };
  }, [resultCases, resultTotalCount, postFetchFilters]);

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
    totalCount: totalFilteredCount,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
