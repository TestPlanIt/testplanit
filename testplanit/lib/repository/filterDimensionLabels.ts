/**
 * Translation keys for filter dimensions, operators and boolean values. Kept
 * apart from the registry (which stays label-free) and from the FilterBar's
 * icons, so the worker can name a stored filter the way the bar's chips do.
 */

export const DIMENSION_LABEL_KEYS: Readonly<Record<string, string>> = {
  templates: "common.fields.template",
  states: "common.fields.state",
  creators: "reports.dimensions.creator",
  automated: "repository.views.byAutomation",
  parameterized: "repository.views.byParameterized",
  attachments: "common.fields.attachments",
  codePins: "repository.codePins.title",
  inReview: "repository.views.byReview",
  tags: "repository.views.byTag",
  issues: "repository.views.byIssue",
  status: "common.actions.status",
  assignedTo: "common.fields.assignedTo",
};

/** The two faces of each boolean dimension, as the chips and pickers name them. */
export const BOOLEAN_VALUE_LABEL_KEYS: Readonly<
  Record<string, { true: string; false: string }>
> = {
  automated: {
    true: "common.fields.automated",
    false: "common.fields.notAutomated",
  },
  parameterized: {
    true: "common.fields.parameterized",
    false: "common.fields.notParameterized",
  },
  attachments: {
    true: "common.fields.hasAttachments",
    false: "common.fields.noAttachments",
  },
  inReview: {
    true: "common.fields.inReview",
    false: "common.fields.notInReview",
  },
  codePins: {
    true: "common.fields.hasCodePins",
    false: "common.fields.noCodePins",
  },
};

/** A Checkbox field's two values. */
export const CHECKBOX_VALUE_LABEL_KEYS = {
  true: "common.fields.checked",
  false: "repository.fields.unchecked",
} as const;

/**
 * Label key for an operator as shown on a chip. Bare `any`/`none` (no values)
 * read as has-value / is-empty; with values they read as any-of / none-of
 * (spec §5).
 */
export function chipOperatorLabelKey(
  operator: string,
  valueCount: number
): string {
  if (operator === "any") {
    return valueCount === 0
      ? "common.operators.hasValue"
      : "common.operators.anyOf";
  }
  if (operator === "none") {
    return valueCount === 0
      ? "common.operators.isEmpty"
      : "common.operators.noneOf";
  }
  if (operator === "all") return "common.operators.allOf";
  return `common.operators.${operator}`;
}

/**
 * Label key for an operator inside the chip editor's operator Select, where
 * the value list sits directly below — `any`/`none` always read as
 * any-of / none-of there (bare-ness is emergent from an empty selection).
 */
export function editorOperatorLabelKey(operator: string): string {
  switch (operator) {
    case "any":
      return "common.operators.anyOf";
    case "all":
      return "common.operators.allOf";
    case "none":
      return "common.operators.noneOf";
    default:
      return `common.operators.${operator}`;
  }
}
