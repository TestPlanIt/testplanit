import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";

/**
 * Whether a case field has nothing to show in view mode. Steps and
 * Multi-Select values are arrays (rows, option ids), which isTiptapEmpty
 * reports as empty whatever they hold, so those are judged by length.
 */
export function isCaseFieldValueEmpty(
  fieldType: string,
  value: unknown
): boolean {
  if (fieldType === "Steps" || fieldType === "Multi-Select") {
    return !Array.isArray(value) || value.length === 0;
  }
  return isTiptapEmpty(value);
}
