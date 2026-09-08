/**
 * Integration tests for FilterBar predicates flowing through
 * useFindManyRepositoryCasesFiltered.
 *
 * These tests validate the complete filter flow as Cases.tsx wires it:
 * 1. FilterBar produces FilterPredicate[] (dimension/operator/values)
 * 2. compileRepoPredicates compiles the SQL half (where fragments, AND'd with
 *    the base conditions); text/link operator predicates compile to their
 *    value-not-null pre-filter only, steps count operators to no fragment
 * 3. extractPostFetchFilters carries the in-memory half to the hook
 * 4. The hook post-fetch-filters the fetched rows and reports totalCount
 * 5. Client-side pagination slices the filtered set
 *
 * Test Strategy:
 * - Create test data with known values for each field type
 * - Test all post-fetch operators with positive cases (includes expected
 *   results) and negative cases (excludes non-matching results)
 * - Validate pagination totalCount matches filtered results
 */

import type { RepositoryCases } from "~/zenstack/models";
import { JsonNull } from "@zenstackhq/orm";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  compileRepoPredicates,
  extractPostFetchFilters,
} from "~/lib/repository/filterWhereCompiler";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { useFindManyRepositoryCasesFiltered } from "./useRepositoryCasesWithFilteredFields";

// The wrapper reads useClientQueries(schema).repositoryCases.useFindMany; hoist
// it so tests can drive it via mockReturnValue (previously imported from the
// now-removed ~/lib/hooks/repository-cases).
const { useFindManyRepositoryCases } = vi.hoisted(() => ({
  useFindManyRepositoryCases: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useFindMany: useFindManyRepositoryCases },
  }),
}));

// Registry matching the dynamic fields the fixtures use: 100 = Text Long,
// 101 = Link, 3 = Steps (dimension keys field_100 / field_101 / field_3).
const registry = buildFilterDimensions({
  dynamicFields: [
    { fieldId: 100, type: "Text Long" },
    { fieldId: 101, type: "Link" },
    { fieldId: 3, type: "Steps" },
  ],
});

/**
 * Renders the hook exactly as Cases.tsx feeds it: predicates compile to where
 * fragments AND'd with the base conditions, and to the post-fetch filter list.
 */
function renderFiltered(
  predicates: FilterPredicate[],
  clientPagination?: { skip: number; take: number | undefined }
) {
  const where = {
    AND: [{ projectId: 1 }, ...compileRepoPredicates(predicates, registry)],
  };
  const postFetchFilters = extractPostFetchFilters(predicates, registry);
  return renderHook(() =>
    useFindManyRepositoryCasesFiltered(
      { where } as any,
      postFetchFilters.length > 0 ? postFetchFilters : undefined,
      undefined,
      clientPagination
    )
  );
}

