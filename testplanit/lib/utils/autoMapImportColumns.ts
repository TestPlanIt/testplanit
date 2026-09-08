export interface MappableField {
  id: string;
  displayName: string;
  isRequired: boolean;
  type: string;
  description?: string;
}

export interface ColumnMapping {
  csvColumn: string;
  templateField: string | null;
}

// Header names that unambiguously mean TestPlanIt's own case ID. Matched
// exactly: substring matching used to claim external reference columns such
// as "Ticket ID" or "Issue ID", and a column mapped to Case ID overwrites the
// existing case carrying that ID.
export const CASE_ID_HEADERS = [
  "id",
  "case id",
  "caseid",
  "case #",
  "test case id",
  "testcase id",
  "testplanit id",
];

const TEMPLATE_HEADERS = ["template", "templatename", "template name"];

// Common field name variations used by both the CSV and Markdown parsers.
export const COMMON_COLUMN_ALIASES: Record<string, string> = {
  "case name": "name",
  "test case name": "name",
  title: "name",
  tag: "tags",
  step: "steps",
  "test steps": "steps",
  expected: "expectedResult",
  "expected result": "expectedResult",
  "expected results": "expectedResult",
  "expected outcome": "expectedResult",
  estimated: "estimate",
  estimation: "estimate",
  "is automated": "automated",
  automation: "automated",
  "folder path": "folder",
  path: "folder",
  attachment: "attachments",
  issue: "issues",
  "linked case": "linkedCases",
  "linked test case": "linkedCases",
  "workflow state": "workflowState",
  state: "workflowState",
  status: "workflowState",
  "created at": "createdAt",
  "created date": "createdAt",
  "creation date": "createdAt",
  "date created": "createdAt",
  "created by": "createdBy",
  creator: "createdBy",
  author: "createdBy",
  "created user": "createdBy",
  version: "version",
  "version number": "version",
  "case version": "version",
  revision: "version",
  "test runs": "testRuns",
  "test run": "testRuns",
  runs: "testRuns",
  executions: "testRuns",
  description: "description",
  preconditions: "preconditions",
  prerequisites: "preconditions",
  "pre-conditions": "preconditions",
};

/**
 * Suggests a template field for every column header of an imported file.
 * Each field is claimed by at most one column; unmatched columns come back
 * with a null field so the wizard renders them as "Ignore Column".
 *
 * The Case ID field is the one exception to the fuzzy matching: it only
 * matches an exact header from `CASE_ID_HEADERS`. Mapping a column to Case ID
 * makes the import overwrite the existing case with that ID, so headers like
 * "Ticket ID", "Issue ID" or "Jira ID" must stay unmapped instead of being
 * guessed into it.
 */
export function autoMapImportColumns(
  columnHeaders: string[],
  templateFields: MappableField[]
): ColumnMapping[] {
  const usedFields = new Set<string>();

  return columnHeaders.map((col) => {
    let matchedField: string | null = null;
    const normalizedColName = col.toLowerCase().trim();

    if (TEMPLATE_HEADERS.includes(normalizedColName)) {
      return { csvColumn: col, templateField: null };
    }

    if (CASE_ID_HEADERS.includes(normalizedColName)) {
      const caseIdField = templateFields.find(
        (field) => field.id === "id" && !usedFields.has(field.id)
      );
      if (caseIdField) {
        usedFields.add(caseIdField.id);
        return { csvColumn: col, templateField: caseIdField.id };
      }
      return { csvColumn: col, templateField: null };
    }

    // Try exact match first
    const exactMatch = templateFields.find(
      (field) =>
        field.id !== "id" &&
        !usedFields.has(field.id) &&
        (field.displayName.toLowerCase() === normalizedColName ||
          field.id.toLowerCase() === normalizedColName)
    );

    if (exactMatch) {
      matchedField = exactMatch.id;
      usedFields.add(exactMatch.id);
    } else {
      // Try common variations
      for (const [commonName, fieldId] of Object.entries(
        COMMON_COLUMN_ALIASES
      )) {
        if (
          normalizedColName === commonName ||
          normalizedColName.includes(commonName)
        ) {
          const field = templateFields.find(
            (f) => f.id === fieldId && !usedFields.has(f.id)
          );
          if (field) {
            matchedField = fieldId;
            usedFields.add(fieldId);
            break;
          }
        }
      }

      // Partial matching fallback
      if (!matchedField) {
        const partialMatch = templateFields.find(
          (field) =>
            field.id !== "id" &&
            !usedFields.has(field.id) &&
            (normalizedColName.includes(field.displayName.toLowerCase()) ||
              normalizedColName.includes(field.id.toLowerCase()) ||
              field.displayName.toLowerCase().includes(normalizedColName) ||
              field.id.toLowerCase().includes(normalizedColName))
        );

        if (partialMatch) {
          matchedField = partialMatch.id;
          usedFields.add(partialMatch.id);
        }
      }
    }

    return { csvColumn: col, templateField: matchedField };
  });
}
