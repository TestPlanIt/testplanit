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
    /** Result statuses, by Qase slug; empty when no results were fetched. */
    resultStatuses: QaseSourceOption[];
    hasRuns: boolean;
    hasMilestones: boolean;
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
    roles: { id: number; name: string; isDefault: boolean }[];
    /** Statuses a test run result can have. */
    statuses: {
      id: number;
      name: string;
      systemName: string;
      color: { value: string };
    }[];
    /** Workflow states for test runs. */
    runStates: {
      id: number;
      name: string;
      workflowType: string;
      isDefault: boolean;
      icon: { name: string };
      color: { value: string };
    }[];
    milestoneTypes: {
      id: number;
      name: string;
      isDefault: boolean;
      icon: { name: string } | null;
    }[];
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

export type QaseProjectAction = "map" | "create";
export type QaseUserAction = "map" | "create";
export const QASE_USER_ACCESS = [
  "NONE",
  "USER",
  "PROJECTADMIN",
  "ADMIN",
] as const;
export type QaseUserAccess = (typeof QASE_USER_ACCESS)[number];

export interface QaseProjectMapping {
  action: QaseProjectAction;
  mappedTo: number | null;
  /** Name of the project to create. */
  name: string;
}

export interface QaseUserMapping {
  action: QaseUserAction;
  /** With "map", null means the person importing. */
  mappedTo: string | null;
  /** The account to create. */
  name: string;
  email: string;
  access: QaseUserAccess;
  /** Null means the default role. */
  roleId: number | null;
  isActive: boolean;
  isApi: boolean;
}

export type QaseResultStatusAction = "map" | "create";

export interface QaseResultStatusMapping {
  action: QaseResultStatusAction;
  mappedTo: number | null;
  /** The status to create. */
  name: string;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
}

export interface QaseMappingConfiguration {
  /** By Qase project code. */
  projects: Record<string, QaseProjectMapping>;
  /** By Qase user id. */
  users: Record<string, QaseUserMapping>;
  /** Qase case status id to a workflow state id. */
  caseStatuses: Record<string, { mappedTo: number | null }>;
  template: {
    action: QaseTemplateAction;
    mappedTo: number | null;
    name: string;
  };
  fields: Record<string, QaseFieldMapping>;
  /** By Qase result status slug. */
  resultStatuses: Record<string, QaseResultStatusMapping>;
  /** The workflow state of a run still open in Qase, and of a finished one. */
  runStates: { active: number | null; completed: number | null };
  milestoneTypeId: number | null;
}

export type QaseMappingProblem =
  | { code: "project_unmapped"; subject: string }
  | { code: "project_name_missing"; subject: string }
  | { code: "project_name_taken"; subject: string }
  | { code: "user_email_missing"; subject: string }
  | { code: "user_email_invalid"; subject: string }
  | { code: "user_email_reused"; subject: string }
  | { code: "user_role_missing"; subject: string }
  | { code: "status_unmapped"; subject: string }
  | { code: "template_missing" }
  | { code: "template_name_taken"; subject: string }
  | { code: "field_unmapped"; subject: string }
  | { code: "field_type_mismatch"; subject: string }
  | { code: "field_target_reused"; subject: string }
  | { code: "field_name_missing"; subject: string }
  | { code: "field_name_taken"; subject: string }
  | { code: "result_status_unmapped"; subject: string }
  | { code: "result_status_name_missing"; subject: string }
  | { code: "result_status_name_taken"; subject: string }
  | { code: "run_state_unmapped"; subject: "active" | "completed" }
  | { code: "milestone_type_missing" };

export const QASE_DEFAULT_TEMPLATE_NAME = "Qase";

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toId = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

const toName = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 255) : "";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A user mapping that leaves the Qase user to the person importing. */
export const unmappedQaseUser = (): QaseUserMapping => ({
  action: "map",
  mappedTo: null,
  name: "",
  email: "",
  access: "USER",
  roleId: null,
  isActive: true,
  isApi: false,
});

/** The label a Qase user is shown and reported by. */
export const qaseUserLabel = (user: QaseSourceUser) =>
  user.name || user.email || user.id;

