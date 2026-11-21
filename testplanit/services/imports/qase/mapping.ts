import type { QaseProjectSummary } from "./types";

/** The TestPlanIt case field type a Qase field is imported as. */
export type QaseTargetFieldType =
  | "Dropdown"
  | "Multi-Select"
  | "Checkbox"
  | "Text String"
  | "Text Long"
  | "Number"
  | "Link"
  | "Date";

export interface QaseSourceOption {
  id: string;
  title: string;
}

export interface QaseSourceField {
  /** `system:<slug>` or `custom:<id>`. */
  key: string;
  title: string;
  targetType: QaseTargetFieldType;
  options: QaseSourceOption[];
}

export interface QaseSourceUser {
  id: string;
  name: string;
  email: string;
}

export interface QaseExistingField {
  id: number;
  displayName: string;
  systemName: string;
  type: string;
  options: { id: number; name: string }[];
}

export interface QaseAnalysis {
  source: {
    projects: QaseProjectSummary[];
    users: QaseSourceUser[];
    caseStatuses: QaseSourceOption[];
    fields: QaseSourceField[];
  };
  existing: {
    projects: { id: number; name: string }[];
    users: { id: string; name: string; email: string }[];
    workflows: {
      id: number;
      name: string;
      isDefault: boolean;
      icon: { name: string };
      color: { value: string };
    }[];
    templates: { id: number; name: string }[];
    caseFields: QaseExistingField[];
  };
  /** False when no file storage is set up, so attachments cannot be copied. */
  storageConfigured: boolean;
}

export type QaseFieldAction = "map" | "create" | "skip";
export type QaseTemplateAction = "map" | "create";

export interface QaseFieldMapping {
  action: QaseFieldAction;
  mappedTo: number | null;
  /** Display name of the field to create. */
  name: string;
}

export interface QaseMappingConfiguration {
  /** Qase project code to TestPlanIt project id. */
  projects: Record<string, { mappedTo: number | null }>;
  /** Qase user id to TestPlanIt user id; null means the person importing. */
  users: Record<string, { mappedTo: string | null }>;
  /** Qase case status id to a workflow state id. */
  caseStatuses: Record<string, { mappedTo: number | null }>;
  template: {
    action: QaseTemplateAction;
    mappedTo: number | null;
    name: string;
  };
  fields: Record<string, QaseFieldMapping>;
}

export type QaseMappingProblem =
  | { code: "project_unmapped"; subject: string }
  | { code: "status_unmapped"; subject: string }
  | { code: "template_missing" }
  | { code: "template_name_taken"; subject: string }
  | { code: "field_unmapped"; subject: string }
  | { code: "field_type_mismatch"; subject: string }
  | { code: "field_target_reused"; subject: string }
  | { code: "field_name_missing"; subject: string }
  | { code: "field_name_taken"; subject: string };

export const QASE_DEFAULT_TEMPLATE_NAME = "Qase";

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toId = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

/** Coerces untrusted JSON into a configuration; unknown parts are dropped. */
export function normalizeQaseMapping(value: unknown): QaseMappingConfiguration {
  const input = isRecord(value) ? value : {};
  const section = (key: string) => (isRecord(input[key]) ? input[key] : {});

  const projects: QaseMappingConfiguration["projects"] = {};
  for (const [code, entry] of Object.entries(section("projects"))) {
    projects[code] = {
      mappedTo: toId(isRecord(entry) ? entry.mappedTo : null),
    };
  }

  const users: QaseMappingConfiguration["users"] = {};
  for (const [id, entry] of Object.entries(section("users"))) {
    const mappedTo = isRecord(entry) ? entry.mappedTo : null;
    users[id] = {
      mappedTo: typeof mappedTo === "string" && mappedTo ? mappedTo : null,
    };
  }

  const caseStatuses: QaseMappingConfiguration["caseStatuses"] = {};
  for (const [id, entry] of Object.entries(section("caseStatuses"))) {
    caseStatuses[id] = {
      mappedTo: toId(isRecord(entry) ? entry.mappedTo : null),
    };
  }

  const rawTemplate = section("template");
  const template: QaseMappingConfiguration["template"] = {
    action: rawTemplate.action === "map" ? "map" : "create",
    mappedTo: toId(rawTemplate.mappedTo),
    name:
      typeof rawTemplate.name === "string"
        ? rawTemplate.name.trim().slice(0, 255)
        : "",
  };

  const fields: QaseMappingConfiguration["fields"] = {};
  for (const [key, entry] of Object.entries(section("fields"))) {
    const raw = isRecord(entry) ? entry : {};
    fields[key] = {
      action:
        raw.action === "map" || raw.action === "skip" ? raw.action : "create",
      mappedTo: toId(raw.mappedTo),
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, 255) : "",
    };
  }

  return { projects, users, caseStatuses, template, fields };
}

