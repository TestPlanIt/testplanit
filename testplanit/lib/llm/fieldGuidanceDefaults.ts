/**
 * Generation guidance given to fields when they are seeded, and by the
 * migration that added the column to fields that already existed. The
 * generation prompt used to carry this advice itself, addressed to fields by
 * name; it now lives on the fields, where an administrator can change it.
 *
 * The migration repeats these strings in SQL. A test keeps the two in step.
 */
export const DEFAULT_FIELD_GUIDANCE = {
  description: "Say in one or two sentences what the test validates.",
  preconditions:
    "A short list of the state, test data, and permissions needed before the first step, one item per line.",
  postconditions:
    "Note only system state that matters after the test, such as data to clean up.",
  priority:
    "Critical is the highest priority and Low is the lowest. Start from the source issue's priority: give the case for the core happy path the highest value, and edge and negative cases one or two levels lower.",
} as const;
