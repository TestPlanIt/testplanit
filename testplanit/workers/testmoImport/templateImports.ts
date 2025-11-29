import { Prisma } from "@prisma/client";
import type {
  TestmoMappingConfiguration,
  TestmoTemplateFieldTargetType,
  TestmoFieldOptionConfig,
} from "../../services/imports/testmo/types";
import { toNumberValue, toStringValue, toBooleanValue } from "./helpers";
import type { EntitySummaryResult } from "./types";

const SYSTEM_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

const generateSystemName = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "");
  return normalized || "status";
};

export async function importTemplates(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<{ summary: EntitySummaryResult; templateMap: Map<string, number> }> {
  const summary: EntitySummaryResult = {
    entity: "templates",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const templateMap = new Map<string, number>();

  for (const [key, config] of Object.entries(configuration.templates ?? {})) {
    const templateKey = Number(key);
    if (!Number.isFinite(templateKey) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Template ${templateKey} is configured to map but no target template was provided.`
        );
      }

      const existing = await tx.templates.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Template ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      config.name = config.name ?? existing.templateName;
      templateMap.set(existing.templateName, existing.id);
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Template ${templateKey} requires a name before it can be created.`
      );
    }

    const existing = await tx.templates.findFirst({
      where: {
        templateName: name,
        isDeleted: false,
      },
    });

    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.templateName;
      templateMap.set(existing.templateName, existing.id);
      summary.mapped += 1;
      continue;
    }

    const created = await tx.templates.create({
      data: {
        templateName: name,
        isEnabled: true,
        isDefault: false,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.templateName;
    templateMap.set(created.templateName, created.id);
    summary.created += 1;
  }

  const processedNames = new Set<string>(templateMap.keys());
  for (const entry of Object.values(configuration.templateFields ?? {})) {
    if (!entry) {
      continue;
    }
    const rawName =
      typeof entry.templateName === "string" ? entry.templateName : null;
    const templateName = rawName?.trim();
    if (!templateName || processedNames.has(templateName)) {
      continue;
    }
    processedNames.add(templateName);

    summary.total += 1;

    const existing = await tx.templates.findFirst({
      where: { templateName, isDeleted: false },
    });

    if (existing) {
      templateMap.set(templateName, existing.id);
      summary.mapped += 1;
      continue;
    }

    const created = await tx.templates.create({
      data: {
        templateName,
        isEnabled: true,
        isDefault: false,
      },
    });

    templateMap.set(templateName, created.id);
    summary.created += 1;
  }

  return { summary, templateMap };
}

export async function importTemplateFields(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  templateMap: Map<string, number>,
  datasetRows: Map<string, any[]>
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "templateFields",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      optionsCreated: 0,
      assignmentsCreated: 0,
    },
  };

  const details = summary.details as Record<string, number>;

  const ensureFieldTypeExists = async (typeId: number) => {
    try {
      const existing = await tx.caseFieldTypes.findUnique({
        where: { id: typeId },
      });
      if (!existing) {
        console.error(
          `[ERROR] Field type ${typeId} referenced by a template field was not found.`
        );
        const availableTypes = await tx.caseFieldTypes.findMany({
          select: { id: true, type: true },
        });
        console.error(`[ERROR] Available field types:`, availableTypes);
        throw new Error(
          `Field type ${typeId} referenced by a template field was not found. Available types: ${availableTypes.map((t) => `${t.id}:${t.type}`).join(", ")}`
        );
      }
    } catch (error) {
      console.error(`[ERROR] Failed to check field type ${typeId}:`, error);
      throw error;
    }
  };

  const toNumberOrNull = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return null;
  };

  const normalizeOptionConfigs = (
    input: unknown
  ): TestmoFieldOptionConfig[] => {
    if (!Array.isArray(input)) {
      return [];
    }

    const normalized: TestmoFieldOptionConfig[] = [];

    input.forEach((entry, index) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (!trimmed) {
          return;
        }
        normalized.push({
          name: trimmed,
          iconId: null,
          iconColorId: null,
          isEnabled: true,
          isDefault: index === 0,
          order: index,
        });
        return;
      }

      if (!entry || typeof entry !== "object") {
        return;
      }

      const record = entry as Record<string, unknown>;
      const rawName =
        typeof record.name === "string"
          ? record.name
          : typeof record.label === "string"
            ? record.label
            : typeof record.value === "string"
              ? record.value
              : typeof record.displayName === "string"
                ? record.displayName
                : typeof record.display_name === "string"
                  ? record.display_name
                  : null;
      const name = rawName?.trim();
      if (!name) {
        return;
      }

      const iconId =
        toNumberOrNull(
          record.iconId ?? record.icon_id ?? record.icon ?? record.iconID
        ) ?? null;
      const iconColorId =
        toNumberOrNull(
          record.iconColorId ??
            record.icon_color_id ??
            record.colorId ??
            record.color_id ??
            record.color
        ) ?? null;
      const isEnabled = toBooleanValue(
        record.isEnabled ?? record.enabled ?? record.is_enabled,
        true
      );
      const isDefault = toBooleanValue(
        record.isDefault ??
          record.is_default ??
          record.default ??
          record.defaultOption,
        false
      );
      const order =
        toNumberOrNull(
          record.order ??
            record.position ??
            record.ordinal ??
            record.index ??
            record.sort
        ) ?? index;

      normalized.push({
        name,
        iconId,
        iconColorId,
        isEnabled,
        isDefault,
        order,
      });
    });

    if (normalized.length === 0) {
      return [];
    }

    const sorted = normalized
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let defaultSeen = false;
    sorted.forEach((entry) => {
      if (entry.isDefault) {
        if (!defaultSeen) {
          defaultSeen = true;
        } else {
          entry.isDefault = false;
        }
      }
    });

    if (!defaultSeen) {
      sorted[0].isDefault = true;
    }

    return sorted.map((entry, index) => ({
      name: entry.name,
      iconId: entry.iconId ?? null,
      iconColorId: entry.iconColorId ?? null,
      isEnabled: entry.isEnabled ?? true,
      isDefault: entry.isDefault ?? false,
      order: index,
    }));
  };

  const templateIdBySourceId = new Map<number, number>();
  for (const [templateKey, templateConfig] of Object.entries(
    configuration.templates ?? {}
  )) {
    const sourceId = Number(templateKey);
    if (
      Number.isFinite(sourceId) &&
      templateConfig &&
      templateConfig.mappedTo !== null &&
      templateConfig.mappedTo !== undefined
    ) {
      templateIdBySourceId.set(sourceId, templateConfig.mappedTo);
    }
  }

  const fieldIdBySourceId = new Map<number, number>();
  const fieldTargetTypeBySourceId = new Map<
    number,
    TestmoTemplateFieldTargetType
  >();

  const templateSourceNameById = new Map<number, string>();
  const templateDatasetRows = datasetRows.get("templates") ?? [];
  for (const row of templateDatasetRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const name = toStringValue(record.name);
    if (sourceId !== null && name) {
      templateSourceNameById.set(sourceId, name);
    }
  }

  const appliedAssignments = new Set<string>();
  const makeAssignmentKey = (
    fieldId: number,
    templateId: number,
    targetType: TestmoTemplateFieldTargetType
  ) => `${targetType}:${templateId}:${fieldId}`;

  const resolveTemplateIdForName = async (
    templateName: string
  ): Promise<number | null> => {
    const trimmed = templateName.trim();
    if (!trimmed) {
      return null;
    }

    const templateId = templateMap.get(trimmed);
    if (templateId) {
      return templateId;
    }

    const existing = await tx.templates.findFirst({
      where: { templateName: trimmed, isDeleted: false },
    });

    if (existing) {
      templateMap.set(existing.templateName, existing.id);
      return existing.id;
    }

    const created = await tx.templates.create({
      data: {
        templateName: trimmed,
        isEnabled: true,
        isDefault: false,
      },
    });

    templateMap.set(created.templateName, created.id);
    return created.id;
  };

  const assignFieldToTemplate = async (
    fieldId: number,
    templateId: number,
    targetType: TestmoTemplateFieldTargetType,
    order: number | undefined
  ): Promise<void> => {
    const assignmentKey = makeAssignmentKey(fieldId, templateId, targetType);
    if (appliedAssignments.has(assignmentKey)) {
      return;
    }
    try {
      if (targetType === "case") {
        await tx.templateCaseAssignment.create({
          data: {
            caseFieldId: fieldId,
            templateId,
            order: order ?? 0,
          },
        });
      } else {
        await tx.templateResultAssignment.create({
          data: {
            resultFieldId: fieldId,
            templateId,
            order: order ?? 0,
          },
        });
      }
      appliedAssignments.add(assignmentKey);
      details.assignmentsCreated += 1;
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
      ) {
        throw error;
      }
      appliedAssignments.add(assignmentKey);
    }
  };

  for (const [key, config] of Object.entries(
    configuration.templateFields ?? {}
  )) {
    const fieldId = Number(key);
    if (!Number.isFinite(fieldId) || !config) {
      continue;
    }

    summary.total += 1;

    const targetType: TestmoTemplateFieldTargetType =
      config.targetType === "result" ? "result" : "case";
    config.targetType = targetType;
    fieldTargetTypeBySourceId.set(fieldId, targetType);

    const templateName = (config.templateName ?? "").trim();

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Template field ${fieldId} is configured to map but no target field was provided.`
        );
      }

      if (targetType === "case") {
        const existing = await tx.caseFields.findUnique({
          where: { id: config.mappedTo },
        });
        if (!existing) {
          throw new Error(
            `Case field ${config.mappedTo} selected for mapping was not found.`
          );
        }
      } else {
        const existing = await tx.resultFields.findUnique({
          where: { id: config.mappedTo },
        });
        if (!existing) {
          throw new Error(
            `Result field ${config.mappedTo} selected for mapping was not found.`
          );
        }
      }

      summary.mapped += 1;
      fieldIdBySourceId.set(fieldId, config.mappedTo);

      if (templateName) {
        const templateId = await resolveTemplateIdForName(templateName);
        if (templateId) {
          await assignFieldToTemplate(
            config.mappedTo,
            templateId,
            targetType,
            config.order ?? 0
          );
        }
      }
      continue;
    }

    const displayName = (
      config.displayName ??
      config.systemName ??
      `Field ${fieldId}`
    ).trim();
    let systemName = (config.systemName ?? "").trim();

    if (!systemName) {
      systemName = generateSystemName(displayName);
    }

    if (!SYSTEM_NAME_REGEX.test(systemName)) {
      throw new Error(
        `Template field "${displayName}" requires a valid system name (letters, numbers, underscore, starting with a letter).`
      );
    }

    const typeId = config.typeId ?? null;
    if (typeId === null) {
      throw new Error(
        `Template field "${displayName}" requires a field type before it can be created.`
      );
    }

    console.log(
      `[DEBUG] Processing field "${displayName}" (${systemName}) with typeId ${typeId}, action: ${config.action}`
    );
    await ensureFieldTypeExists(typeId);

    if (targetType === "case") {
      const existing = await tx.caseFields.findFirst({
        where: {
          systemName,
          isDeleted: false,
        },
      });

      if (existing) {
        config.action = "map";
        config.mappedTo = existing.id;
        config.systemName = existing.systemName;
        config.displayName = existing.displayName;
        summary.mapped += 1;
        continue;
      }
    } else {
      const existing = await tx.resultFields.findFirst({
        where: {
          systemName,
          isDeleted: false,
        },
      });

      if (existing) {
        config.action = "map";
        config.mappedTo = existing.id;
        config.systemName = existing.systemName;
        config.displayName = existing.displayName;
        summary.mapped += 1;
        continue;
      }
    }

    const fieldData = {
      displayName,
      systemName,
      hint: (config.hint ?? "").trim() || null,
      typeId,
      isRequired: config.isRequired ?? false,
      isRestricted: config.isRestricted ?? false,
      defaultValue: config.defaultValue ?? null,
      isChecked: config.isChecked ?? null,
      minValue:
        toNumberOrNull(config.minValue ?? config.minIntegerValue) ?? null,
      maxValue:
        toNumberOrNull(config.maxValue ?? config.maxIntegerValue) ?? null,
      initialHeight: toNumberOrNull(config.initialHeight) ?? null,
      isEnabled: true,
    };

    const createdField =
      targetType === "case"
        ? await tx.caseFields.create({ data: fieldData })
        : await tx.resultFields.create({ data: fieldData });

    config.action = "map";
    config.mappedTo = createdField.id;
    config.displayName = createdField.displayName;
    config.systemName = createdField.systemName;
    config.typeId = createdField.typeId;
    fieldIdBySourceId.set(fieldId, createdField.id);

    const dropdownOptionConfigs = normalizeOptionConfigs(
      config.dropdownOptions ?? []
    );

    if (dropdownOptionConfigs.length > 0) {
      // Fetch default icon and color to ensure all field options have valid values
      // Use the first available icon and color from the database
      const defaultIcon = await tx.fieldIcon.findFirst({
        orderBy: { id: "asc" },
        select: { id: true },
      });
      const defaultColor = await tx.color.findFirst({
        orderBy: { id: "asc" },
        select: { id: true },
      });

      if (!defaultIcon || !defaultColor) {
        throw new Error(
          "Default icon or color not found. Please ensure the database is properly seeded with FieldIcon and Color records."
        );
      }

      const createdOptions = [] as { id: number; order: number }[];
      for (const optionConfig of dropdownOptionConfigs) {
        const option = await tx.fieldOptions.create({
          data: {
            name: optionConfig.name,
            iconId: optionConfig.iconId ?? defaultIcon.id,
            iconColorId: optionConfig.iconColorId ?? defaultColor.id,
            isEnabled: optionConfig.isEnabled ?? true,
            isDefault: optionConfig.isDefault ?? false,
            isDeleted: false,
            order: optionConfig.order ?? 0,
          },
        });
        createdOptions.push({
          id: option.id,
          order: optionConfig.order ?? 0,
        });
      }

      if (targetType === "case") {
        await tx.caseFieldAssignment.createMany({
          data: createdOptions.map((option) => ({
            fieldOptionId: option.id,
            caseFieldId: createdField.id,
          })),
          skipDuplicates: true,
        });
      } else {
        await tx.resultFieldAssignment.createMany({
          data: createdOptions.map((option) => ({
            fieldOptionId: option.id,
            resultFieldId: createdField.id,
            order: option.order,
          })),
          skipDuplicates: true,
        });
      }

      details.optionsCreated += createdOptions.length;
      config.dropdownOptions = dropdownOptionConfigs;
    } else {
      config.dropdownOptions = undefined;
    }

    if (templateName) {
      const templateId = await resolveTemplateIdForName(templateName);
      if (templateId) {
        await assignFieldToTemplate(
          createdField.id,
          templateId,
          targetType,
          config.order ?? 0
        );
      }
    }

    summary.created += 1;
  }

  const templateFieldRows = datasetRows.get("template_fields") ?? [];
  for (const row of templateFieldRows) {
    const record = row as Record<string, unknown>;
    const templateSourceId = toNumberValue(record.template_id);
    const fieldSourceId = toNumberValue(record.field_id);
    if (templateSourceId === null || fieldSourceId === null) {
      continue;
    }

    let templateId = templateIdBySourceId.get(templateSourceId);
    const fieldId = fieldIdBySourceId.get(fieldSourceId);
    const targetType = fieldTargetTypeBySourceId.get(fieldSourceId);

    if (!fieldId || !targetType) {
      continue;
    }

    if (!templateId) {
      const templateName = templateSourceNameById.get(templateSourceId);
      if (!templateName) {
        continue;
      }
      const resolvedTemplateId = await resolveTemplateIdForName(templateName);
      if (!resolvedTemplateId) {
        continue;
      }
      templateIdBySourceId.set(templateSourceId, resolvedTemplateId);
      templateId = resolvedTemplateId;
    }

    await assignFieldToTemplate(fieldId, templateId, targetType, undefined);
  }

  templateDatasetRows.length = 0;
  templateFieldRows.length = 0;
  templateSourceNameById.clear();
  templateIdBySourceId.clear();
  fieldIdBySourceId.clear();
  fieldTargetTypeBySourceId.clear();
  appliedAssignments.clear();

  return summary;
}