/** Coerces untrusted JSON into a configuration; unknown parts are dropped. */
export function normalizeQaseMapping(value: unknown): QaseMappingConfiguration {
  const input = isRecord(value) ? value : {};
  const section = (key: string) => (isRecord(input[key]) ? input[key] : {});

  const projects: QaseMappingConfiguration["projects"] = {};
  for (const [code, entry] of Object.entries(section("projects"))) {
    const raw = isRecord(entry) ? entry : {};
    projects[code] = {
      action: raw.action === "create" ? "create" : "map",
      mappedTo: toId(raw.mappedTo),
      name: toName(raw.name),
    };
  }

  const users: QaseMappingConfiguration["users"] = {};
  for (const [id, entry] of Object.entries(section("users"))) {
    const raw = isRecord(entry) ? entry : {};
    users[id] = {
      action: raw.action === "create" ? "create" : "map",
      mappedTo:
        typeof raw.mappedTo === "string" && raw.mappedTo ? raw.mappedTo : null,
      name: toName(raw.name),
      email: toName(raw.email).toLowerCase(),
      access: QASE_USER_ACCESS.includes(raw.access as QaseUserAccess)
        ? (raw.access as QaseUserAccess)
        : "USER",
      roleId: toId(raw.roleId),
      isActive: raw.isActive !== false,
      isApi: raw.isApi === true,
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

  const resultStatuses: QaseMappingConfiguration["resultStatuses"] = {};
  for (const [slug, entry] of Object.entries(section("resultStatuses"))) {
    const raw = isRecord(entry) ? entry : {};
    resultStatuses[slug] = {
      action: raw.action === "create" ? "create" : "map",
      mappedTo: toId(raw.mappedTo),
      name: toName(raw.name),
      isSuccess: raw.isSuccess === true,
      isFailure: raw.isFailure === true,
      isCompleted: raw.isCompleted === true,
    };
  }

  const rawRunStates = section("runStates");
  const runStates = {
    active: toId(rawRunStates.active),
    completed: toId(rawRunStates.completed),
  };

  return {
    projects,
    users,
    caseStatuses,
    template,
    fields,
    resultStatuses,
    runStates,
    milestoneTypeId: toId(input.milestoneTypeId),
  };
}

/** How a Qase result status behaves when TestPlanIt has no status like it. */
const RESULT_STATUS_FLAGS: Record<
  string,
  Pick<QaseResultStatusMapping, "isSuccess" | "isFailure" | "isCompleted">
> = {
  passed: { isSuccess: true, isFailure: false, isCompleted: true },
  failed: { isSuccess: false, isFailure: true, isCompleted: true },
  invalid: { isSuccess: false, isFailure: false, isCompleted: true },
  skipped: { isSuccess: false, isFailure: false, isCompleted: true },
};
const OPEN_STATUS = { isSuccess: false, isFailure: false, isCompleted: false };

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
    projects[project.code] = match
      ? { action: "map", mappedTo: match.id, name: "" }
      : { action: "create", mappedTo: null, name: project.title.trim() };
  }

  const users: QaseMappingConfiguration["users"] = {};
  for (const user of source.users) {
    const match = existing.users.find(
      (candidate) => !!user.email && sameName(candidate.email, user.email)
    );
    const email = user.email.trim().toLowerCase();
    // A Qase user TestPlanIt does not know is created; without an email
    // address there is nothing to create, so the importer stands in.
    users[user.id] =
      match || !email
        ? { ...unmappedQaseUser(), mappedTo: match?.id ?? null }
        : {
            ...unmappedQaseUser(),
            action: "create",
            name: user.name.trim() || email,
            email,
          };
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

  const resultStatuses: QaseMappingConfiguration["resultStatuses"] = {};
  for (const status of source.resultStatuses) {
    const match = existing.statuses.find(
      (candidate) =>
        sameName(candidate.systemName, status.id) ||
        sameName(candidate.name, status.title)
    );
    resultStatuses[status.id] = match
      ? { action: "map", mappedTo: match.id, name: "", ...OPEN_STATUS }
      : {
          action: "create",
          mappedTo: null,
          name: status.title,
          ...(RESULT_STATUS_FLAGS[status.id] ?? OPEN_STATUS),
        };
  }

  const stateOfType = (type: string) =>
    existing.runStates.find((state) => state.workflowType === type)?.id ?? null;
  const defaultRunState =
    existing.runStates.find((state) => state.isDefault)?.id ??
    existing.runStates[0]?.id ??
    null;
  const runStates = {
    active: stateOfType("IN_PROGRESS") ?? defaultRunState,
    completed: stateOfType("DONE") ?? defaultRunState,
  };

  const milestoneTypeId =
    existing.milestoneTypes.find((type) => type.isDefault)?.id ??
    existing.milestoneTypes[0]?.id ??
    null;

  return {
    projects,
    users,
    caseStatuses,
    template,
    fields,
    resultStatuses,
    runStates,
    milestoneTypeId,
  };
}

/**
 * A saved mapping with everything it lacks taken from the defaults, so a
 * mapping saved before part of the data was mappable still opens complete.
 */
export function completeQaseMapping(
  saved: QaseMappingConfiguration,
  analysis: QaseAnalysis
): QaseMappingConfiguration {
  const defaults = buildDefaultQaseMapping(analysis);
  return {
    projects: { ...defaults.projects, ...saved.projects },
    users: { ...defaults.users, ...saved.users },
    caseStatuses: { ...defaults.caseStatuses, ...saved.caseStatuses },
    template: saved.template,
    fields: { ...defaults.fields, ...saved.fields },
    resultStatuses: { ...defaults.resultStatuses, ...saved.resultStatuses },
    runStates: {
      active: saved.runStates.active ?? defaults.runStates.active,
      completed: saved.runStates.completed ?? defaults.runStates.completed,
    },
    milestoneTypeId: saved.milestoneTypeId ?? defaults.milestoneTypeId,
  };
}

/** Everything that stops an import from starting with this mapping. */
export function validateQaseMapping(
  config: QaseMappingConfiguration,
  analysis: QaseAnalysis
): QaseMappingProblem[] {
  const problems: QaseMappingProblem[] = [];
  const { source, existing } = analysis;

  const newProjects: string[] = [];
  for (const project of source.projects) {
    const mapping = config.projects[project.code];
    if (mapping?.action === "create") {
      if (!mapping.name) {
        problems.push({ code: "project_name_missing", subject: project.title });
      } else if (
        existing.projects.some((candidate) =>
          sameName(candidate.name, mapping.name)
        ) ||
        newProjects.some((name) => sameName(name, mapping.name))
      ) {
        problems.push({ code: "project_name_taken", subject: mapping.name });
      } else {
        newProjects.push(mapping.name);
      }
      continue;
    }
    const target = mapping?.mappedTo ?? null;
    if (!existing.projects.some((candidate) => candidate.id === target)) {
      problems.push({ code: "project_unmapped", subject: project.title });
    }
  }

  const newEmails = new Set<string>();
  for (const user of source.users) {
    const mapping = config.users[user.id];
    if (mapping?.action !== "create") {
      continue;
    }
    const subject = qaseUserLabel(user);
    if (!mapping.email) {
      problems.push({ code: "user_email_missing", subject });
    } else if (!EMAIL_PATTERN.test(mapping.email)) {
      problems.push({ code: "user_email_invalid", subject });
    } else if (newEmails.has(mapping.email)) {
      problems.push({ code: "user_email_reused", subject });
    } else {
      newEmails.add(mapping.email);
    }
    if (
      mapping.roleId === null
        ? !existing.roles.some((role) => role.isDefault)
        : !existing.roles.some((role) => role.id === mapping.roleId)
    ) {
      problems.push({ code: "user_role_missing", subject });
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

  const newStatuses: string[] = [];
  for (const status of source.resultStatuses) {
    const mapping = config.resultStatuses[status.id];
    if (mapping?.action === "create") {
      if (!mapping.name) {
        problems.push({
          code: "result_status_name_missing",
          subject: status.title,
        });
      } else if (
        existing.statuses.some((candidate) =>
          sameName(candidate.name, mapping.name)
        ) ||
        newStatuses.some((name) => sameName(name, mapping.name))
      ) {
        problems.push({
          code: "result_status_name_taken",
          subject: mapping.name,
        });
      } else {
        newStatuses.push(mapping.name);
      }
      continue;
    }
    const target = mapping?.mappedTo ?? null;
    if (!existing.statuses.some((candidate) => candidate.id === target)) {
      problems.push({ code: "result_status_unmapped", subject: status.title });
    }
  }

  if (source.hasRuns) {
    for (const kind of ["active", "completed"] as const) {
      if (
        !existing.runStates.some((state) => state.id === config.runStates[kind])
      ) {
        problems.push({ code: "run_state_unmapped", subject: kind });
      }
    }
  }

  if (
    source.hasMilestones &&
    !existing.milestoneTypes.some((type) => type.id === config.milestoneTypeId)
  ) {
    problems.push({ code: "milestone_type_missing" });
  }

  return problems;
}
