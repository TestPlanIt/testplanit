import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import {
  fetchRepositoryCasesWithLastResult,
  countRepositoryCasesWithLastResult,
  FetchCasesWithLastResultArgs,
  FetchCasesWithLastResultResponse,
} from "~/app/actions/repositoryCasesWithLastResult";
import { Prisma } from "@prisma/client";

/**
 * React Query hook for fetching repository cases with computed last test result.
 * This hook wraps the server action and provides caching, refetching, and loading states.
 *
 * @param args - Query arguments for filtering, sorting, and pagination
 * @param options - Additional React Query options
 * @returns Query result with data, loading state, and refetch function
 */
export function useRepositoryCasesWithLastResult(
  args: FetchCasesWithLastResultArgs,
  options?: Omit<
    UseQueryOptions<FetchCasesWithLastResultResponse, Error, any[]>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: ["repositoryCasesWithLastResult", args],
    queryFn: () => fetchRepositoryCasesWithLastResult(args),
    select: (response) => (response.success ? response.data : []),
    ...options,
  });
}

/**
 * React Query hook for counting repository cases.
 * Used for pagination when sorting by lastTestResult.
 *
 * @param where - Prisma where clause for filtering cases
 * @param options - Additional React Query options
 * @returns Query result with count
 */
export function useCountRepositoryCasesWithLastResult(
  where: Prisma.RepositoryCasesWhereInput,
  options?: Omit<
    UseQueryOptions<
      { success: true; count: number } | { success: false; error: string; count: 0 },
      Error,
      number
    >,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: ["countRepositoryCasesWithLastResult", where],
    queryFn: () => countRepositoryCasesWithLastResult(where),
    select: (response) => response.count,
    ...options,
  });
}
