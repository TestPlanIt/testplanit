/**
 * Structured value contract shared by the five FilterInput components
 * (Numeric/Steps/Date/Text/Link) and the repository FilterBar chip editor.
 * Carries typed {operator, values} so the chip editor never round-trips the
 * legacy `op|val` / `op:val` string encodings.
 */
export interface FilterInputValue {
  operator: string;
  values: Array<string | number>;
}

/**
 * Maps an operator to its `common.operators.*` label-key suffix. Legacy
 * ViewSelector encodings use `equals` where the registry uses `eq`; `any` /
 * `none` never carry values inside the FilterInput editors, so they always
 * read as has-value / is-empty there.
 */
export function operatorLabelKey(operator: string): string {
  switch (operator) {
    case "equals":
      return "eq";
    case "any":
      return "hasValue";
    case "none":
      return "isEmpty";
    default:
      return operator;
  }
}
