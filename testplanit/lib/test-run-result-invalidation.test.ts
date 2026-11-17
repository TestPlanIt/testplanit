import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateAfterResultSubmit } from "./test-run-result-invalidation";

function seed(queryClient: QueryClient, keys: unknown[][]) {
  for (const queryKey of keys) {
    queryClient.setQueryData(queryKey, { seeded: true });
  }
}

function isInvalidated(queryClient: QueryClient, queryKey: unknown[]) {
  return queryClient.getQueryCache().find({ queryKey })?.isStale() ?? false;
}

describe("invalidateAfterResultSubmit", () => {
  it("marks the result-bearing queries stale and leaves page configuration alone", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    const resultKeys: unknown[][] = [
      ["zenstack", "TestRunResults", { where: { testRunCaseId: 1 } }],
      ["zenstack", "TestRunCases", { where: { id: 1 } }],
      ["zenstack", "TestRunStepResults", {}],
      ["zenstack", "TestRuns", { where: { id: 9 } }],
      ["zenstack", "TestRunCaseIteration", {}],
      ["zenstack", "RepositoryCases", { where: { id: 92087 } }],
      ["zenstack", "ResultFieldValues", {}],
      ["zenstack", "Attachments", {}],
      ["zenstack", "Issue", {}],
      ["testRunSummary", 9],
      ["batchTestRunSummaries", [9]],
      ["test-run-case-detail", 92087, 9],
      ["testRunExecutions", 9],
      ["latestTestResults", "k", 5],
      ["milestoneSummary", 3],
    ];
    const untouchedKeys: unknown[][] = [
      ["zenstack", "AppConfig", {}],
      ["zenstack", "UserPreferences", {}],
      ["zenstack", "Projects", {}],
      ["zenstack", "Workflows", {}],
      ["zenstack", "Templates", {}],
      ["zenstack", "Status", {}],
      ["userPermissions", 9, "user-1", "TestRunResults"],
      ["repositoryCasesQuery", 9],
    ];
    seed(queryClient, [...resultKeys, ...untouchedKeys]);

    await invalidateAfterResultSubmit(queryClient);

    for (const key of resultKeys) {
      expect(isInvalidated(queryClient, key), JSON.stringify(key)).toBe(true);
    }
    for (const key of untouchedKeys) {
      expect(isInvalidated(queryClient, key), JSON.stringify(key)).toBe(false);
    }
  });
});
