import { extractTextFromNode } from "~/utils/extractTextFromJson";

// Pure post-fetch filter matchers shared by the client table hooks
// (useRepositoryCasesWithFilteredFields / useRepositoryCasesByDescendants) and
// server code (export action, counts). Must stay importable from route
// handlers and server actions: no React, no ZenStack, no "use client".

export interface PostFetchFilter {
  fieldId: number;
  type: "text" | "link" | "steps";
  operator: string;
  value1?: string | number;
  value2?: number;
}

/**
 * Filters out orphaned field values from a test case
 * (field values that are not part of the test case's current template)
 */
export function filterOrphanedFieldValues<T>(testCase: T): T {
  const tc = testCase as any;
  if (!tc || !tc.template?.caseFields || !tc.caseFieldValues) {
    return testCase;
  }

  const templateFieldIds = new Set(
    tc.template.caseFields.map((cf: any) => cf.caseField.id)
  );

  const filteredFieldValues = tc.caseFieldValues.filter((cfv: any) =>
    templateFieldIds.has(cfv.fieldId)
  );

  return {
    ...tc,
    caseFieldValues: filteredFieldValues,
  };
}

/**
 * Apply text operator filter to a string value
 */
export function matchesTextOperator(
  value: any,
  operator: string,
  searchValue: string
): boolean {
  if (!value) return false;

  // Text Long holds a rich-text document, which the web UI stores as a JSON
  // string and other writers store as an object. Matching the raw string
  // would search the document's markup — "paragraph" or "doc" would hit every
  // case — so both shapes go through the extractor, which returns a genuine
  // plain string (a Text String field) unchanged.
  if (typeof value !== "string" && typeof value !== "object") return false;
  const textValue = extractTextFromNode(value);
  if (!textValue) return false;

  const lowerValue = textValue.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case "contains":
      return lowerValue.includes(lowerSearch);
    case "startsWith":
      return lowerValue.startsWith(lowerSearch);
    case "endsWith":
      return lowerValue.endsWith(lowerSearch);
    case "equals":
      return lowerValue === lowerSearch;
    case "notContains":
      return !lowerValue.includes(lowerSearch);
    default:
      return false;
  }
}

/**
 * Apply link operator filter to a URL string
 */
export function matchesLinkOperator(
  value: any,
  operator: string,
  searchValue: string
): boolean {
  if (!value || typeof value !== "string") return false;
  const lowerValue = value.toLowerCase();
  const lowerSearch = searchValue.toLowerCase();

  switch (operator) {
    case "contains":
      return lowerValue.includes(lowerSearch);
    case "startsWith":
      return lowerValue.startsWith(lowerSearch);
    case "endsWith":
      return lowerValue.endsWith(lowerSearch);
    case "equals":
      return lowerValue === lowerSearch;
    case "domain":
      // Extract domain from URL and match
      try {
        const url = new URL(
          value.startsWith("http") ? value : `https://${value}`
        );
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
export function matchesStepsOperator(
  testCase: any,
  operator: string,
  count1: number,
  count2?: number
): boolean {
  // Check if testCase has the built-in steps relation
  const steps = testCase?.steps;
  if (!Array.isArray(steps)) return false;

  // Count steps (already filtered for non-deleted in the query)
  const stepsCount = steps.length;

  switch (operator) {
    case "eq":
      return stepsCount === count1;
    case "lt":
      return stepsCount < count1;
    case "lte":
      return stepsCount <= count1;
    case "gt":
      return stepsCount > count1;
    case "gte":
      return stepsCount >= count1;
    case "between":
      return (
        count2 !== undefined && stepsCount >= count1 && stepsCount <= count2
      );
    default:
      return false;
  }
}

/**
 * All-must-match pipeline over a test case: every filter has to match or the
 * case is excluded. This is the single row-selection predicate for text/link/
 * steps operator filters — table hooks and export must go through it so their
 * row sets cannot drift.
 */
export function matchesPostFetchFilters(
  testCase: any,
  postFetchFilters: PostFetchFilter[]
): boolean {
  // Check all post-fetch filters
  for (const filter of postFetchFilters) {
    // Find the field value for this filter
    const fieldValue = testCase.caseFieldValues?.find(
      (cfv: any) => cfv.fieldId === filter.fieldId
    );

    let matches = false;

    if (filter.type === "text" && typeof filter.value1 === "string") {
      matches = matchesTextOperator(
        fieldValue?.value,
        filter.operator,
        filter.value1
      );
    } else if (filter.type === "link" && typeof filter.value1 === "string") {
      matches = matchesLinkOperator(
        fieldValue?.value,
        filter.operator,
        filter.value1
      );
    } else if (filter.type === "steps" && typeof filter.value1 === "number") {
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
}
