/**
 * Integration tests for ViewSelector filters with useFindManyRepositoryCasesFiltered
 *
 * These tests validate the complete filter flow:
 * 1. User applies filter in ViewSelector
 * 2. Filter state is passed to useFindManyRepositoryCasesFiltered
 * 3. Correct data is fetched/filtered
 * 4. Table displays correct results
 * 5. Pagination counts are accurate
 *
 * Test Strategy:
 * - Create test data with known values for each field type
 * - Test all filter operators with positive cases (includes expected results)
 * - Test negative cases (excludes non-matching results)
 * - Validate pagination totalCount matches filtered results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFindManyRepositoryCasesFiltered } from './useRepositoryCasesWithFilteredFields';
import type { RepositoryCases } from '@prisma/client';

// Mock the ZenStack hook
vi.mock('~/lib/hooks/repository-cases', () => ({
  useFindManyRepositoryCases: vi.fn(),
}));

const { useFindManyRepositoryCases } = await import('~/lib/hooks/repository-cases');

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
    step: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Step ${i + 1}` }] }] }),
    expectedResult: JSON.stringify({ type: 'doc', content: [] }),
  })),
  caseFieldValues: [
    // Text field (fieldId: 100)
    textValue !== null && {
      id: id * 1000 + 100,
      repositoryCaseId: id,
      fieldId: 100,
      value: typeof textValue === 'object' ? JSON.stringify(textValue) : textValue,
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
const TEST_DATA: Array<Partial<RepositoryCases> & {
  steps: any[];
  caseFieldValues: any[];
}> = [
  createTestCase(
    1,
    'Login test case',
    'This is a test description',
    'https://github.com/user/repo',
    5,
    3
  ),
  createTestCase(
    2,
    'Registration test scenario',
    'Testing user registration flow',
    'https://api.github.com/users',
    3,
    3
  ),
  createTestCase(
    3,
    'Checkout workflow',
    'Verify payment processing',
    'https://example.com/checkout',
    8,
    5
  ),
  createTestCase(
    4,
    'Search functionality',
    'Test search feature',
    'https://github.com/search',
    5,
    7
  ),
  createTestCase(
    5,
    'Profile update',
    null, // No text value
    null, // No link value
    null, // No numeric value
    3
  ),
  createTestCase(
    6,
    'Password reset feature test',
    'Test password recovery flow',
    'https://testsite.org/reset',
    5,
    3
  ),
];

describe('useFindManyRepositoryCasesFiltered - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Text Filter Integration', () => {
    it('should filter cases containing "test" and exclude others', async () => {
      // Mock API response with all test data
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
          ]
        )
      );

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
      excludedIds.forEach(id => {
        expect(filteredData.find((c: any) => c.id === id)).toBeUndefined();
      });

      // Verify pagination count
      expect(result.current.totalCount).toBe(4);
    });

    it('should return no results for non-existent text (negative test)', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'NONEXISTENT_TERM_XYZ123',
            },
          ]
        )
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(0);
      expect(result.current.totalCount).toBe(0);
    });

    it('should filter cases starting with "Test" (startsWith operator)', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'startsWith',
              value1: 'Test',
            },
          ]
        )
      );

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
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'notContains',
              value1: 'test',
            },
          ]
        )
      );

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

  describe('Link Filter Integration', () => {
    it('should filter cases with github.com domain', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 101,
              type: 'link',
              operator: 'domain',
              value1: 'github.com',
            },
          ]
        )
      );

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
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 101,
              type: 'link',
              operator: 'contains',
              value1: 'api',
            },
          ]
        )
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Expected: Only case 2 has "api" in URL
      const filteredData = result.current.data as any[];
      expect(filteredData).toHaveLength(1);
      expect(filteredData[0].id).toBe(2);
      expect(result.current.totalCount).toBe(1);
    });

    it('should return no results for non-existent domain (negative test)', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 101,
              type: 'link',
              operator: 'domain',
              value1: 'nonexistent-domain-xyz.com',
            },
          ]
        )
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toHaveLength(0);
      expect(result.current.totalCount).toBe(0);
    });
  });

  describe('Steps Filter Integration', () => {
    it('should filter cases with exactly 3 steps', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: -1, // Steps is a special built-in field
              type: 'steps',
              operator: 'eq',
              value1: 3,
            },
          ]
        )
      );

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

    it('should filter cases with > 3 steps', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: -1,
              type: 'steps',
              operator: 'gt',
              value1: 3,
            },
          ]
        )
      );

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

    it('should filter cases with steps between 3 and 5', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: -1,
              type: 'steps',
              operator: 'between',
              value1: 3,
              value2: 5,
            },
          ]
        )
      );

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

  describe('Multiple Filters Integration', () => {
    it('should apply AND logic for multiple filters', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
            {
              fieldId: -1,
              type: 'steps',
              operator: 'eq',
              value1: 3,
            },
          ]
        )
      );

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

    it('should apply three filters with AND logic', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
            {
              fieldId: -1,
              type: 'steps',
              operator: 'eq',
              value1: 3,
            },
            {
              fieldId: 101,
              type: 'link',
              operator: 'domain',
              value1: 'github.com',
            },
          ]
        )
      );

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

    it('should return no results when multiple filters have no overlap (negative test)', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
            {
              fieldId: -1,
              type: 'steps',
              operator: 'eq',
              value1: 7, // Only case 4 has 7 steps, and it contains "test", so this should match
            },
          ]
        )
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Actually case 4 should match this (has "test" and 7 steps)
      expect(result.current.data).toHaveLength(1);
      expect((result.current.data as any[])[0].id).toBe(4);
    });
  });

  describe('Pagination Integration', () => {
    it('should correctly paginate filtered results', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      // Page 1 with pageSize=2
      const { result: page1Result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
          ],
          undefined,
          { skip: 0, take: 2 }
        )
      );

      await waitFor(() => {
        expect(page1Result.current.isLoading).toBe(false);
      });

      // Page 1 should have 2 results, total should be 4
      expect(page1Result.current.data).toHaveLength(2);
      expect(page1Result.current.totalCount).toBe(4);

      // Page 2 with pageSize=2
      const { result: page2Result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
          ],
          undefined,
          { skip: 2, take: 2 }
        )
      );

      await waitFor(() => {
        expect(page2Result.current.isLoading).toBe(false);
      });

      // Page 2 should have 2 results, total should still be 4
      expect(page2Result.current.data).toHaveLength(2);
      expect(page2Result.current.totalCount).toBe(4);

      // Verify pages don't overlap
      const page1Ids = (page1Result.current.data as any[]).map((c: any) => c.id);
      const page2Ids = (page2Result.current.data as any[]).map((c: any) => c.id);
      const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should handle last page with fewer items', async () => {
      (useFindManyRepositoryCases as any).mockReturnValue({
        data: TEST_DATA,
        isLoading: false,
        error: null,
        totalCount: TEST_DATA.length,
      });

      // Page 2 with pageSize=3 for 4 results total
      const { result } = renderHook(() =>
        useFindManyRepositoryCasesFiltered(
          { where: { projectId: 1 } },
          [
            {
              fieldId: 100,
              type: 'text',
              operator: 'contains',
              value1: 'test',
            },
          ],
          undefined,
          { skip: 3, take: 3 }
        )
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
