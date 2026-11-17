import { z } from "zod/v4";
import {
  buildCaseDraftPayload,
  type CaseDraftPayload,
} from "~/lib/services/caseDraft";
import {
  coerceCaseFieldValue,
  isMissingValue,
  type CoercibleField,
} from "~/lib/services/caseFieldValueCoercion";
import { templateFieldDefaults } from "~/lib/services/caseTemplateSwitch";
import { randomUuid } from "~/utils/randomUuid";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

/**
 * Turning a generated test case into a staged case.
 *
 * A staged case is a CaseDraft holding the Add Case form's values, so the
 * generation wizard's Stage action has to produce the same shape the form
 * would have saved: `name` / `templateId` / `workflowId` / `estimate` /
 * `automated` plus one key per template field, named by the field's id and
 * typed the way the form's schema (createFormSchema in AddCase.tsx) expects.
 * The import maps the same generated values through coerceCaseFieldValue, so
 * the two actions agree on what each value means.
 */

const StagedStepSchema = z.object({
  step: z.any().optional(),
  expectedResult: z.any().optional(),
});

const StagedFieldMappingSchema = z.object({
  fieldName: z.string(),
  caseFieldId: z.number(),
  fieldType: z.string(),
  fieldOptions: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        isDefault: z.boolean().optional(),
      })
    )
    .optional(),
  isRequired: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  isChecked: z.boolean().nullable().optional(),
  defaultValue: z.string().nullable().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
});

export const StagedGeneratedCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(StagedStepSchema).optional(),
  fieldValues: z.record(z.string(), z.any()),
  tags: z.array(z.string()).optional(),
});

export const StageInputSchema = z.object({
  projectId: z.number(),
  folderId: z.number(),
  templateId: z.number(),
  stateId: z.number(),
  autoGenerateTags: z.boolean(),
  testCases: z.array(StagedGeneratedCaseSchema),
  // Scoped to the fields the user kept selected, like the import's: a value
  // for an unmapped field is dropped.
  fieldMappings: z.array(StagedFieldMappingSchema),
  // The external issue the cases were generated from; upserted so the staged
  // cases carry the link the imported ones would.
  issue: z
    .object({
      externalId: z.string(),
      integrationId: z.number(),
      issueKey: z.string(),
      title: z.string(),
      description: z.string().optional(),
      externalUrl: z.string().optional(),
    })
    .optional(),
  // An existing internal issue to link instead (the seeded flows).
  linkIssueId: z.number().optional(),
});

export type StageInput = z.infer<typeof StageInputSchema>;
export type StagedGeneratedCase = z.infer<typeof StagedGeneratedCaseSchema>;
export type StagedFieldMapping = z.infer<typeof StagedFieldMappingSchema>;

export interface StageResult {
  status: "success" | "error";
  message?: string;
  stagedCount: number;
  stagedIds: string[];
  errors: string[];
}

/** A template field as the Add Case form receives it. */
export interface StagingTemplateField {
  caseFieldId: number;
  caseField: {
    id: number;
    displayName: string;
    isRequired: boolean;
    isChecked?: boolean | null;
    defaultValue?: string | null;
    type: { type: string };
    fieldOptions?: {
      fieldOption: {
        id: number;
        name: string;
        isDefault?: boolean | null;
        isEnabled?: boolean;
        isDeleted?: boolean;
      };
    }[];
  };
}

export interface StagedCaseDraft {
  name: string;
  payload: CaseDraftPayload;
  /** How many of the Add Case form's checks the values fail as they stand. */
  problemCount: number;
}

export interface StagedCaseContext {
  templateId: number;
  workflowId: number;
  fields: StagingTemplateField[];
  fieldMappings: StagedFieldMapping[];
  tagIds: number[];
  issueIds: number[];
}

function toCoercible(field: StagingTemplateField): CoercibleField {
  return {
    fieldName: field.caseField.displayName,
    fieldType: field.caseField.type.type,
    isRequired: field.caseField.isRequired,
  };
}

/**
 * The problems the My Staged Cases list would report for these values: a
 * name too short for the form, and a required field left empty. Stored as a
 * count on the staged case; the list recomputes the details when it opens.
 */
export function countStagedCaseProblems(
  values: Record<string, unknown>,
  fields: StagingTemplateField[]
): number {
  let problems = String(values.name ?? "").trim().length < 2 ? 1 : 0;
  for (const field of fields) {
    if (!field.caseField.isRequired) continue;
    const value = values[String(field.caseField.id)];
    switch (field.caseField.type.type) {
      case "Steps":
        if (!Array.isArray(value) || value.length === 0) problems += 1;
        break;
      case "Date":
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
          problems += 1;
        }
        break;
      default:
        if (isMissingValue(toCoercible(field), value)) problems += 1;
    }
  }
  return problems;
}

/**
 * The Add Case form's values for a generated test case: the template's
 * defaults, overlaid with every generated value that maps to a selected
 * field and survives coercion, and the generated steps as the form's step
 * rows. A value that cannot be coerced is dropped, as the import drops it.
 */
export function buildStagedCaseValues(
  testCase: StagedGeneratedCase,
  ctx: StagedCaseContext
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: testCase.name.trim().slice(0, 255),
    templateId: ctx.templateId,
    workflowId: ctx.workflowId,
    estimate: "",
    automated: false,
    ...templateFieldDefaults(ctx.fields),
  };

  const fieldsById = new Map(ctx.fields.map((f) => [f.caseFieldId, f]));
  const mappingsByName = new Map(
    ctx.fieldMappings.map((m) => [m.fieldName, m])
  );

  for (const [fieldName, raw] of Object.entries(testCase.fieldValues)) {
    const mapping = mappingsByName.get(fieldName);
    if (!mapping || mapping.fieldType === "Steps" || raw == null) continue;
    const field = fieldsById.get(mapping.caseFieldId);
    if (!field || field.caseField.type.type === "Steps") continue;
    const coerced = coerceCaseFieldValue(mapping, raw);
    if (!coerced.ok) continue;
    values[String(field.caseField.id)] =
      mapping.fieldType === "Date" && typeof coerced.value === "string"
        ? new Date(coerced.value)
        : coerced.value;
  }

  const stepsField = ctx.fields.find((f) => f.caseField.type.type === "Steps");
  if (stepsField && testCase.steps && testCase.steps.length > 0) {
    values[String(stepsField.caseField.id)] = testCase.steps.map((s) => ({
      id: randomUuid(),
      step: ensureTipTapJSON(s.step),
      expectedResult: ensureTipTapJSON(s.expectedResult),
    }));
  }

  return values;
}

export function buildStagedCaseDraft(
  testCase: StagedGeneratedCase,
  ctx: StagedCaseContext
): StagedCaseDraft {
  const values = buildStagedCaseValues(testCase, ctx);
  return {
    name: String(values.name),
    payload: buildCaseDraftPayload(values, {
      tags: ctx.tagIds,
      issues: ctx.issueIds,
    }),
    problemCount: countStagedCaseProblems(values, ctx.fields),
  };
}

/** The tag names a generated case carries, trimmed, de-duplicated, non-empty. */
export function uniqueTagNames(testCases: { tags?: string[] }[]): string[] {
  const names = new Set<string>();
  for (const tc of testCases) {
    for (const tag of tc.tags ?? []) {
      const trimmed = tag.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names];
}
