/**
 * Pure helpers for the AddCase inline parameters/dataset flow. Extracted
 * from `AddCase.tsx` so the gate logic (when to show the Configure
 * Parameters button, what to forward on submit) has unit-test coverage
 * without having to mock react-hook-form, ZenStack hooks, and next-intl.
 *
 * Two concerns live here:
 *   1. `templateHasStepsField` — drives whether the AddCase form renders
 *      the Configure Parameters button at all. Parameters reference each
 *      other via `@chip` tokens inside TipTap step content; without a
 *      Steps field, the chips have nowhere to live and the editor would
 *      be empty UX friction. Per the project memory rule
 *      `feedback_addcase_params_steps_field_gated`.
 *
 *   2. `pickInlinePayload` — decides what to forward on submit. Returns
 *      `undefined` for both arrays when no parameters were authored so
 *      the import action's non-parameterized branch fires and we don't
 *      ship orphan dataset rows or empty-name parameters.
 */

import type {
  InlineDatasetRow,
  InlineParameter,
} from "@/components/parameters/InlineDatasetEditor";

interface TemplateCaseFieldLike {
  caseField?: {
    displayName?: string | null;
  } | null;
}

interface TemplateLike {
  caseFields?: TemplateCaseFieldLike[] | null;
}

const STEPS_FIELD_NAME = "Steps";

/**
 * Returns `true` when the given template includes a Steps field. Defensive
 * about partial inputs so callers can pass the raw template record without
 * pre-null-checking; missing template, missing caseFields, missing
 * displayName all coerce to `false`.
 */
export function templateHasStepsField(
  template: TemplateLike | null | undefined
): boolean {
  if (!template?.caseFields) return false;
  return template.caseFields.some(
    (cf) => cf?.caseField?.displayName === STEPS_FIELD_NAME
  );
}

export interface InlinePayloadPick {
  parameters: InlineParameter[] | undefined;
  datasetRows: InlineDatasetRow[] | undefined;
}

/**
 * Computes the `{ parameters, datasetRows }` slice of the import payload
 * the AddCase modal should forward.
 *
 *   - When no parameters were authored, both fields are `undefined` so the
 *     import action's non-parameterized branch fires.
 *   - When at least one parameter has a non-empty trimmed name, the
 *     trimmed parameter list is forwarded alongside the rows. Empty-name
 *     drafts are silently dropped — the user added a row to the table
 *     and hasn't named it yet; the server-side Zod schema would reject
 *     it with a less-actionable error.
 *   - When parameters exist but all have empty names, nothing is
 *     forwarded (degenerate input).
 */
export function pickInlinePayload(
  parameters: InlineParameter[],
  rows: InlineDatasetRow[]
): InlinePayloadPick {
  if (!parameters.length) {
    return { parameters: undefined, datasetRows: undefined };
  }
  const trimmed = parameters.filter((p) => p.name.trim().length > 0);
  if (!trimmed.length) {
    return { parameters: undefined, datasetRows: undefined };
  }
  return { parameters: trimmed, datasetRows: rows };
}
