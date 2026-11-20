import { emptyEditorContent } from "~/app/constants";

/**
 * Turns a test case version snapshot into edit form values, so an old version
 * can be loaded into the form and saved as a normal edit.
 *
 * Loaded from the version: name, estimate, steps, custom field values, tags
 * and linked issues. Not loaded: workflow state, folder and the automated
 * flag, which stay as the case has them now.
 */

export interface RestorableVersion {
  name: string;
  estimate: number | null;
  steps: unknown;
  tags: unknown;
  issues: unknown;
  caseFieldVersionValues: { field: string; value: unknown }[];
}

export interface RestoreTemplateField {
  caseField: {
    id: number;
    displayName: string | null;
    systemName: string;
    type: { type: string };
  };
}

export interface CaseVersionRestoreInput {
  version: RestorableVersion;
  /** Enabled fields of the template the form will show. */
  templateFields: RestoreTemplateField[];
  /** Tags that still exist, to turn the snapshot's tag names into ids. */
  tags: { id: number; name: string }[];
  /** Ids of the snapshot's issues the Issues field can still hold. */
  linkableIssueIds: number[];
  /** Formats the estimate (seconds) the way the form holds it. */
  formatEstimate: (seconds: number) => string;
}

export interface CaseVersionRestoreResult {
  /** Values to lay over the case's current form values. */
  values: Record<string, unknown>;
  /** What the snapshot holds that could not be loaded. */
  skipped: {
    /** Field names in the snapshot with no field in the template. */
    fields: string[];
    /** Tag names that no longer exist. */
    tags: string[];
    /** Linked issues that no longer exist or cannot be picked. */
    issues: number;
    /**
     * The snapshot recorded no custom field values at all. Older snapshots
     * can lack them, so the field values are left out of `values` and the
     * form keeps what the case has now.
     */
    fieldValuesNotRecorded: boolean;
  };
}

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toDocument = (value: unknown): object => {
  const parsed = parseJson(value);
  return typeof parsed === "object" && parsed !== null
    ? parsed
    : emptyEditorContent;
};

const asArray = (value: unknown): unknown[] => {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
};

export function caseVersionToFormValues({
  version,
  templateFields,
  tags,
  linkableIssueIds,
  formatEstimate,
}: CaseVersionRestoreInput): CaseVersionRestoreResult {
  const values: Record<string, unknown> = {
    name: version.name,
    estimate: version.estimate ? formatEstimate(version.estimate) : "",
  };

  // A snapshot stores shared steps already expanded to their content, so
  // every step comes back as a step of the case itself.
  values.steps = asArray(version.steps).map((step: any) => ({
    step: toDocument(step?.step),
    expectedResult: toDocument(step?.expectedResult),
    isShared: false,
  }));

  const tagByName = new Map(tags.map((tag) => [tag.name, tag.id]));
  const tagNames = asArray(version.tags).filter(
    (name): name is string => typeof name === "string"
  );
  values.tags = tagNames
    .map((name) => tagByName.get(name))
    .filter((id): id is number => id !== undefined);
  const skippedTags = tagNames.filter((name) => !tagByName.has(name));

  const snapshotIssueIds = asArray(version.issues)
    .map((issue: any) => issue?.id)
    .filter((id): id is number => typeof id === "number");
  const linkable = new Set(linkableIssueIds);
  const issueIds = snapshotIssueIds.filter((id) => linkable.has(id));
  values.issues = issueIds;
  const skippedIssues = snapshotIssueIds.length - issueIds.length;

  // A snapshot keys a field value by the field's display name, falling back
  // to its system name.
  const snapshotValues = new Map(
    version.caseFieldVersionValues.map((entry) => [entry.field, entry.value])
  );
  const usedNames = new Set<string>();
  const fieldValuesNotRecorded =
    version.caseFieldVersionValues.length === 0 &&
    templateFields.some((field) => field.caseField.type.type !== "Steps");
  for (const field of fieldValuesNotRecorded ? [] : templateFields) {
    const { id, displayName, systemName, type } = field.caseField;
    if (type.type === "Steps") continue;
    const name = [displayName, systemName].find(
      (candidate): candidate is string =>
        !!candidate && snapshotValues.has(candidate)
    );
    if (name === undefined) {
      // The version had no value for this field.
      values[id.toString()] = undefined;
      continue;
    }
    usedNames.add(name);
    const value = snapshotValues.get(name);
    if (value === null || value === undefined) {
      values[id.toString()] = undefined;
    } else if (type.type === "Date") {
      values[id.toString()] = new Date(value as string);
    } else {
      values[id.toString()] = value;
    }
  }
  const skippedFields = version.caseFieldVersionValues
    .filter(
      (entry) =>
        !usedNames.has(entry.field) &&
        entry.value !== null &&
        entry.value !== undefined
    )
    .map((entry) => entry.field);

  return {
    values,
    skipped: {
      fields: skippedFields,
      tags: skippedTags,
      issues: skippedIssues,
      fieldValuesNotRecorded,
    },
  };
}
