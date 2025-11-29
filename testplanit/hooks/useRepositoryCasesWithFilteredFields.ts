import { useMemo } from "react";
import {
  useFindManyRepositoryCases,
  useFindFirstRepositoryCases,
} from "~/lib/hooks/repository-cases";

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
 * Wrapper around useFindManyRepositoryCases that automatically filters orphaned field values
 */
export function useFindManyRepositoryCasesFiltered(
  ...args: Parameters<typeof useFindManyRepositoryCases>
) {
  const result = useFindManyRepositoryCases(...args);

  const filteredData = useMemo(() => {
    if (!result.data || !Array.isArray(result.data)) return result.data;
    return result.data.map(filterOrphanedFieldValues);
  }, [result.data]);

  return {
    ...result,
    data: filteredData,
  };
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
