import parseDuration from "parse-duration";
import type { z } from "zod/v4";
import { emptyEditorContent } from "~/app/constants/backend";
import {
  reviveCaseDraftValues,
  type CaseDraftPayload,
} from "~/lib/services/caseDraft";

/**
 * Turning saved Add Case drafts into cases, in a batch, from the My Drafts
 * list. A draft holds the Add Case form's values; this module checks them
 * against the project's current templates, states and folders the way the
 * form would, and maps the ones that pass to the bulk-create route's shape.
 */

/** A template field as the Add Case form receives it (`template.caseFields[i]`). */
export interface DraftTemplateField {
  caseFieldId: number;
  caseField: {
    id: number;
    displayName: string;
    isRequired: boolean;
    type: { type: string };
  };
}

export interface DraftTemplate {
  id: number;
  caseFields: DraftTemplateField[];
}

export interface DraftWorkflow {
  id: number;
  name: string;
}

export interface DraftCheckContext {
  templates: DraftTemplate[];
  workflows: DraftWorkflow[];
  /** The Add Case form's schema for a template's fields. */
  schemaFor: (template: DraftTemplate) => z.ZodType;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export interface DraftCheck {
  template: DraftTemplate | null;
  values: Record<string, unknown>;
  /** Why the draft cannot be created as it stands; empty when it can. */
  problems: string[];
}

/**
 * Validate a draft against the current project setup: its folder must still
 * exist, its template must still be assigned, its state must still exist,
 * and its values must pass the Add Case form's schema plus the form's own
 * required-date check.
 */
export function checkDraft(
  draft: { payload: CaseDraftPayload; folderMissing: boolean },
  ctx: DraftCheckContext
): DraftCheck {
  const values = reviveCaseDraftValues(draft.payload);
  const problems: string[] = [];
  const { t } = ctx;
  if (draft.folderMissing) {
    problems.push(t("repository.savedDrafts.problemFolder"));
  }
  const templateId =
    typeof values.templateId === "number" ? values.templateId : null;
  const template = ctx.templates.find((tp) => tp.id === templateId) ?? null;
  if (!template) {
    problems.push(t("repository.savedDrafts.problemTemplate"));
    return { template: null, values, problems };
  }
  if (!ctx.workflows.some((w) => w.id === values.workflowId)) {
    problems.push(t("repository.savedDrafts.problemState"));
  }

  const labelFor = (key: string) => {
    switch (key) {
      case "name":
        return t("repository.addCase.name");
      case "workflowId":
        return t("common.fields.state");
      case "estimate":
        return t("common.fields.estimate");
      case "automated":
        return t("common.fields.automated");
      default:
        return (
          template.caseFields.find((cf) => String(cf.caseField.id) === key)
            ?.caseField.displayName ?? key
        );
    }
  };

  const result = ctx.schemaFor(template).safeParse(values);
  if (!result.success) {
    const seen = new Set<string>();
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key === "workflowId" || seen.has(key)) continue;
      seen.add(key);
      problems.push(
        t("repository.savedDrafts.problemField", {
          field: labelFor(key),
          message: issue.message,
        })
      );
    }
  }
  for (const cf of template.caseFields) {
    if (cf.caseField.type.type !== "Date" || !cf.caseField.isRequired) continue;
    const value = values[String(cf.caseField.id)];
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      problems.push(
        t("repository.savedDrafts.problemField", {
          field: cf.caseField.displayName,
          message: t("common.errors.fieldRequired"),
        })
      );
    }
  }
  return { template, values, problems };
}

/** The case object the bulk-create route accepts. */
export interface BulkCreateCase {
  name: string;
  folderId: number;
  stateName: string;
  automated?: boolean;
  estimate?: number;
  tags?: number[];
  issueIds?: number[];
  steps?: {
    text?: string;
    expectedResult?: string;
    order: number;
    sharedStepGroupId?: number;
  }[];
  customFields?: Record<string, unknown>;
}

interface DraftStep {
  step?: unknown;
  expectedResult?: unknown;
  sharedStepGroupId?: number;
}

const docString = (content: unknown): string =>
  typeof content === "string"
    ? content
    : JSON.stringify(content ?? emptyEditorContent);

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Text content of a serialized or parsed Tiptap document. */
export function richTextToPlain(value: unknown): string {
  let doc: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return value;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === "string") return n.text;
    if (n.type === "hardBreak") return "\n";
    const inner = (n.content ?? []).map(walk);
    return n.type === "doc" ? inner.join("\n") : inner.join("");
  };
  return walk(doc).trim();
}

/**
 * Map a checked draft to the bulk-create case shape, the way Add Case's
 * submit maps its form: numeric fields to numbers, dates to ISO strings,
 * rich text to a document, steps as the form stores them.
 */
export function draftToBulkCreateCase(
  check: DraftCheck & { template: DraftTemplate },
  draft: { folderId: number; payload: CaseDraftPayload },
  workflows: DraftWorkflow[]
): BulkCreateCase {
  const { values, template } = check;
  const workflow = workflows.find((w) => w.id === values.workflowId);
  const out: BulkCreateCase = {
    name: String(values.name ?? "").trim(),
    folderId: draft.folderId,
    stateName: workflow?.name ?? "",
    automated: values.automated === true,
  };
  const estimate =
    typeof values.estimate === "string" ? values.estimate.trim() : "";
  if (estimate) {
    const ms = parseDuration(estimate);
    if (ms != null && Number.isFinite(ms) && ms >= 0) {
      out.estimate = Math.round(ms / 1000);
    }
  }
  const tags = (draft.payload.extras.tags ?? []).filter(
    (id): id is number => typeof id === "number"
  );
  if (tags.length > 0) out.tags = [...new Set(tags)];
  const issueIds = (draft.payload.extras.issues ?? []).filter(
    (id): id is number => typeof id === "number"
  );
  if (issueIds.length > 0) out.issueIds = [...new Set(issueIds)];

  const customFields: Record<string, unknown> = {};
  for (const cf of template.caseFields) {
    const field = cf.caseField;
    const value = values[String(field.id)];
    switch (field.type.type) {
      case "Steps": {
        const steps = Array.isArray(value) ? (value as DraftStep[]) : [];
        if (steps.length > 0) {
          out.steps = steps.map((s, i) => ({
            text: docString(s.step),
            expectedResult: docString(s.expectedResult),
            order: i,
            ...(s.sharedStepGroupId
              ? { sharedStepGroupId: s.sharedStepGroupId }
              : {}),
          }));
        }
        break;
      }
      case "Text Long": {
        if (richTextToPlain(value) === "") break;
        try {
          customFields[field.displayName] =
            typeof value === "string" ? JSON.parse(value) : value;
        } catch {
          customFields[field.displayName] = value;
        }
        break;
      }
      case "Integer":
      case "Number": {
        if (isEmptyValue(value)) break;
        customFields[field.displayName] = Number(value);
        break;
      }
      case "Date": {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          customFields[field.displayName] = value.toISOString();
        }
        break;
      }
      case "Checkbox":
        customFields[field.displayName] = value === true;
        break;
      default:
        if (isEmptyValue(value)) break;
        customFields[field.displayName] = value;
    }
  }
  if (Object.keys(customFields).length > 0) out.customFields = customFields;
  return out;
}

/**
 * The bulk-create route takes one template per request, so a batch of
 * drafts is sent as one request per template, in list order within each.
 */
export function groupByTemplate<T extends { templateId: number }>(
  items: T[]
): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const list = groups.get(item.templateId) ?? [];
    list.push(item);
    groups.set(item.templateId, list);
  }
  return groups;
}
