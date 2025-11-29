import type {
  Access,
  TestmoImportDataset,
  TestmoImportJob,
} from "@prisma/client";
import { db } from "~/server/db";
import type {
  TestmoConfigurationSuggestion,
  TestmoExistingConfigCategory,
  TestmoExistingConfigVariant,
  TestmoExistingConfiguration,
  TestmoExistingGroup,
  TestmoExistingTag,
  TestmoExistingIntegration,
  TestmoExistingMilestoneType,
  TestmoExistingRole,
  TestmoExistingStatus,
  TestmoExistingWorkflow,
  TestmoGroupSuggestion,
  TestmoTagSuggestion,
  TestmoIssueTargetSuggestion,
  TestmoMappingAnalysis,
  TestmoMilestoneTypeSuggestion,
  TestmoRolePermissions,
  TestmoRoleSuggestion,
  TestmoStatusSuggestion,
  TestmoExistingUser,
  TestmoUserSuggestion,
  TestmoWorkflowSuggestion,
  TestmoTemplateFieldSuggestion,
  TestmoExistingCaseField,
  TestmoExistingResultField,
  TestmoCaseFieldType,
  TestmoTemplateSuggestion,
  TestmoExistingTemplate,
  TestmoFieldOptionConfig,
} from "./types";

const DATASETS_FOR_CONFIGURATION = [
  "states",
  "statuses",
  "templates",
  "template_fields",
  "fields",
  "field_values",
  "repository_case_values",
  "milestone_types",
  "roles",
  "users",
  "groups",
  "configs",
  "tags",
  "issue_targets",
  "sessions",
  "session_results",
  "session_issues",
  "session_tags",
  "session_values",
];

const TESTMO_FIELD_TYPE_LABELS = new Map<number, string>([
  [1, "Text (String)"],
  [2, "Text (Long)"],
  [3, "Integer"],
  [4, "Number"],
  [5, "Date"],
  [6, "Link"],
  [7, "Checkbox"],
  [8, "Dropdown"],
  [9, "Multi-select"],
  [10, "Steps"],
]);

const resolveTestmoFieldTypeLabel = (value: unknown): string | null => {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }
  return TESTMO_FIELD_TYPE_LABELS.get(numeric) ?? `Unknown (type ${numeric})`;
};

function toPlainArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "object" && entry !== null
        ? JSON.parse(JSON.stringify(entry))
        : entry
    );
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map((entry) =>
      typeof entry === "object" && entry !== null
        ? JSON.parse(JSON.stringify(entry))
        : entry
    );
  }

  return [];
}

async function rowsFromDataset(
  dataset?: TestmoImportDataset | null,
  jobId?: string
): Promise<any[]> {
  if (!dataset) {
    return [];
  }

  const allRows = toPlainArray(dataset.allRows ?? []);
  if (allRows.length > 0) {
    return allRows as any[];
  }

  // If allRows is not available but we need all rows from staging
  if (jobId && DATASETS_FOR_CONFIGURATION.includes(dataset.name)) {
    const stagedRows = await db.testmoImportStaging.findMany({
      where: {
        jobId,
        datasetName: dataset.name,
      },
      orderBy: {
        rowIndex: "asc",
      },
      select: {
        rowData: true,
      },
    });

    if (stagedRows.length > 0) {
      return stagedRows.map((row) => {
        const data = row.rowData;
        return typeof data === "object" && data !== null
          ? JSON.parse(JSON.stringify(data))
          : data;
      });
    }
  }

  return toPlainArray(dataset.sampleRows ?? []) as any[];
}

function detectWorkflowType(name: string): string | null {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("draft") ||
    normalized.includes("new") ||
    normalized.includes("todo")
  ) {
    return "NOT_STARTED";
  }
  if (
    normalized.includes("progress") ||
    normalized.includes("review") ||
    normalized.includes("active") ||
    normalized.includes("running")
  ) {
    return "IN_PROGRESS";
  }
  if (
    normalized.includes("done") ||
    normalized.includes("complete") ||
    normalized.includes("closed") ||
    normalized.includes("retired")
  ) {
    return "DONE";
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAccess(value: unknown): Access | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "ADMIN":
    case "USER":
    case "PROJECTADMIN":
    case "NONE":
      return normalized as Access;
    default:
      return null;
  }
}

