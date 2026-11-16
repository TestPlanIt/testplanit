/**
 * Decides whether the test case view should reset its edit form to the
 * case's saved values.
 *
 * The form's reset effect re-runs on every background refetch of the case or
 * its templates, and those happen mid-edit all the time: any mutation on a
 * model in the case's include tree (an issue linked from the picker, a shared
 * step group, a new tag) invalidates the case query, and the API's Date
 * objects give every refetch a new `testcase` reference even when nothing
 * changed. Resetting on those runs throws away what the user has typed.
 *
 * So while editing, only a template switch resets the form. Outside edit mode
 * the form always follows the saved case, which also makes leaving edit mode
 * (Cancel, Save) reset it.
 */
export function shouldResetCaseForm({
  isEditMode,
  selectedTemplateId,
  lastResetTemplateId,
  hasCarriedValues,
}: {
  isEditMode: boolean;
  selectedTemplateId: number | null;
  /** The template the form was last reset for; undefined before the first reset. */
  lastResetTemplateId: number | null | undefined;
  /** A template switch from the picker is carrying the user's values over. */
  hasCarriedValues: boolean;
}): boolean {
  if (!isEditMode) return true;
  if (hasCarriedValues) return true;
  return lastResetTemplateId !== selectedTemplateId;
}
