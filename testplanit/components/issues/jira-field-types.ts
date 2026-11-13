import { z } from "zod/v4";

export interface JiraFieldSchemaInfo {
  key: string;
  name: string;
  required: boolean;
  schema: {
    type: string;
    items?: string;
    system?: string;
    custom?: string;
  };
}

const SPRINT_FIELD_TYPE = "com.pyxis.greenhopper.jira:gh-sprint";

const TEAM_FIELD_TYPES = new Set([
  "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team",
  "com.atlassian.teams:rm-teams-custom-field-team",
]);

/** Jira Software's Sprint field. Jira reports it as an array, but create
 *  takes a single sprint id (a number). */
export function isJiraSprintField(field: JiraFieldSchemaInfo): boolean {
  return field.schema?.custom === SPRINT_FIELD_TYPE;
}

export function isJiraTeamField(field: JiraFieldSchemaInfo): boolean {
  return (
    TEAM_FIELD_TYPES.has(field.schema?.custom ?? "") ||
    field.name.toLowerCase().includes("team")
  );
}

const ID_REF_TYPES = new Set(["option", "priority", "version", "component"]);

function isFlaggedField(field: JiraFieldSchemaInfo): boolean {
  return field.key === "flagged" || field.name.toLowerCase() === "flagged";
}

/**
 * Jira reports a field's default as its own object(s); the form's pickers
 * hold ids. Returns the default in the form's shape.
 */
export function jiraDefaultFormValue(
  field: JiraFieldSchemaInfo,
  defaultValue: unknown
): unknown {
  const idOf = (value: unknown) =>
    value && typeof value === "object" && "id" in value
      ? String((value as { id: unknown }).id)
      : value;

  if (Array.isArray(defaultValue)) {
    return field.schema.type === "array" &&
      ID_REF_TYPES.has(field.schema.items ?? "") &&
      !isFlaggedField(field)
      ? defaultValue.map(idOf)
      : defaultValue;
  }
  if (ID_REF_TYPES.has(field.schema.type)) return idOf(defaultValue);
  if (
    field.schema.type === "user" &&
    defaultValue &&
    typeof defaultValue === "object"
  ) {
    const user = defaultValue as {
      accountId?: string;
      name?: string;
      key?: string;
    };
    return user.accountId ?? user.name ?? user.key ?? "";
  }
  return defaultValue;
}

/** A picked id, or an option object, as the `{ id }` reference Jira takes. */
export function jiraIdRef(value: unknown): { id: string } {
  return {
    id: String(
      value && typeof value === "object" && "id" in value
        ? (value as { id: unknown }).id
        : value
    ),
  };
}

export function buildJiraFieldsSchema(fields: JiraFieldSchemaInfo[]) {
  const schemaObject: Record<string, any> = {};

  fields.forEach((field) => {
    let fieldSchema: any;

    if (isJiraSprintField(field)) {
      fieldSchema = z.string();
      fieldSchema = field.required
        ? fieldSchema.min(1, `${field.name} is required`)
        : fieldSchema.optional();
      schemaObject[field.key] = fieldSchema;
      return;
    }

    switch (field.schema.type) {
      case "string":
        fieldSchema = z.string();
        if (field.required) {
          fieldSchema = fieldSchema.min(1, `${field.name} is required`);
        } else {
          fieldSchema = fieldSchema.optional();
        }
        break;

      case "number":
        fieldSchema = z.number();
        if (!field.required) {
          fieldSchema = fieldSchema.optional();
        }
        break;

      case "array":
        if (field.schema.items === "string") {
          fieldSchema = z.array(z.string());
        } else {
          fieldSchema = z.array(z.any());
        }
        if (!field.required) {
          fieldSchema = fieldSchema.optional();
        }
        break;

      case "user":
      case "option":
      case "priority":
      case "version":
      case "component":
        fieldSchema = z.string();
        if (!field.required) {
          fieldSchema = fieldSchema.optional();
        }
        break;

      default:
        fieldSchema = z.any();
        if (!field.required) {
          fieldSchema = fieldSchema.optional();
        }
    }

    schemaObject[field.key] = fieldSchema;
  });

  return z.object(schemaObject);
}