// Test data setup - known values for comprehensive testing
const createTestCase = (
  id: number,
  name: string,
  textValue: string | null,
  linkValue: string | null,
  numericValue: number | null,
  stepCount: number
): Partial<RepositoryCases> & {
  steps: any[];
  caseFieldValues: any[];
} => ({
  id,
  name,
  projectId: 1,
  repositoryId: 1,
  folderId: 1,
  templateId: 1,
  stateId: 1,
  steps: Array.from({ length: stepCount }, (_, i) => ({
    id: id * 100 + i,
    testCaseId: id,
    order: i,
    step: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Step ${i + 1}` }],
        },
      ],
    }),
    expectedResult: JSON.stringify({ type: "doc", content: [] }),
  })),
  caseFieldValues: [
    // Text field (fieldId: 100)
    textValue !== null && {
      id: id * 1000 + 100,
      repositoryCaseId: id,
      fieldId: 100,
      value:
        typeof textValue === "object" ? JSON.stringify(textValue) : textValue,
    },
    // Link field (fieldId: 101)
    linkValue !== null && {
      id: id * 1000 + 101,
      repositoryCaseId: id,
      fieldId: 101,
      value: linkValue,
    },
    // Numeric field (fieldId: 102)
    numericValue !== null && {
      id: id * 1000 + 102,
      repositoryCaseId: id,
      fieldId: 102,
      value: String(numericValue),
    },
  ].filter(Boolean),
});

// Test data matching our unit test scenarios
const TEST_DATA: Array<
  Partial<RepositoryCases> & {
    steps: any[];
    caseFieldValues: any[];
  }
> = [
  createTestCase(
    1,
    "Login test case",
    "This is a test description",
    "https://github.com/user/repo",
    5,
    3
  ),
  createTestCase(
    2,
    "Registration test scenario",
    "Testing user registration flow",
    "https://api.github.com/users",
    3,
    3
  ),
  createTestCase(
    3,
    "Checkout workflow",
    "Verify payment processing",
    "https://example.com/checkout",
    8,
    5
  ),
  createTestCase(
    4,
    "Search functionality",
    "Test search feature",
    "https://github.com/search",
    5,
    7
  ),
  createTestCase(
    5,
    "Profile update",
    null, // No text value
    null, // No link value
    null, // No numeric value
    3
  ),
  createTestCase(
    6,
    "Password reset feature test",
    "Test password recovery flow",
    "https://testsite.org/reset",
    5,
    3
  ),
];

describe("useFindManyRepositoryCasesFiltered - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock API response with all test data
    (useFindManyRepositoryCases as any).mockReturnValue({
      data: TEST_DATA,
      isLoading: false,
      error: null,
      totalCount: TEST_DATA.length,
    });
  });

  describe("Text Filter Integration", () => {
    it('should filter cases containing "test" and exclude others', async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "contains", values: ["test"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2, 4, 6 contain "test" in text field
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(4);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2, 4, 6]);

      // Verify excluded cases
      const excludedIds = [3, 5]; // "Checkout workflow" (no "test"), "Profile update" (null text)
      excludedIds.forEach((id) => {
        expect(filteredData.find((c: any) => c.id === id)).toBeUndefined();
      });

      // Verify pagination count
      expect(result.current.totalCount).toBe(4);
    });

    it("should pass the SQL pre-filter half (value not null) through to the query", async () => {
      renderFiltered([
        { dimension: "field_100", operator: "contains", values: ["test"] },
      ]);

      // The operator itself resolves post-fetch; the where carries only the
      // value-not-null pre-filter compiled from the same predicate.
      expect(useFindManyRepositoryCases).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { projectId: 1 },
              {
                caseFieldValues: {
                  some: { fieldId: 100, value: { not: JsonNull } },
                },
              },
            ],
          },
        }),
        undefined
      );
    });

    it("should return no results for non-existent text (negative test)", async () => {
      const { result } = renderFiltered([
        {
          dimension: "field_100",
          operator: "contains",
          values: ["NONEXISTENT_TERM_XYZ123"],
        },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(0);
      expect(result.current.totalCount).toBe(0);
    });

    it('should filter cases starting with "Test" (startsWith operator)', async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "startsWith", values: ["Test"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 2, 4, 6 start with "Test"
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(3);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([2, 4, 6]);
      expect(result.current.totalCount).toBe(3);
    });

    it('should filter cases NOT containing "test" (notContains operator)', async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "notContains", values: ["test"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Only case 3 doesn't contain "test" (case 5 has null text so it doesn't match)
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(1);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([3]);
      expect(result.current.totalCount).toBe(1);
    });
  });

  describe("Link Filter Integration", () => {
    it("should filter cases with github.com domain", async () => {
      const { result } = renderFiltered([
        { dimension: "field_101", operator: "domain", values: ["github.com"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2, 4 have github.com domain
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(3);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2, 4]);
      expect(result.current.totalCount).toBe(3);
    });

    it('should filter cases with URL containing "api"', async () => {
      const { result } = renderFiltered([
        { dimension: "field_101", operator: "contains", values: ["api"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Only case 2 has "api" in URL
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(1);
      expect(filteredData[0].id).toBe(2);
      expect(result.current.totalCount).toBe(1);
    });

    it("should return no results for non-existent domain (negative test)", async () => {
      const { result } = renderFiltered([
        {
          dimension: "field_101",
          operator: "domain",
          values: ["nonexistent-domain-xyz.com"],
        },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(0);
      expect(result.current.totalCount).toBe(0);
    });
  });

  describe("Steps Filter Integration", () => {
    it("should filter cases with exactly 3 steps", async () => {
      const { result } = renderFiltered([
        { dimension: "field_3", operator: "eq", values: [3] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2, 5, 6 have exactly 3 steps
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(4);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2, 5, 6]);
      expect(result.current.totalCount).toBe(4);
    });

    it("compiles no SQL fragment for step-count operators (post-fetch only)", async () => {
      renderFiltered([{ dimension: "field_3", operator: "eq", values: [3] }]);

      // Count comparisons have no SQL pre-filter (legacy parity): the where
      // carries only the base conditions.
      expect(useFindManyRepositoryCases).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ projectId: 1 }] } }),
        undefined
      );
    });

    it("should filter cases with > 3 steps", async () => {
      const { result } = renderFiltered([
        { dimension: "field_3", operator: "gt", values: [3] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 3, 4 have > 3 steps (5 and 7 steps)
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(2);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([3, 4]);
      expect(result.current.totalCount).toBe(2);
    });

    it("should filter cases with steps between 3 and 5", async () => {
      const { result } = renderFiltered([
        { dimension: "field_3", operator: "between", values: [3, 5] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2, 3, 5, 6 have steps in range [3, 5]
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(5);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2, 3, 5, 6]);
      expect(result.current.totalCount).toBe(5);
    });
  });

  describe("Multiple Filters Integration", () => {
    it("should apply AND logic for multiple predicates", async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "contains", values: ["test"] },
        { dimension: "field_3", operator: "eq", values: [3] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2, 6 have BOTH "test" AND 3 steps
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(3);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2, 6]);
      expect(result.current.totalCount).toBe(3);
    });

    it("should apply three predicates with AND logic", async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "contains", values: ["test"] },
        { dimension: "field_3", operator: "eq", values: [3] },
        { dimension: "field_101", operator: "domain", values: ["github.com"] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Cases 1, 2 have "test" AND 3 steps AND github.com domain
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(2);

      const ids = filteredData.map((c: any) => c.id).sort();
      expect(ids).toEqual([1, 2]);
      expect(result.current.totalCount).toBe(2);
    });

    it("should intersect predicates down to a single matching case", async () => {
      const { result } = renderFiltered([
        { dimension: "field_100", operator: "contains", values: ["test"] },
        // Only case 4 has 7 steps, and it contains "test", so this matches it
        { dimension: "field_3", operator: "eq", values: [7] },
      ]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(1);
      expect((result.current.data as any[])[0].id).toBe(4);
    });
  });

  describe("Pagination Integration", () => {
    it("should correctly paginate filtered results", async () => {
      const textContainsTest: FilterPredicate = {
        dimension: "field_100",
        operator: "contains",
        values: ["test"],
      };

      // Page 1 with pageSize=2
      const { result: page1Result } = renderFiltered([textContainsTest], {
        skip: 0,
        take: 2,
      });

      await waitFor(() => {
        expect(page1Result.current.isLoading).toBe(false);
      });

      // Page 1 should have 2 results, total should be 4
      expect(page1Result.current.data).toHaveLength(2);
      expect(page1Result.current.totalCount).toBe(4);

      // Page 2 with pageSize=2
      const { result: page2Result } = renderFiltered([textContainsTest], {
        skip: 2,
        take: 2,
      });

      await waitFor(() => {
        expect(page2Result.current.isLoading).toBe(false);
      });

      // Page 2 should have 2 results, total should still be 4
      expect(page2Result.current.data).toHaveLength(2);
      expect(page2Result.current.totalCount).toBe(4);

      // Verify pages don't overlap
      const page1Ids = (page1Result.current.data as any[]).map(
        (c: any) => c.id
      );
      const page2Ids = (page2Result.current.data as any[]).map(
        (c: any) => c.id
      );
      const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it("should handle last page with fewer items", async () => {
      // Page 2 with pageSize=3 for 4 results total
      const { result } = renderFiltered(
        [{ dimension: "field_100", operator: "contains", values: ["test"] }],
        { skip: 3, take: 3 }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Page 2 should have only 1 result (4 total, 3 per page)
      expect(result.current.data).toHaveLength(1);
      expect(result.current.totalCount).toBe(4);
    });
  });
});
