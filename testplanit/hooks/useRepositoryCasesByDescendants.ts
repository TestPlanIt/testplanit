import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  filterOrphanedFieldValues,
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "./useRepositoryCasesWithFilteredFields";

interface Params {
  projectId: number;
  folderId: number;
  where?: unknown;
  orderBy?: unknown;
  select?: unknown;
  skip?: number;
  take?: number;
  enabled?: boolean;
  keepPreviousData?: boolean;
}

// Parallel to useFindManyRepositoryCasesFiltered but fetches via POST so a deep
// folder tree doesn't blow up the URI length. The server resolves descendant
// folder IDs from the single root folderId via a recursive CTE.
export function useFindManyRepositoryCasesByDescendants(
  params: Params,
  postFetchFilters?: PostFetchFilter[],
  clientPagination?: { skip: number; take: number | undefined }
) {
  const {
    projectId,
    folderId,
    where,
    orderBy,
    select,
    skip,
    take,
    enabled = true,
    keepPreviousData = true,
  } = params;

  const query = useQuery({
    queryKey: [
      "repositoryCasesByDescendants",
      projectId,
      folderId,
      where,
      orderBy,
      select,
      skip,
      take,
    ],
    enabled,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/cases/by-folder-descendants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderId,
            where,
            orderBy,
            select,
            skip,
            take,
          }),
        }
      );
      if (!res.ok) {
        throw new Error(
          `Failed to fetch repository cases by descendants (status ${res.status})`
        );
      }
      return res.json() as Promise<{
        cases: unknown[] | null;
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
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    totalCount: totalFilteredCount,
  };
}
