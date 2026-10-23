import { ReviewEntityType } from "~/zenstack/models";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import {
  buildFilterDimensions,
  dynamicFieldDimensionKey,
  type FilterDimensionRegistry,
} from "./filterDimensions";

/** The custom field types the repository can filter on. */
const FILTERABLE_FIELD_TYPES: readonly string[] = [
  "Dropdown",
  "Multi-Select",
  "Checkbox",
  "Integer",
  "Number",
  "Link",
  "Steps",
  "Date",
  "Text Long",
  "Text String",
];

export interface ProjectFilterRegistry {
  registry: FilterDimensionRegistry;
  /** Each dynamic-field dimension's key → the field's display name. */
  fieldLabels: Record<string, string>;
}

/**
 * The repository's filter dimensions for one project, as the repository page
 * builds them: the static dimensions, the custom fields of the project's
 * templates, In Review where the review workflow runs and Code Pins where
 * Impact Analysis is on. Run-only dimensions are left out — a stored filter
 * describes cases, not results.
 */
export async function loadProjectFilterRegistry(
  db: any,
  projectId: number
): Promise<ProjectFilterRegistry> {
  const [project, systemReview, templates] = await Promise.all([
    db.projects.findUnique({
      where: { id: projectId },
      select: {
        reviewWorkflowEnabled: true,
        impactEnabled: true,
        riskScoringEnabled: true,
      },
    }),
    isReviewFeatureSystemEnabled(db),
    db.templates.findMany({
      where: { isDeleted: false, projects: { some: { projectId } } },
      select: {
        caseFields: {
          where: { caseField: { isEnabled: true, isDeleted: false } },
          select: {
            caseField: {
              select: {
                id: true,
                displayName: true,
                type: { select: { type: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const fields = new Map<
    number,
    { fieldId: number; type: string; displayName: string }
  >();
  for (const template of templates as Array<{
    caseFields: Array<{
      caseField: {
        id: number;
        displayName: string;
        type: { type: string };
      };
    }>;
  }>) {
    for (const { caseField } of template.caseFields) {
      if (
        !FILTERABLE_FIELD_TYPES.includes(caseField.type.type) ||
        fields.has(caseField.id)
      ) {
        continue;
      }
      fields.set(caseField.id, {
        fieldId: caseField.id,
        type: caseField.type.type,
        displayName: caseField.displayName,
      });
    }
  }

  const registry = buildFilterDimensions({
    dynamicFields: [...fields.values()],
    includeInReview: systemReview && project?.reviewWorkflowEnabled === true,
    includeCodePins: project?.impactEnabled === true,
    includeRiskScore: project?.riskScoringEnabled === true,
  });
  const fieldLabels: Record<string, string> = {};
  for (const field of fields.values()) {
    fieldLabels[dynamicFieldDimensionKey(field.fieldId)] = field.displayName;
  }
  return { registry, fieldLabels };
}

/** The project's cases with a pending review request, for the In Review dimension. */
export async function loadPendingReviewCaseIds(
  db: any,
  projectId: number
): Promise<number[]> {
  const rows: { entityId: number }[] = await db.reviewRequest.findMany({
    where: {
      projectId,
      entityType: ReviewEntityType.CASE,
      status: "PENDING",
      isDeleted: false,
    },
    select: { entityId: true },
  });
  return [...new Set(rows.map((row) => row.entityId))];
}
