import { useMemo } from "react";
import {
  useFindManyRepositoryCases,
  useFindFirstRepositoryCases,
} from "~/lib/hooks/repository-cases";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Filters out orphaned field values from a test case
 * (field values that are not part of the test case's current template)
 */
export function filterOrphanedFieldValues<T extends { template?: any; caseFieldValues?: any[] }>(
  testCase: T
): T {
  if (!testCase || !testCase.template?.caseFields || !testCase.caseFieldValues) {
    return testCase;
  }

  const templateFieldIds = new Set(
    testCase.template.caseFields.map((cf: any) => cf.caseField.id)
  );

  const filteredFieldValues = testCase.caseFieldValues.filter((cfv: any) =>
    templateFieldIds.has(cfv.fieldId)
  );

  return {
    ...testCase,
    caseFieldValues: filteredFieldValues,
  };
}

/**
 * Apply text operator filter to a string value
 */
export function matchesTextOperator(value: any, operator: string, searchValue: string): boolean {
  if (!value) return false;

  // Handle TipTap JSON documents (Text Long fields) and plain strings (Text String fields)
  let textValue: string;
  if (typeof value === 'string') {
    textValue = value;
  } else if (typeof value === 'object') {
    textValue = extractTextFromNode(value);
    if (!textValue) return false;
  } else {
    return false;
  }

  const lowerValue = textValue.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case 'contains':
      return lowerValue.includes(lowerSearch);
    case 'startsWith':
      return lowerValue.startsWith(lowerSearch);
    case 'endsWith':
      return lowerValue.endsWith(lowerSearch);
    case 'equals':
      return lowerValue === lowerSearch;
    case 'notContains':
      return !lowerValue.includes(lowerSearch);
    default:
      return false;
  }
}

/**
 * Apply link operator filter to a URL string
 */
export function matchesLinkOperator(value: any, operator: string, searchValue: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const lowerValue = value.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case 'contains':
      return lowerValue.includes(lowerSearch);
    case 'startsWith':
      return lowerValue.startsWith(lowerSearch);
    case 'endsWith':
      return lowerValue.endsWith(lowerSearch);
    case 'equals':
      return lowerValue === lowerSearch;
    case 'domain':
      // Extract domain from URL and match
      try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
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
export function matchesStepsOperator(testCase: any, operator: string, count1: number, count2?: number): boolean {
  // Check if testCase has the built-in steps relation
  const steps = testCase?.steps;
  if (!Array.isArray(steps)) return false;

  // Count steps (already filtered for non-deleted in the query)
  const stepsCount = steps.length;

  switch (operator) {
    case 'eq':
      return stepsCount === count1;
    case 'lt':
      return stepsCount < count1;
    case 'lte':
      return stepsCount <= count1;
    case 'gt':
      return stepsCount > count1;
    case 'gte':
      return stepsCount >= count1;
    case 'between':
      return count2 !== undefined && stepsCount >= count1 && stepsCount <= count2;
    default:
      return false;
  }
}

export interface PostFetchFilter {
  fieldId: number;
  type: 'text' | 'link' | 'steps';
  operator: string;
  value1?: string | number;
  value2?: number;
}

/**
 * Wrapper around useFindManyRepositoryCases that automatically filters orphaned field values
 * and applies post-fetch filtering for text/link/steps operators
 */
export function useFindManyRepositoryCasesFiltered(
  queryOptions: Parameters<typeof useFindManyRepositoryCases>[0],
  postFetchFilters?: PostFetchFilter[],
  options?: Parameters<typeof useFindManyRepositoryCases>[1],
  clientPagination?: { skip: number; take: number | undefined }
) {
  const result = useFindManyRepositoryCases(queryOptions, options);

  // First apply filtering (without pagination)
  const { filteredCases, totalFilteredCount } = useMemo(() => {
    if (!result.data || !Array.isArray(result.data)) {
      return { filteredCases: result.data, totalFilteredCount: (result as any).totalCount ?? 0 };
    }

    // First filter orphaned field values
    let cases = result.data.map(filterOrphanedFieldValues);

    // Apply post-fetch filters if provided
    if (postFetchFilters && postFetchFilters.length > 0) {
      cases = cases.filter((testCase) => {
        // Check all post-fetch filters
        for (const filter of postFetchFilters) {
          // Find the field value for this filter
          const fieldValue = testCase.caseFieldValues?.find(
            (cfv: any) => cfv.fieldId === filter.fieldId
          );

          let matches = false;

          if (filter.type === 'text' && typeof filter.value1 === 'string') {
            matches = matchesTextOperator(fieldValue?.value, filter.operator, filter.value1);
          } else if (filter.type === 'link' && typeof filter.value1 === 'string') {
            matches = matchesLinkOperator(fieldValue?.value, filter.operator, filter.value1);
          } else if (filter.type === 'steps' && typeof filter.value1 === 'number') {
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
    const totalCount = postFetchFilters && postFetchFilters.length > 0
      ? cases.length
      : (result as any).totalCount ?? 0;

    return { filteredCases: cases, totalFilteredCount: totalCount };
  }, [result.data, (result as any).totalCount, postFetchFilters]);

  // Then apply client-side pagination if provided
  const paginatedData = useMemo(() => {
    if (!filteredCases || !Array.isArray(filteredCases)) return filteredCases;

    if (clientPagination && clientPagination.skip !== undefined) {
      const start = clientPagination.skip;
      const end = clientPagination.take ? start + clientPagination.take : undefined;
      return filteredCases.slice(start, end);
    }

    return filteredCases;
  }, [filteredCases, clientPagination]);

  return {
    ...result,
    data: paginatedData,
    totalCount: totalFilteredCount,
  } as ReturnType<typeof useFindManyRepositoryCases> & { totalCount: number };
}

/**
 * Wrapper around useFindFirstRepositoryCases that automatically filters orphaned field values
 */
export function useFindFirstRepositoryCasesFiltered(
  ...args: Parameters<typeof useFindFirstRepositoryCases>
) {
  const result = useFindFirstRepositoryCases(...args);

  const filteredData = useMemo(() => {
    if (!result.data) return result.data;
    return filterOrphanedFieldValues(result.data);
  }, [result.data]);

  return {
    ...result,
    data: filteredData,
  };
}
