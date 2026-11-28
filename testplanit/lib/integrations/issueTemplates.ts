/**
 * A repository's issue templates: the files under `.github/ISSUE_TEMPLATE`.
 * A markdown file is a template (front matter plus a starting body); a YAML
 * file is an issue form (a list of fields GitHub renders as a form and
 * turns into the issue body).
 */
export interface IssueTemplate {
  /** The file name, which is unique in the folder. */
  id: string;
  name: string;
  description?: string;
  title?: string;
  labels: string[];
  assignees: string[];
  issueType?: string;
  /** A markdown template's starting body. */
  body?: string;
  /** An issue form's elements, in order. */
  form?: IssueFormElement[];
}

export type IssueFormElement =
  | { kind: "markdown"; text: string }
  | {
      kind: "input" | "textarea";
      id: string;
      label: string;
      description?: string;
      placeholder?: string;
      value?: string;
      /** The language a textarea's answer is fenced in. */
      render?: string;
      required: boolean;
    }
  | {
      kind: "dropdown";
      id: string;
      label: string;
      description?: string;
      options: string[];
      multiple: boolean;
      /** Index of the option chosen to start with. */
      defaultIndex?: number;
      required: boolean;
    }
  | {
      kind: "checkboxes";
      id: string;
      label: string;
      description?: string;
      options: Array<{ label: string; required: boolean }>;
    };

export interface IssueTemplateSet {
  templates: IssueTemplate[];
  /** False when the repository's config.yml turns blank issues off. */
  blankIssuesEnabled: boolean;
}

export type IssueFormValues = Record<string, string | string[]>;

const NO_RESPONSE = "_No response_";

/** What an issue form starts with: each field's preset value. */
export function initialIssueFormValues(
  form: IssueFormElement[]
): IssueFormValues {
  const values: IssueFormValues = {};
  for (const element of form) {
    if (element.kind === "input" || element.kind === "textarea") {
      values[element.id] = element.value ?? "";
    } else if (element.kind === "dropdown") {
      const preset =
        element.defaultIndex !== undefined
          ? element.options[element.defaultIndex]
          : undefined;
      values[element.id] = element.multiple
        ? preset
          ? [preset]
          : []
        : (preset ?? "");
    } else if (element.kind === "checkboxes") {
      values[element.id] = [];
    }
  }
  return values;
}

function chosen(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** The ids of the fields a required answer is missing from. */
export function missingIssueFormFields(
  form: IssueFormElement[],
  values: IssueFormValues
): string[] {
  const missing: string[] = [];
  for (const element of form) {
    if (element.kind === "markdown") continue;
    const answer = values[element.id];
    if (element.kind === "checkboxes") {
      const ticked = chosen(answer);
      if (
        element.options.some(
          (option) => option.required && !ticked.includes(option.label)
        )
      ) {
        missing.push(element.id);
      }
    } else if (element.required) {
      const empty = Array.isArray(answer)
        ? answer.length === 0
        : !(answer ?? "").trim();
      if (empty) missing.push(element.id);
    }
  }
  return missing;
}

/**
 * The issue body GitHub writes for a submitted form: one `### label`
 * section per field, in order.
 */
export function renderIssueFormBody(
  form: IssueFormElement[],
  values: IssueFormValues
): string {
  const sections: string[] = [];
  for (const element of form) {
    if (element.kind === "markdown") continue;
    const answer = values[element.id];
    let content: string;
    if (element.kind === "checkboxes") {
      const ticked = chosen(answer);
      content = element.options
        .map(
          (option) =>
            `- [${ticked.includes(option.label) ? "X" : " "}] ${option.label}`
        )
        .join("\n");
    } else if (element.kind === "dropdown") {
      content = chosen(answer).join(", ") || NO_RESPONSE;
    } else {
      const value = typeof answer === "string" ? answer.trim() : "";
      content = !value
        ? NO_RESPONSE
        : element.render
          ? `\`\`\`${element.render}\n${value}\n\`\`\``
          : value;
    }
    sections.push(`### ${element.label}\n\n${content}`);
  }
  return sections.join("\n\n");
}
