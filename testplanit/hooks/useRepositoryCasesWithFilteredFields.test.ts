import { describe, expect, it, vi } from "vitest";

// Mock the React Query hooks to avoid import errors
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useFindMany: vi.fn(), useFindFirst: vi.fn() },
  }),
}));

import * as pureModule from "~/lib/repositoryCaseFieldMatchers";
import * as hookModule from "./useRepositoryCasesWithFilteredFields";

// Behavioral coverage for the matchers lives next to their implementation in
// lib/repositoryCaseFieldMatchers.test.ts. This file guards the compat
// re-exports: existing consumers import the matchers from this hook module,
// and those imports must keep resolving to the pure module's functions.
describe("useRepositoryCasesWithFilteredFields re-exports", () => {
  it("re-exports the pure matcher functions unchanged", () => {
    expect(hookModule.filterOrphanedFieldValues).toBe(
      pureModule.filterOrphanedFieldValues
    );
    expect(hookModule.matchesTextOperator).toBe(pureModule.matchesTextOperator);
    expect(hookModule.matchesLinkOperator).toBe(pureModule.matchesLinkOperator);
    expect(hookModule.matchesStepsOperator).toBe(
      pureModule.matchesStepsOperator
    );
    expect(hookModule.matchesPostFetchFilters).toBe(
      pureModule.matchesPostFetchFilters
    );
  });

  it("still exports the hook wrappers", () => {
    expect(typeof hookModule.useFindManyRepositoryCasesFiltered).toBe(
      "function"
    );
    expect(typeof hookModule.useFindFirstRepositoryCasesFiltered).toBe(
      "function"
    );
  });
});