export async function buildMappingAnalysis(
  job: TestmoImportJob & { datasets: TestmoImportDataset[] }
): Promise<TestmoMappingAnalysis> {
  const datasetMap = new Map<string, TestmoImportDataset>();
  for (const dataset of job.datasets) {
    datasetMap.set(dataset.name, dataset);
  }

  const getRows = async (name: string) =>
    await rowsFromDataset(datasetMap.get(name), job.id);

  const summary = {
    projects: (await getRows("projects")).length,
    users: (await getRows("users")).length,
    testCases: (await getRows("repository_cases")).length,
    testRuns: (await getRows("runs")).length,
    sessions: (await getRows("sessions")).length,
    workflows: (await getRows("states")).length,
    statuses: (await getRows("statuses")).length,
    roles: (await getRows("roles")).length,
    configurations: (await getRows("configs")).length,
    milestoneTypes: (await getRows("milestone_types")).length,
    groups: (await getRows("groups")).length,
    templates: (await getRows("templates")).length,
    templateFields: (await getRows("template_fields")).length,
    customFields: (await getRows("fields")).length,
    integrations: (await getRows("issue_targets")).length,
    issues: (await getRows("issues")).length,
  };

  const preservedDatasets: Record<string, unknown> = {};
  for (const name of DATASETS_FOR_CONFIGURATION) {
    const rows = await getRows(name);
    if (rows.length > 0) {
      preservedDatasets[name] = rows;
    }
  }

  const requiresConfiguration =
    summary.users > 0 ||
    summary.workflows > 0 ||
    summary.statuses > 0 ||
    summary.roles > 0 ||
    summary.configurations > 0 ||
    summary.groups > 0 ||
    summary.integrations > 0 ||
    summary.templates > 0 ||
    summary.templateFields > 0 ||
    summary.customFields > 0 ||
    summary.milestoneTypes > 0;

  const [
    existingWorkflows,
    existingStatuses,
    existingRoles,
    existingMilestoneTypes,
    existingGroups,
    existingTags,
    existingIntegrations,
    existingUsers,
    existingConfigCategories,
    existingConfigVariants,
    existingConfigurations,
    existingCaseFields,
    existingResultFields,
    caseFieldTypes,
    existingTemplates,
  ] = await Promise.all([
    db.workflows.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        workflowType: true,
        scope: true,
        order: true,
      },
      orderBy: { order: "asc" },
    }),
    db.status.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        systemName: true,
        aliases: true,
        colorId: true,
        color: { select: { value: true } },
        isSuccess: true,
        isFailure: true,
        isCompleted: true,
        isEnabled: true,
        scope: {
          select: {
            scopeId: true,
          },
        },
      },
      orderBy: { order: "asc" },
    }),
    db.roles.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        isDefault: true,
        rolePermissions: {
          select: {
            area: true,
            canAddEdit: true,
            canDelete: true,
            canClose: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.milestoneTypes.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        isDefault: true,
        iconId: true,
        icon: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.groups.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        note: true,
      },
      orderBy: { name: "asc" },
    }),
    db.tags.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: "asc" },
    }),
    db.integration.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        provider: true,
        status: true,
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        isApi: true,
        access: true,
        roleId: true,
        role: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.configCategories.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        variants: {
          where: { isDeleted: false },
          select: { id: true, name: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.configVariants.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.configurations.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        variants: {
          select: {
            variantId: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.caseFields.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        displayName: true,
        systemName: true,
        isRestricted: true,
        typeId: true,
        type: {
          select: {
            type: true,
          },
        },
      },
      orderBy: { displayName: "asc" },
    }),
    db.resultFields.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        displayName: true,
        systemName: true,
        isRestricted: true,
        typeId: true,
        type: {
          select: {
            type: true,
          },
        },
      },
      orderBy: { displayName: "asc" },
    }),
    db.caseFieldTypes.findMany({
      select: {
        id: true,
        type: true,
      },
      orderBy: { type: "asc" },
    }),
    db.templates.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        templateName: true,
        caseFields: {
          select: {
            caseFieldId: true,
            order: true,
            caseField: {
              select: {
                systemName: true,
                displayName: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
        resultFields: {
          select: {
            resultFieldId: true,
            order: true,
            resultField: {
              select: {
                systemName: true,
                displayName: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { templateName: "asc" },
    }),
  ]);

  const caseFieldTypeLookupById = new Map<number, TestmoCaseFieldType>();
  const caseFieldTypeLookupByName = new Map<string, TestmoCaseFieldType>();
  caseFieldTypes.forEach((type) => {
    caseFieldTypeLookupById.set(type.id, type);
    caseFieldTypeLookupByName.set(type.type.trim().toLowerCase(), type);
  });

  const fieldValueRows = await rowsFromDataset(
    datasetMap.get("field_values"),
    job.id
  );

  // Helper to map Testmo icon name to FieldIcon ID
  const iconNameToId = async (
    iconName: string | null | undefined
  ): Promise<number | null> => {
    if (!iconName) return null;
    const trimmed = iconName.trim().toLowerCase();
    if (!trimmed) return null;

    // Map common Testmo icon names to lucide icon names
    const iconMapping: Record<string, string> = {
      "angle-double-up": "chevrons-up",
      "angle-double-down": "chevrons-down",
      "dot-circle": "circle-dot",
      "minus-circle": "circle-minus",
      "compress-alt": "minimize-2",
      "chevron-double-up": "chevrons-up",
    };

    const mappedName = iconMapping[trimmed] ?? trimmed;

    const icon = await db.fieldIcon.findFirst({
      where: { name: mappedName },
      select: { id: true },
    });

    return icon?.id ?? null;
  };

  // Helper to map Testmo color hex to Color ID
  const colorHexToId = async (
    colorHex: string | null | undefined
  ): Promise<number | null> => {
    if (!colorHex) return null;
    const trimmed = colorHex.trim().toLowerCase();
    if (!trimmed) return null;

    // Ensure hex has # prefix
    const normalizedHex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;

    const color = await db.color.findFirst({
      where: { value: { equals: normalizedHex, mode: "insensitive" } },
      select: { id: true },
    });

    return color?.id ?? null;
  };

  type FieldOptionData = {
    name: string;
    iconId: number | null;
    iconColorId: number | null;
    order: number;
  };

  const optionsByFieldId = new Map<number, FieldOptionData[]>();

  // Process field_values to extract full option data including icons and colors
  for (const row of fieldValueRows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const fieldId =
      toNumber(
        record.field_id ?? record.fieldId ?? record.field ?? record.id
      ) ?? null;
    if (fieldId === null) {
      continue;
    }
    const optionLabel =
      toTrimmedString(record.name) ??
      toTrimmedString(record.value) ??
      toTrimmedString(record.label) ??
      toTrimmedString(record.display_name) ??
      toTrimmedString(record.displayName) ??
      null;
    if (!optionLabel) {
      continue;
    }

    // Extract icon and color from Testmo data
    const iconName = toTrimmedString(record.icon);
    const colorHex = toTrimmedString(record.color);

    // Map to TestPlanIt IDs
    const iconId = await iconNameToId(iconName);
    const iconColorId = await colorHexToId(colorHex);

    const existing = optionsByFieldId.get(fieldId);
    const optionData: FieldOptionData = {
      name: optionLabel,
      iconId,
      iconColorId,
      order: existing ? existing.length : 0,
    };

    if (existing) {
      // Check if this option name already exists
      if (!existing.find((opt) => opt.name === optionLabel)) {
        existing.push(optionData);
      }
    } else {
      optionsByFieldId.set(fieldId, [optionData]);
    }
  }

  type ImportedFieldDefinition = {
    displayName: string | null;
    systemName: string | null;
    typeId: number | null;
    typeName: string | null;
    isRestricted: boolean;
    isRequired: boolean;
    hint?: string | null;
    defaultValue?: string | null;
    isChecked?: boolean | null;
    minValue?: number | null;
    maxValue?: number | null;
    minIntegerValue?: number | null;
    maxIntegerValue?: number | null;
    initialHeight?: number | null;
    dropdownOptions?: TestmoFieldOptionConfig[];
  };

  const fieldDefinitions = new Map<number, ImportedFieldDefinition>();
  const fieldRows = await rowsFromDataset(datasetMap.get("fields"), job.id);
  fieldRows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      return;
    }

    const record = row as Record<string, unknown>;
    const recordId = toNumber(record.id ?? record.field_id ?? record.fieldId);
    const id = recordId ?? index + 1;
    const typeId = toNumber(
      record.type_id ?? record.typeId ?? record.fieldTypeId
    );
    const numericTestmoTypeLabel = resolveTestmoFieldTypeLabel(record.type);
    const typeNameFromRecord =
      toTrimmedString(record.type_name) ??
      toTrimmedString(record.typeName) ??
      toTrimmedString(record.field_type) ??
      toTrimmedString(record.fieldType) ??
      numericTestmoTypeLabel ??
      (typeId !== null
        ? (caseFieldTypeLookupById.get(typeId)?.type ?? null)
        : null);

    const normalizedOptions =
      normalizeOptionList(
        record.dropdownOptions ??
          record.dropdown_options ??
          record.options ??
          record.choices
      ) ??
      (recordId !== null
        ? optionsByFieldId.get(recordId)?.map((opt) => ({
            name: opt.name,
            iconId: opt.iconId,
            iconColorId: opt.iconColorId,
            isEnabled: true,
            isDefault: opt.order === 0,
            order: opt.order,
          }))
        : undefined) ??
      undefined;

    fieldDefinitions.set(id, {
      displayName:
        toTrimmedString(record.display_name) ??
        toTrimmedString(record.displayName) ??
        toTrimmedString(record.label) ??
        null,
      systemName:
        toTrimmedString(record.system_name) ??
        toTrimmedString(record.systemName) ??
        toTrimmedString(record.name) ??
        null,
      typeId: typeId ?? null,
      typeName: typeNameFromRecord,
      isRestricted: toBoolean(
        record.is_restricted ?? record.restricted ?? false
      ),
      isRequired: toBoolean(record.is_required ?? record.required ?? false),
      hint:
        toTrimmedString(record.hint) ??
        toTrimmedString(record.description) ??
        undefined,
      defaultValue:
        toTrimmedString(record.default_value) ??
        toTrimmedString(record.defaultValue) ??
        undefined,
      isChecked:
        typeof record.is_checked === "boolean" ? record.is_checked : undefined,
      minValue: toNumber(record.min_value ?? record.minValue) ?? undefined,
      maxValue: toNumber(record.max_value ?? record.maxValue) ?? undefined,
      minIntegerValue:
        toNumber(record.min_integer_value ?? record.minIntegerValue) ??
        undefined,
      maxIntegerValue:
        toNumber(record.max_integer_value ?? record.maxIntegerValue) ??
        undefined,
      initialHeight:
        toNumber(record.initial_height ?? record.initialHeight) ?? undefined,
      dropdownOptions: normalizedOptions,
    });
  });

  const workflowSuggestions: TestmoWorkflowSuggestion[] = (
    await rowsFromDataset(datasetMap.get("states"), job.id)
  ).map((row) => {
    const id = toNumber((row as any)?.id) ?? 0;
    const name = String((row as any)?.name ?? `State ${id}`);
    const suggestedWorkflowType =
      name.trim().toLowerCase() === "rejected"
        ? "DONE"
        : detectWorkflowType(name);

    return {
      id,
      name,
      suggestedWorkflowType,
    };
  });

  const normalizeTemplateTarget = (
    value: unknown,
    fallback: "case" | "result"
  ): "case" | "result" => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "result" || normalized === "results") {
        return "result";
      }
      if (normalized === "case" || normalized === "cases") {
        return "case";
      }
    }
    if (typeof value === "boolean") {
      return value ? "result" : "case";
    }
    return fallback;
  };

  function normalizeOptionList(
    value: unknown
  ): TestmoFieldOptionConfig[] | undefined {
    if (!value) {
      return undefined;
    }

    if (Array.isArray(value)) {
      const entries: TestmoFieldOptionConfig[] = [];

      value.forEach((entry, index) => {
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          if (trimmed.length === 0) return;
          entries.push({
            name: trimmed,
            iconId: null,
            iconColorId: null,
            isEnabled: true,
            isDefault: index === 0,
            order: index,
          });
        } else if (typeof entry === "object" && entry) {
          const record = entry as Record<string, unknown>;
          const name =
            (typeof record.name === "string" ? record.name.trim() : null) ??
            (typeof record.value === "string" ? record.value.trim() : null);
          if (!name) return;

          entries.push({
            name,
            iconId:
              typeof record.iconId === "number" ? record.iconId : null,
            iconColorId:
              typeof record.iconColorId === "number"
                ? record.iconColorId
                : null,
            isEnabled:
              typeof record.isEnabled === "boolean"
                ? record.isEnabled
                : true,
            isDefault:
              typeof record.isDefault === "boolean"
                ? record.isDefault
                : index === 0,
            order: typeof record.order === "number" ? record.order : index,
          });
        }
      });

      return entries.length > 0 ? entries : undefined;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const segments = trimmed
        .split(/[\n,]+/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
      return segments.length > 0
        ? segments.map((name, index) => ({
            name,
            iconId: null,
            iconColorId: null,
            isEnabled: true,
            isDefault: index === 0,
            order: index,
          }))
        : undefined;
    }

    return undefined;
  }

  const UNKNOWN_TEMPLATE_LABEL = "Unknown template";

  const templateRows = await rowsFromDataset(
    datasetMap.get("templates"),
    job.id
  );
  const templateNameById = new Map<number, string>();
  templateRows.forEach((row) => {
    if (!row || typeof row !== "object") {
      return;
    }
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? null;
    if (id === null) {
      return;
    }
    const name =
      toTrimmedString(record.name) ??
      toTrimmedString(record.title) ??
      toTrimmedString(record.display_name) ??
      toTrimmedString(record.displayName);
    if (name) {
      templateNameById.set(id, name);
    }
  });

  const templateFieldRows = await rowsFromDataset(
    datasetMap.get("template_fields"),
    job.id
  );
  const rawTemplateFieldSuggestions: Array<{
    suggestion: TestmoTemplateFieldSuggestion;
    sourceIndex: number;
  }> = templateFieldRows
    .map((row, index) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const record = row as Record<string, unknown>;
      const idFromRecord = toNumber(record.id ?? record.field_id);
      const id = idFromRecord ?? index + 1;
      const fieldId = toNumber(
        record.field_id ?? record.fieldId ?? record.field
      );

      const templateIdValue =
        toNumber(record.template_id ?? record.templateId) ?? null;
      const templateNameResolved =
        toTrimmedString(record.template_name) ??
        toTrimmedString(record.templateName) ??
        toTrimmedString(record.template) ??
        (templateIdValue !== null
          ? (templateNameById.get(templateIdValue) ?? null)
          : null);
      const templateName = templateNameResolved ?? UNKNOWN_TEMPLATE_LABEL;

      const displayName =
        toTrimmedString(record.display_name) ??
        toTrimmedString(record.displayName) ??
        toTrimmedString(record.label) ??
        toTrimmedString(record.name) ??
        null;

      const systemName =
        toTrimmedString(record.system_name) ??
        toTrimmedString(record.systemName) ??
        toTrimmedString(record.name) ??
        (displayName ? displayName.replace(/\s+/g, "_").toLowerCase() : null);

      if (!displayName && !systemName && fieldId === null) {
        return null;
      }

      const fieldDefinition =
        fieldId !== null ? fieldDefinitions.get(fieldId) : undefined;

      const fieldType =
        toTrimmedString(record.field_type) ??
        toTrimmedString(record.fieldType) ??
        toTrimmedString(record.type_name) ??
        toTrimmedString(record.typeName) ??
        resolveTestmoFieldTypeLabel(record.type) ??
        fieldDefinition?.typeName ??
        null;

      const dropdownOptions =
        normalizeOptionList(
          record.dropdownOptions ??
            record.dropdown_options ??
            record.options ??
            record.choices
        ) ??
        (fieldId !== null
          ? optionsByFieldId.get(fieldId)?.map((opt) => ({
              name: opt.name,
              iconId: opt.iconId,
              iconColorId: opt.iconColorId,
              isEnabled: true,
              isDefault: opt.order === 0,
              order: opt.order,
            }))
          : undefined) ??
        fieldDefinition?.dropdownOptions;

      const resolvedTarget = normalizeTemplateTarget(
        record.target_type ??
          record.targetType ??
          record.scope ??
          record.assignment ??
          record.category ??
          record.entity,
        toBoolean(record.is_result ?? record.isResult ?? false)
          ? "result"
          : fieldDefinition?.typeName?.toLowerCase().includes("result")
            ? "result"
            : "case"
      );

      const templateIds = templateIdValue !== null ? [templateIdValue] : [];
      const templateNames = templateNameResolved ? [templateNameResolved] : [];

      const suggestion: TestmoTemplateFieldSuggestion = {
        id,
        fieldId: fieldId ?? null,
        templateId: templateIdValue,
        templateIds,
        templateName,
        templateNames,
        displayName: displayName ?? fieldDefinition?.displayName ?? null,
        systemName: systemName ?? fieldDefinition?.systemName ?? null,
        fieldType,
        targetType: resolvedTarget,
        isRequired: toBoolean(
          record.is_required ??
            record.required ??
            fieldDefinition?.isRequired ??
            false
        ),
        isRestricted: toBoolean(
          record.is_restricted ??
            record.restricted ??
            fieldDefinition?.isRestricted ??
            false
        ),
        hint:
          toTrimmedString(record.hint) ??
          toTrimmedString(record.description) ??
          fieldDefinition?.hint ??
          undefined,
        defaultValue:
          toTrimmedString(record.default_value) ??
          toTrimmedString(record.defaultValue) ??
          fieldDefinition?.defaultValue ??
          undefined,
        isChecked:
          typeof record.is_checked === "boolean"
            ? record.is_checked
            : (fieldDefinition?.isChecked ?? undefined),
        minValue:
          toNumber(record.min_value ?? record.minValue) ??
          fieldDefinition?.minValue ??
          undefined,
        maxValue:
          toNumber(record.max_value ?? record.maxValue) ??
          fieldDefinition?.maxValue ??
          undefined,
        minIntegerValue:
          toNumber(record.min_integer_value ?? record.minIntegerValue) ??
          fieldDefinition?.minIntegerValue ??
          undefined,
        maxIntegerValue:
          toNumber(record.max_integer_value ?? record.maxIntegerValue) ??
          fieldDefinition?.maxIntegerValue ??
          undefined,
        initialHeight:
          toNumber(record.initial_height ?? record.initialHeight) ??
          fieldDefinition?.initialHeight ??
          undefined,
        dropdownOptions,
        order:
          toNumber(record.order ?? record.position ?? record.ordinal) ?? null,
      } satisfies TestmoTemplateFieldSuggestion;

      return { suggestion, sourceIndex: index };
    })
    .filter(
      (
        entry
      ): entry is {
        suggestion: TestmoTemplateFieldSuggestion;
        sourceIndex: number;
      } => entry !== null
    );

  const mergedTemplateFieldSuggestions = new Map<
    string,
    {
      suggestion: TestmoTemplateFieldSuggestion;
      sourceIndex: number;
    }
  >();

  const templateKeyFor = (value: TestmoTemplateFieldSuggestion) => {
    if (value.fieldId !== null && value.fieldId !== undefined) {
      return `fid:${value.fieldId}|target:${value.targetType}`;
    }
    const systemNameKey = value.systemName?.trim().toLowerCase();
    if (systemNameKey) {
      return `fsys:${systemNameKey}|target:${value.targetType}`;
    }
    const displayKey = value.displayName?.trim().toLowerCase();
    if (displayKey) {
      return `fdisp:${displayKey}|target:${value.targetType}`;
    }
    return `id:${value.id}|target:${value.targetType}`;
  };

  const mergeTemplates = (
    current: TestmoTemplateFieldSuggestion,
    incoming: TestmoTemplateFieldSuggestion
  ): TestmoTemplateFieldSuggestion => {
    const templateIdSet = new Set<number>();
    const addTemplateId = (value: number | null | undefined) => {
      if (typeof value === "number") {
        templateIdSet.add(value);
      }
    };
    current.templateIds?.forEach((value) => addTemplateId(value));
    incoming.templateIds?.forEach((value) => addTemplateId(value));
    addTemplateId(current.templateId ?? null);
    addTemplateId(incoming.templateId ?? null);
    const mergedTemplateIds = Array.from(templateIdSet);

    const templateNameSet = new Set<string>();
    const addTemplateName = (value?: string | null, includeUnknown = false) => {
      if (!value) {
        return;
      }
      const normalized = value.trim();
      if (!normalized) {
        return;
      }
      if (!includeUnknown && normalized === UNKNOWN_TEMPLATE_LABEL) {
        return;
      }
      templateNameSet.add(normalized);
    };
    (current.templateNames ?? []).forEach((value) =>
      addTemplateName(value, true)
    );
    (incoming.templateNames ?? []).forEach((value) =>
      addTemplateName(value, true)
    );
    addTemplateName(current.templateName);
    addTemplateName(incoming.templateName);

    const mergedTemplateNames = Array.from(templateNameSet);

    const primaryTemplateName =
      mergedTemplateNames[0] ??
      current.templateName ??
      incoming.templateName ??
      UNKNOWN_TEMPLATE_LABEL;
    const primaryTemplateId =
      mergedTemplateIds[0] ?? current.templateId ?? incoming.templateId ?? null;

    return {
      ...current,
      fieldId: current.fieldId ?? incoming.fieldId ?? null,
      templateId: primaryTemplateId,
      templateIds: mergedTemplateIds,
      templateName: primaryTemplateName,
      templateNames: mergedTemplateNames,
      displayName: current.displayName ?? incoming.displayName ?? null,
      systemName: current.systemName ?? incoming.systemName ?? null,
      fieldType: current.fieldType ?? incoming.fieldType ?? null,
      isRequired: current.isRequired ?? incoming.isRequired,
      isRestricted: current.isRestricted ?? incoming.isRestricted,
      hint: current.hint ?? incoming.hint,
      defaultValue: current.defaultValue ?? incoming.defaultValue,
      isChecked: current.isChecked ?? incoming.isChecked,
      minValue: current.minValue ?? incoming.minValue,
      maxValue: current.maxValue ?? incoming.maxValue,
      minIntegerValue: current.minIntegerValue ?? incoming.minIntegerValue,
      maxIntegerValue: current.maxIntegerValue ?? incoming.maxIntegerValue,
      initialHeight: current.initialHeight ?? incoming.initialHeight,
      dropdownOptions:
        current.dropdownOptions && current.dropdownOptions.length > 0
          ? current.dropdownOptions
          : incoming.dropdownOptions,
      order: current.order ?? incoming.order ?? null,
    } satisfies TestmoTemplateFieldSuggestion;
  };

  for (const entry of rawTemplateFieldSuggestions) {
    const key = templateKeyFor(entry.suggestion);
    const existing = mergedTemplateFieldSuggestions.get(key);
    if (!existing) {
      mergedTemplateFieldSuggestions.set(key, entry);
      continue;
    }

    const mergedSuggestion = mergeTemplates(
      existing.suggestion,
      entry.suggestion
    );
    // preserve stable ordering by keeping the lowest source index
    const sourceIndex = Math.min(existing.sourceIndex, entry.sourceIndex);
    mergedTemplateFieldSuggestions.set(key, {
      suggestion: mergedSuggestion,
      sourceIndex,
    });
  }

  const templateFieldSuggestions = Array.from(
    mergedTemplateFieldSuggestions.values()
  )
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((entry) => entry.suggestion);

  summary.templateFields = templateFieldSuggestions.length;

  const templateFieldIdMap = new Map<number, Set<number>>();
  const templateCaseFieldIdMap = new Map<number, Set<number>>();
  const templateResultFieldIdMap = new Map<number, Set<number>>();
  const templateNameFallbackById = new Map<number, string>();

  templateFieldSuggestions.forEach((field) => {
    const templateIds: number[] = Array.from(
      new Set(
        (field.templateIds && field.templateIds.length > 0
          ? field.templateIds
          : typeof field.templateId === "number"
            ? [field.templateId]
            : []) as number[]
      )
    ).filter((value) => Number.isFinite(value));

    templateIds.forEach((templateId) => {
      const fieldIdSet =
        templateFieldIdMap.get(templateId) ?? new Set<number>();
      fieldIdSet.add(field.id);
      templateFieldIdMap.set(templateId, fieldIdSet);

      const targetMap =
        field.targetType === "result"
          ? templateResultFieldIdMap
          : templateCaseFieldIdMap;
      const targetSet = targetMap.get(templateId) ?? new Set<number>();
      targetSet.add(field.id);
      targetMap.set(templateId, targetSet);

      if (!templateNameFallbackById.has(templateId)) {
        const fallbackName =
          templateNameById.get(templateId) ??
          (field.templateNames && field.templateNames.length > 0
            ? field.templateNames[0]
            : field.templateName) ??
          UNKNOWN_TEMPLATE_LABEL;
        templateNameFallbackById.set(templateId, fallbackName);
      }
    });
  });

  const templateSuggestionMap = new Map<number, TestmoTemplateSuggestion>();

  templateRows.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      return;
    }
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? index + 1;
    if (!Number.isFinite(id)) {
      return;
    }
    const normalizedId = id as number;
    const name =
      templateNameById.get(normalizedId) ??
      toTrimmedString(record.name) ??
      toTrimmedString(record.title) ??
      `Template ${normalizedId}`;
    templateSuggestionMap.set(normalizedId, {
      id: normalizedId,
      name,
      templateFieldIds: [],
      caseTemplateFieldIds: [],
      resultTemplateFieldIds: [],
    });
  });

  const applyFieldIdsToSuggestion = (templateId: number) => {
    const suggestion = templateSuggestionMap.get(templateId);
    const templateFieldIds = Array.from(
      templateFieldIdMap.get(templateId) ?? []
    );
    const caseFieldIds = Array.from(
      templateCaseFieldIdMap.get(templateId) ?? []
    );
    const resultFieldIds = Array.from(
      templateResultFieldIdMap.get(templateId) ?? []
    );

    if (suggestion) {
      suggestion.templateFieldIds = templateFieldIds;
      suggestion.caseTemplateFieldIds = caseFieldIds;
      suggestion.resultTemplateFieldIds = resultFieldIds;
      return;
    }

    const fallbackName =
      templateNameById.get(templateId) ??
      templateNameFallbackById.get(templateId) ??
      `Template ${templateId}`;

    templateSuggestionMap.set(templateId, {
      id: templateId,
      name: fallbackName,
      templateFieldIds,
      caseTemplateFieldIds: caseFieldIds,
      resultTemplateFieldIds: resultFieldIds,
    });
  };

  templateFieldIdMap.forEach((_, templateId) => {
    applyFieldIdsToSuggestion(templateId);
  });

  const templateSuggestions = Array.from(templateSuggestionMap.values()).sort(
    (a, b) => {
      if (a.name.toLowerCase() === b.name.toLowerCase()) {
        return a.id - b.id;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
  );

  summary.templates = templateSuggestions.length;

  const statusSuggestions: TestmoStatusSuggestion[] = (
    await rowsFromDataset(datasetMap.get("statuses"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Status ${id}`);
    const systemName =
      typeof record.system_name === "string"
        ? record.system_name
        : name
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, "");

    let colorHex: string | null = null;
    if (typeof record.color === "string" && record.color.length > 0) {
      colorHex = record.color.startsWith("#")
        ? (record.color as string)
        : `#${record.color}`;
    }

    return {
      id,
      name,
      systemName,
      isSuccess: toBoolean(record.is_passed),
      isFailure: toBoolean(record.is_failed),
      isCompleted: toBoolean(record.is_final),
      isUntested: toBoolean(record.is_untested),
      colorHex,
    };
  });

  const extractRolePermissionsFromRecord = (
    value: unknown
  ): TestmoRolePermissions => {
    if (!value) {
      return {};
    }

    const result: TestmoRolePermissions = {};

    const assign = (areaValue: string, record: Record<string, unknown>) => {
      if (!areaValue) {
        return;
      }
      result[areaValue] = {
        canAddEdit: toBoolean(record.canAddEdit ?? false),
        canDelete: toBoolean(record.canDelete ?? false),
        canClose: toBoolean(record.canClose ?? false),
      };
    };

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const area = typeof record.area === "string" ? record.area : "";
          assign(area, record);
        }
      });
      return result;
    }

    if (value && typeof value === "object") {
      for (const [area, entry] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (entry && typeof entry === "object") {
          assign(area, entry as Record<string, unknown>);
        }
      }
    }

    return result;
  };

  const groupSuggestions: TestmoGroupSuggestion[] = (
    await rowsFromDataset(datasetMap.get("groups"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Group ${id}`);
    const note =
      typeof record.note === "string"
        ? record.note
        : typeof record.description === "string"
          ? record.description
          : null;

    return {
      id,
      name,
      note,
    };
  });

  const tagSuggestions: TestmoTagSuggestion[] = (
    await rowsFromDataset(datasetMap.get("tags"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Tag ${id}`);

    return {
      id,
      name,
    };
  });

  const issueTargetSuggestions: TestmoIssueTargetSuggestion[] = (
    await rowsFromDataset(datasetMap.get("issue_targets"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Issue Target ${id}`);
    const type = toNumber(record.type) ?? 0;
    const providerMap: Record<number, string> = {
      1: "JIRA",
      2: "GITHUB",
      3: "AZURE_DEVOPS",
      4: "JIRA",
    };
    const provider = providerMap[type] ?? "SIMPLE_URL";

    return {
      id,
      name,
      type,
      provider,
    };
  });

  const userSuggestions: TestmoUserSuggestion[] = (
    await rowsFromDataset(datasetMap.get("users"), job.id)
  )
    .map((row) => {
      const record = row as Record<string, unknown>;
      const id = toNumber(record.id) ?? 0;
      const email =
        toTrimmedString(record.email) ??
        toTrimmedString(record.email_address) ??
        toTrimmedString(record.emailAddress) ??
        toTrimmedString(record.user_email) ??
        toTrimmedString(record.userEmail) ??
        null;
      const name =
        toTrimmedString(record.name) ??
        toTrimmedString(record.full_name) ??
        toTrimmedString(record.fullName) ??
        toTrimmedString(record.display_name) ??
        toTrimmedString(record.displayName) ??
        toTrimmedString(record.username) ??
        null;
      const access =
        normalizeAccess(record.access) ??
        normalizeAccess(record.system_access) ??
        normalizeAccess(record.systemAccess) ??
        normalizeAccess(record.user_access) ??
        normalizeAccess(record.userAccess) ??
        null;
      const roleName =
        toTrimmedString(record.role_name) ??
        toTrimmedString(record.roleName) ??
        toTrimmedString(record.role) ??
        null;
      const activeSource =
        record.active ??
        record.is_active ??
        record.enabled ??
        record.isActive ??
        (typeof record.status === "string"
          ? record.status.toLowerCase() === "active"
          : undefined);
      const apiSource = record.is_api ?? record.api ?? record.isApi;

      const isActive =
        activeSource === undefined ? true : toBoolean(activeSource);
      const isApi = apiSource === undefined ? false : toBoolean(apiSource);

      return {
        id,
        email,
        name,
        isActive,
        isApi,
        access,
        roleName,
      } satisfies TestmoUserSuggestion;
    })
    .filter(
      (suggestion) => suggestion.id !== 0 || suggestion.email || suggestion.name
    );

  const roleSuggestions: TestmoRoleSuggestion[] = (
    await rowsFromDataset(datasetMap.get("roles"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Role ${id}`);
    const permissions = extractRolePermissionsFromRecord(record.permissions);
    const isDefault = toBoolean(record.is_default ?? record.isDefault ?? false);

    return {
      id,
      name,
      isDefault,
      permissions,
    };
  });

  const configurationSuggestions: TestmoConfigurationSuggestion[] = (
    await rowsFromDataset(datasetMap.get("configs"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Configuration ${id}`);
    const variantTokens = name
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    return {
      id,
      name,
      variantTokens,
    };
  });

  const milestoneTypeSuggestions: TestmoMilestoneTypeSuggestion[] = (
    await rowsFromDataset(datasetMap.get("milestone_types"), job.id)
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const id = toNumber(record.id) ?? 0;
    const name = String(record.name ?? `Milestone Type ${id}`);
    const iconName =
      typeof record.icon === "string"
        ? record.icon
        : typeof record.icon_name === "string"
          ? record.icon_name
          : null;

    const isDefault = toBoolean(record.is_default ?? record.isDefault ?? false);

    return {
      id,
      name,
      iconName,
      isDefault,
    };
  });

  const existingWorkflowEntities: TestmoExistingWorkflow[] =
    existingWorkflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      workflowType: workflow.workflowType,
      scope: workflow.scope ?? null,
      order: workflow.order ?? 0,
    }));

  const existingStatusEntities: TestmoExistingStatus[] = existingStatuses.map(
    (status) => ({
      id: status.id,
      name: status.name,
      systemName: status.systemName,
      aliases: status.aliases,
      colorHex: status.color?.value ?? null,
      colorId: status.colorId ?? null,
      isSuccess: status.isSuccess,
      isFailure: status.isFailure,
      isCompleted: status.isCompleted,
      isEnabled: status.isEnabled,
      scopeIds: status.scope?.map((assignment) => assignment.scopeId) ?? [],
    })
  );

  const existingGroupEntities: TestmoExistingGroup[] = existingGroups.map(
    (group) => ({
      id: group.id,
      name: group.name,
      note: group.note ?? null,
    })
  );

  const existingTagEntities: TestmoExistingTag[] = existingTags.map(
    (tag) => ({
      id: tag.id,
      name: tag.name,
    })
  );

  const existingUserEntities: TestmoExistingUser[] = existingUsers.map(
    (user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      isApi: user.isApi,
      access: user.access,
      roleId: user.roleId,
      roleName: user.role?.name ?? null,
    })
  );

  const existingRoleEntities: TestmoExistingRole[] = existingRoles.map(
    (role) => ({
      id: role.id,
      name: role.name,
      isDefault: role.isDefault,
      permissions: role.rolePermissions.reduce((acc, permission) => {
        acc[permission.area] = {
          canAddEdit: permission.canAddEdit,
          canDelete: permission.canDelete,
          canClose: permission.canClose,
        };
        return acc;
      }, {} as TestmoRolePermissions),
    })
  );

  const existingMilestoneTypeEntities: TestmoExistingMilestoneType[] =
    existingMilestoneTypes.map((type) => ({
      id: type.id,
      name: type.name,
      iconId: type.iconId ?? null,
      iconName: type.icon?.name ?? null,
      isDefault: type.isDefault,
    }));

  const existingConfigCategoryEntities: TestmoExistingConfigCategory[] =
    existingConfigCategories.map((category) => ({
      id: category.id,
      name: category.name,
    }));

  const existingConfigVariantEntities: TestmoExistingConfigVariant[] =
    existingConfigVariants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      categoryId: variant.categoryId,
      categoryName: variant.category?.name ?? "",
    }));

  const existingConfigurationEntities: TestmoExistingConfiguration[] =
    existingConfigurations.map((configuration) => ({
      id: configuration.id,
      name: configuration.name,
      variantIds: configuration.variants.map((entry) => entry.variantId),
    }));

  const existingCaseFieldEntities: TestmoExistingCaseField[] =
    existingCaseFields.map((field) => ({
      id: field.id,
      displayName: field.displayName,
      systemName: field.systemName,
      typeId: field.typeId,
      typeName: field.type?.type ?? "",
      isRestricted: field.isRestricted,
    }));

  const existingResultFieldEntities: TestmoExistingResultField[] =
    existingResultFields.map((field) => ({
      id: field.id,
      displayName: field.displayName,
      systemName: field.systemName,
      typeId: field.typeId,
      typeName: field.type?.type ?? "",
      isRestricted: field.isRestricted,
    }));

  const existingTemplateEntities: TestmoExistingTemplate[] =
    existingTemplates.map((template) => ({
      id: template.id,
      name: template.templateName,
      caseFields: template.caseFields.map((assignment) => ({
        fieldId: assignment.caseFieldId,
        systemName: assignment.caseField?.systemName ?? "",
        displayName: assignment.caseField?.displayName ?? "",
        order: assignment.order ?? null,
      })),
      resultFields: template.resultFields.map((assignment) => ({
        fieldId: assignment.resultFieldId,
        systemName: assignment.resultField?.systemName ?? "",
        displayName: assignment.resultField?.displayName ?? "",
        order: assignment.order ?? null,
      })),
    }));

  return {
    summary,
    requiresConfiguration,
    warnings: [],
    preservedDatasets,
    ambiguousEntities: {
      workflows: workflowSuggestions,
      statuses: statusSuggestions,
      roles: roleSuggestions,
      configurations: configurationSuggestions,
      milestoneTypes: milestoneTypeSuggestions,
      groups: groupSuggestions,
      tags: tagSuggestions,
      issueTargets: issueTargetSuggestions,
      users: userSuggestions,
      templates: templateSuggestions,
      templateFields: templateFieldSuggestions,
    },
    existingEntities: {
      workflows: existingWorkflowEntities,
      statuses: existingStatusEntities,
      roles: existingRoleEntities,
      configurationCategories: existingConfigCategoryEntities,
      configurationVariants: existingConfigVariantEntities,
      configurations: existingConfigurationEntities,
      milestoneTypes: existingMilestoneTypeEntities,
      groups: existingGroupEntities,
      tags: existingTagEntities,
      issueTargets: existingIntegrations.map((integration) => ({
        id: integration.id,
        name: integration.name,
        provider: integration.provider,
        status: integration.status,
      })),
      users: existingUserEntities,
      caseFields: existingCaseFieldEntities,
      resultFields: existingResultFieldEntities,
      caseFieldTypes: caseFieldTypes.map((type) => ({
        id: type.id,
        type: type.type,
      })),
      templates: existingTemplateEntities,
    },
  };
}
