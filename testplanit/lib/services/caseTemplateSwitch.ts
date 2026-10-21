import { isEqual } from "lodash";
import { emptyEditorContent } from "~/app/constants/backend";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";

/**
 * Switching a case to another template while it is being edited keeps every
 * value the new template has a place for. Case fields are shared between
 * templates, so a field in both keeps its value. A case holds one list of
 * steps whichever Steps field shows it, so the steps move to the new
 * template's Steps field even when that is a different field.
 */

/** What these helpers read from a template's case field. */
export interface TemplateCaseFieldLike {
  caseField: {
    id: number;
    displayName: string;
    type: { type: string };
  };
}

const isStepsField = (field: TemplateCaseFieldLike) =>
  field.caseField.type.type === "Steps";

/**
 * Maps each field of the next template to the current-template field whose
 * value it takes over. A field with no entry starts from its default.
 */
export function carriedFieldSources(
  fromFields: TemplateCaseFieldLike[],
  toFields: TemplateCaseFieldLike[]
): Map<number, number> {
  const fromIds = new Set(fromFields.map((field) => field.caseField.id));
  const toIds = new Set(toFields.map((field) => field.caseField.id));
  const fromSteps = fromFields.find(isStepsField);
  let stepsSource =
    fromSteps && !toIds.has(fromSteps.caseField.id)
      ? fromSteps.caseField.id
      : null;

  const sources = new Map<number, number>();
  for (const field of toFields) {
    const id = field.caseField.id;
    if (fromIds.has(id)) {
      sources.set(id, id);
    } else if (stepsSource !== null && isStepsField(field)) {
      sources.set(id, stepsSource);
      stepsSource = null;
    }
  }
  return sources;
}

/** The value each of a template's fields starts from on a new case. */
export function templateFieldDefaults(caseFields: any[]): Record<string, any> {
  const defaults: Record<string, any> = {};
  caseFields.forEach((caseField: any) => {
    const fieldIdStr = caseField.caseField.id.toString();
    switch (caseField.caseField.type.type) {
      case "Dropdown":
        if (caseField.caseField.fieldOptions) {
          const defaultOption = caseField.caseField.fieldOptions.find(
            (option: any) =>
              option.fieldOption.isDefault &&
              option.fieldOption.isEnabled !== false &&
              !option.fieldOption.isDeleted
          );
          if (defaultOption) {
            defaults[fieldIdStr] = defaultOption.fieldOption.id;
          }
        }
        break;
      case "Multi-Select":
        defaults[fieldIdStr] = [];
        break;
      case "Steps":
        defaults[fieldIdStr] = [];
        break;
      case "Integer":
      case "Number":
        defaults[fieldIdStr] = "";
        break;
      case "Date":
        defaults[fieldIdStr] = undefined;
        break;
      case "Checkbox":
        defaults[fieldIdStr] = caseField.caseField.isChecked ?? false;
        break;
      case "Link":
      case "Text String":
        defaults[fieldIdStr] = caseField.caseField.defaultValue || "";
        break;
      case "Text Long":
        defaults[fieldIdStr] =
          caseField.caseField.defaultValue ||
          JSON.stringify(emptyEditorContent);
        break;
    }
  });
  return defaults;
}

/** Current-template fields whose value the next template has no place for. */
export function fieldsDroppedBySwitch<F extends TemplateCaseFieldLike>(
  fromFields: F[],
  toFields: TemplateCaseFieldLike[]
): F[] {
  const carried = new Set(carriedFieldSources(fromFields, toFields).values());
  return fromFields.filter((field) => !carried.has(field.caseField.id));
}

export const isEmptyFieldValue = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length === 0;
  if (value === false) return true;
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (value instanceof Date) return false;
  return isTiptapEmpty(value);
};

/**
 * Whether `value` differs from `baseline` — the field's default on a new
 * case, its saved value on an existing one. Empty values of any shape match
 * each other, so an untouched field never reads as an edit.
 */
export function caseFieldValueChanged(
  value: unknown,
  baseline: unknown
): boolean {
  if (isEmptyFieldValue(value) && isEmptyFieldValue(baseline)) return false;
  return !isEqual(value, baseline);
}
