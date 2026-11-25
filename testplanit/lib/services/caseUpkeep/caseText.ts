import { extractTextFromTipTap } from "~/lib/llm/services/tiptap-text";
import type { FieldMapping } from "~/lib/services/jira-panel-generation";

/** A test case as the model reads it and as a proposal stores it. */
export interface UpkeepCaseText {
  name: string;
  /** Field values by field name, in the words a person would use. */
  fieldValues: Record<string, unknown>;
  steps: { step: string; expectedResult: string }[];
}

/** A linked test case handed to the model. */
export interface UpkeepCase extends UpkeepCaseText {
  id: number;
  /** The case shares steps with other cases, so its steps cannot be changed. */
  stepsFixed: boolean;
}

/**
 * A stored field value in the words the model should read and write: text
 * for rich text, option names for Dropdown and Multi-Select. Undefined for a
 * value that says nothing.
 */
export function readableFieldValue(
  mapping: FieldMapping,
  stored: unknown
): unknown {
  if (stored == null) return undefined;
  const optionName = (id: unknown) =>
    mapping.fieldOptions?.find((option) => option.id === Number(id))?.name;
  switch (mapping.fieldType) {
    case "Text Long": {
      const text = extractTextFromTipTap(stored).trim();
      return text === "" ? undefined : text;
    }
    case "Text String":
    case "Link": {
      const text = String(stored).trim();
      return text === "" ? undefined : text;
    }
    case "Dropdown":
      return optionName(stored);
    case "Multi-Select": {
      if (!Array.isArray(stored)) return undefined;
      const names = stored
        .map(optionName)
        .filter((name): name is string => name !== undefined);
      return names.length > 0 ? names : undefined;
    }
    case "Date":
      return typeof stored === "string" ? stored.slice(0, 10) : undefined;
    case "Integer":
    case "Number":
    case "Checkbox":
      return stored;
    default:
      return undefined;
  }
}

export interface UpkeepCaseRow {
  id: number;
  name: string;
  caseFieldValues: { fieldId: number; value: unknown }[];
  steps: {
    step: unknown;
    expectedResult: unknown;
    sharedStepGroupId: number | null;
  }[];
}

/** A case row, with its live steps in order, as the model reads it. */
export function toUpkeepCase(
  row: UpkeepCaseRow,
  fieldMappings: FieldMapping[]
): UpkeepCase {
  const fieldValues: Record<string, unknown> = {};
  for (const mapping of fieldMappings) {
    const stored = row.caseFieldValues.find(
      (value) => value.fieldId === mapping.caseFieldId
    )?.value;
    const readable = readableFieldValue(mapping, stored);
    if (readable !== undefined) fieldValues[mapping.fieldName] = readable;
  }
  return {
    id: row.id,
    name: row.name,
    fieldValues,
    steps: row.steps.map((step) => ({
      step: extractTextFromTipTap(step.step).trim(),
      expectedResult: extractTextFromTipTap(step.expectedResult).trim(),
    })),
    stepsFixed: row.steps.some((step) => step.sharedStepGroupId != null),
  };
}
