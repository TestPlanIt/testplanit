import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { TestRunCaseDetail } from "~/lib/services/testRunCaseDetail";
import { filterOrphanedFieldValues } from "./useRepositoryCasesWithFilteredFields";

interface CaseDetailResponse {
  testcase: TestRunCaseDetail | null;
  error?: string;
}

/**
 * Loads one case's full result-panel detail from the server route backed by
 * lib/services/testRunCaseDetail.ts, instead of the policy-enforced ZenStack
 * client hook this replaces (see that file for why -- prod mean 10.6s / max
 * 65s per call). Both `TestRunCaseDetails` and the run page's own
 * "did the next case load yet" check call this with the same
 * `(caseId, testRunId)` pair, so React Query dedupes them into one request.
 *
 * `filterOrphanedFieldValues` is applied here (same as the hook this
 * replaces) to keep dropping caseFieldValues whose field isn't part of the
 * case's current template.
 */
export function useTestRunCaseDetail(
  caseId: number | null | undefined,
  testRunId?: number | null
) {
  const query = useQuery({
    queryKey: ["test-run-case-detail", caseId ?? null, testRunId ?? null],
    queryFn: async (): Promise<TestRunCaseDetail | null> => {
      const params = new URLSearchParams({ caseId: String(caseId) });
      if (testRunId != null) {
        params.set("testRunId", String(testRunId));
      }
      const response = await fetch(`/api/test-runs/case-detail?${params}`);
      const payload = (await response
        .json()
        .catch(() => null)) as CaseDetailResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load case detail");
      }
      return payload?.testcase ?? null;
    },
    enabled: caseId != null,
  });

  const data = useMemo(() => {
    if (!query.data) return query.data;
    return filterOrphanedFieldValues(query.data);
  }, [query.data]);

  return { ...query, data };
}
