import { parse as parseYaml } from "yaml";
import type {
  IssueFormElement,
  IssueTemplate,
  IssueTemplateSet,
} from "./issueTemplates";

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** A list written as a YAML sequence or as one comma-separated string. */
function list(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return items
    .map((item) => (typeof item === "string" ? item.trim() : String(item)))
    .filter((item) => item !== "" && item !== "null");
}

function parseYamlObject(source: string): Record<string, any> | null {
  try {
    const parsed = parseYaml(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function templateHead(id: string, meta: Record<string, any>) {
  return {
    id,
    name: text(meta.name) ?? id,
    description: text(meta.about) ?? text(meta.description),
    title: typeof meta.title === "string" ? meta.title : undefined,
    labels: list(meta.labels),
    assignees: list(meta.assignees),
    issueType: text(meta.type),
  };
}

function parseMarkdownTemplate(id: string, source: string): IssueTemplate {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const meta = (match && parseYamlObject(match[1])) || {};
  const body = (match ? match[2] : source).replace(/^\s*\n/, "");
  return { ...templateHead(id, meta), body };
}

function parseFormElement(raw: any, index: number): IssueFormElement | null {
  if (!raw || typeof raw !== "object") return null;
  const attributes =
    raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {};
  if (raw.type === "markdown") {
    const value = text(attributes.value);
    return value ? { kind: "markdown", text: value } : null;
  }

  const label = text(attributes.label);
  if (!label) return null;
  const base = {
    id: text(raw.id) ?? `field-${index}`,
    label,
    description: text(attributes.description),
  };
  const required = raw.validations?.required === true;

  switch (raw.type) {
    case "input":
    case "textarea":
      return {
        ...base,
        kind: raw.type,
        placeholder: text(attributes.placeholder),
        value:
          typeof attributes.value === "string" ? attributes.value : undefined,
        render: raw.type === "textarea" ? text(attributes.render) : undefined,
        required,
      };
    case "dropdown": {
      const options = list(attributes.options);
      if (options.length === 0) return null;
      const defaultIndex = Number.isInteger(attributes.default)
        ? attributes.default
        : undefined;
      return {
        ...base,
        kind: "dropdown",
        options,
        multiple: attributes.multiple === true,
        defaultIndex:
          defaultIndex !== undefined &&
          defaultIndex >= 0 &&
          defaultIndex < options.length
            ? defaultIndex
            : undefined,
        required,
      };
    }
    case "checkboxes": {
      const options = (
        Array.isArray(attributes.options) ? attributes.options : []
      )
        .map((option: any) => ({
          label: text(option?.label) ?? "",
          required: option?.required === true,
        }))
        .filter((option: { label: string }) => option.label !== "");
      return options.length > 0
        ? { ...base, kind: "checkboxes", options }
        : null;
    }
    default:
      return null;
  }
}

function parseIssueForm(id: string, source: string): IssueTemplate | null {
  const meta = parseYamlObject(source);
  if (!meta || !Array.isArray(meta.body)) return null;
  const form = meta.body
    .map((element: any, index: number) => parseFormElement(element, index))
    .filter(
      (element: IssueFormElement | null): element is IssueFormElement =>
        element !== null
    );
  return { ...templateHead(id, meta), form };
}

/**
 * The templates in one `.github/ISSUE_TEMPLATE` folder, by file name. A file
 * that cannot be read as a template is left out.
 */
export function parseIssueTemplates(
  files: Array<{ name: string; text: string | null | undefined }>
): IssueTemplateSet {
  const templates: IssueTemplate[] = [];
  let blankIssuesEnabled = true;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sorted) {
    if (typeof file.text !== "string") continue;
    const lower = file.name.toLowerCase();
    if (lower === "config.yml" || lower === "config.yaml") {
      if (parseYamlObject(file.text)?.blank_issues_enabled === false) {
        blankIssuesEnabled = false;
      }
    } else if (lower.endsWith(".md")) {
      templates.push(parseMarkdownTemplate(file.name, file.text));
    } else if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
      const form = parseIssueForm(file.name, file.text);
      if (form) templates.push(form);
    }
  }
  return { templates, blankIssuesEnabled };
}