/** The mapping the screen opens with: matched by name where a match exists. */
export function buildDefaultQaseMapping(
  analysis: QaseAnalysis
): QaseMappingConfiguration {
  const { source, existing } = analysis;

  const projects: QaseMappingConfiguration["projects"] = {};
  for (const project of source.projects) {
    const match = existing.projects.find((candidate) =>
      sameName(candidate.name, project.title)
    );
    projects[project.code] = { mappedTo: match?.id ?? null };
  }

  const users: QaseMappingConfiguration["users"] = {};
  for (const user of source.users) {
    const match = existing.users.find(
      (candidate) => !!user.email && sameName(candidate.email, user.email)
    );
    users[user.id] = { mappedTo: match?.id ?? null };
  }

  const defaultWorkflow =
    existing.workflows.find((workflow) => workflow.isDefault) ??
    existing.workflows[0];
  const caseStatuses: QaseMappingConfiguration["caseStatuses"] = {};
  for (const status of source.caseStatuses) {
    const match = existing.workflows.find((workflow) =>
      sameName(workflow.name, status.title)
    );
    caseStatuses[status.id] = {
      mappedTo: match?.id ?? defaultWorkflow?.id ?? null,
    };
  }

  const existingTemplate = existing.templates.find((template) =>
    sameName(template.name, QASE_DEFAULT_TEMPLATE_NAME)
  );
  const template: QaseMappingConfiguration["template"] = existingTemplate
    ? { action: "map", mappedTo: existingTemplate.id, name: "" }
    : { action: "create", mappedTo: null, name: QASE_DEFAULT_TEMPLATE_NAME };

  const fields: QaseMappingConfiguration["fields"] = {};
  const taken = new Set<number>();
  for (const field of source.fields) {
    const sameNamed = existing.caseFields.filter((candidate) =>
      sameName(candidate.displayName, field.title)
    );
    const match = sameNamed.find(
      (candidate) =>
        candidate.type === field.targetType && !taken.has(candidate.id)
    );
    if (match) {
      taken.add(match.id);
      fields[field.key] = { action: "map", mappedTo: match.id, name: "" };
    } else {
      fields[field.key] = {
        action: "create",
        mappedTo: null,
        name: sameNamed.length > 0 ? `${field.title} (Qase)` : field.title,
      };
    }
  }

  return { projects, users, caseStatuses, template, fields };
}

/** Everything that stops an import from starting with this mapping. */
export function validateQaseMapping(
  config: QaseMappingConfiguration,
  analysis: QaseAnalysis
): QaseMappingProblem[] {
  const problems: QaseMappingProblem[] = [];
  const { source, existing } = analysis;

  for (const project of source.projects) {
    const target = config.projects[project.code]?.mappedTo ?? null;
    if (!existing.projects.some((candidate) => candidate.id === target)) {
      problems.push({ code: "project_unmapped", subject: project.title });
    }
  }

  for (const status of source.caseStatuses) {
    const target = config.caseStatuses[status.id]?.mappedTo ?? null;
    if (!existing.workflows.some((workflow) => workflow.id === target)) {
      problems.push({ code: "status_unmapped", subject: status.title });
    }
  }

  if (config.template.action === "map") {
    if (
      !existing.templates.some(
        (template) => template.id === config.template.mappedTo
      )
    ) {
      problems.push({ code: "template_missing" });
    }
  } else if (!config.template.name) {
    problems.push({ code: "template_missing" });
  } else if (
    existing.templates.some((template) =>
      sameName(template.name, config.template.name)
    )
  ) {
    problems.push({
      code: "template_name_taken",
      subject: config.template.name,
    });
  }

  const usedTargets = new Set<number>();
  const newNames: string[] = [];
  for (const field of source.fields) {
    const mapping = config.fields[field.key];
    if (!mapping || mapping.action === "skip") {
      continue;
    }
    if (mapping.action === "map") {
      const target = existing.caseFields.find(
        (candidate) => candidate.id === mapping.mappedTo
      );
      if (!target) {
        problems.push({ code: "field_unmapped", subject: field.title });
      } else if (target.type !== field.targetType) {
        problems.push({ code: "field_type_mismatch", subject: field.title });
      } else if (usedTargets.has(target.id)) {
        problems.push({ code: "field_target_reused", subject: field.title });
      } else {
        usedTargets.add(target.id);
      }
      continue;
    }
    if (!mapping.name) {
      problems.push({ code: "field_name_missing", subject: field.title });
    } else if (
      existing.caseFields.some((candidate) =>
        sameName(candidate.displayName, mapping.name)
      ) ||
      newNames.some((name) => sameName(name, mapping.name))
    ) {
      problems.push({ code: "field_name_taken", subject: mapping.name });
    } else {
      newNames.push(mapping.name);
    }
  }

  return problems;
}
