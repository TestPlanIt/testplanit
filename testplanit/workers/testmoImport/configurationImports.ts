import { Prisma, ApplicationArea } from "@prisma/client";
import type {
  TestmoMappingConfiguration,
  TestmoConfigurationMappingConfig,
  TestmoConfigVariantMappingConfig,
} from "../../services/imports/testmo/types";
import { toNumberValue } from "./helpers";
import type { EntitySummaryResult } from "./types";

const ensureWorkflowType = (value: unknown): "NOT_STARTED" | "IN_PROGRESS" | "DONE" => {
  if (value === "NOT_STARTED" || value === "IN_PROGRESS" || value === "DONE") {
    return value;
  }
  return "NOT_STARTED";
};

const ensureWorkflowScope = (
  value: unknown
): "CASES" | "RUNS" | "SESSIONS" => {
  if (value === "CASES" || value === "RUNS" || value === "SESSIONS") {
    return value;
  }
  return "CASES";
};

export async function importWorkflows(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "workflows",
    total: 0,
    created: 0,
    mapped: 0,
  };

  for (const [key, config] of Object.entries(configuration.workflows ?? {})) {
    const workflowId = Number(key);
    if (!Number.isFinite(workflowId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Workflow ${workflowId} is configured to map but no target workflow was provided.`
        );
      }

      const existing = await tx.workflows.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Workflow ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Workflow ${workflowId} requires a name before it can be created.`
      );
    }

    const iconId = config.iconId ?? null;
    const colorId = config.colorId ?? null;

    if (iconId === null || colorId === null) {
      throw new Error(
        `Workflow "${name}" must include both an icon and a color before creation.`
      );
    }

    const workflowType = ensureWorkflowType(config.workflowType);
    const scope = ensureWorkflowScope(config.scope);

    const existingByName = await tx.workflows.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existingByName) {
      config.action = "map";
      config.mappedTo = existingByName.id;
      summary.mapped += 1;
      continue;
    }

    const created = await tx.workflows.create({
      data: {
        name,
        workflowType,
        scope,
        iconId,
        colorId,
        isEnabled: true,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    summary.created += 1;
  }

  return summary;
}

export async function importGroups(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "groups",
    total: 0,
    created: 0,
    mapped: 0,
  };

  for (const [key, config] of Object.entries(configuration.groups ?? {})) {
    const groupId = Number(key);
    if (!Number.isFinite(groupId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Group ${groupId} is configured to map but no target group was provided.`
        );
      }

      const existing = await tx.groups.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Group ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Group ${groupId} requires a name before it can be created.`
      );
    }

    const existing = await tx.groups.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }

    const created = await tx.groups.create({
      data: {
        name,
        note: (config.note ?? "").trim() || null,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    config.note = created.note ?? null;
    summary.created += 1;
  }

  return summary;
}

export async function importTags(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "tags",
    total: 0,
    created: 0,
    mapped: 0,
  };

  for (const [key, config] of Object.entries(configuration.tags ?? {})) {
    const tagId = Number(key);
    if (!Number.isFinite(tagId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Tag ${tagId} is configured to map but no target tag was provided.`
        );
      }

      const existing = await tx.tags.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Tag ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(`Tag ${tagId} requires a name before it can be created.`);
    }

    const existing = await tx.tags.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }

    const created = await tx.tags.create({
      data: {
        name,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }

  return summary;
}

export async function importRoles(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "roles",
    total: 0,
    created: 0,
    mapped: 0,
  };

  for (const [key, config] of Object.entries(configuration.roles ?? {})) {
    const roleId = Number(key);
    if (!Number.isFinite(roleId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Role ${roleId} is configured to map but no target role was provided.`
        );
      }

      const existing = await tx.roles.findUnique({
        where: { id: config.mappedTo },
      });
      if (!existing) {
        throw new Error(
          `Role ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Role ${roleId} requires a name before it can be created.`
      );
    }

    const existing = await tx.roles.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }

    if (config.isDefault) {
      await tx.roles.updateMany({
        data: { isDefault: false },
        where: { isDefault: true },
      });
    }

    const created = await tx.roles.create({
      data: {
        name,
        isDefault: config.isDefault ?? false,
      },
    });

    const permissions = config.permissions ?? {};
    const permissionEntries = Object.entries(permissions).map(
      ([area, permission]) => ({
        roleId: created.id,
        area: area as ApplicationArea,
        canAddEdit: permission?.canAddEdit ?? false,
        canDelete: permission?.canDelete ?? false,
        canClose: permission?.canClose ?? false,
      })
    );

    if (permissionEntries.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionEntries,
        skipDuplicates: true,
      });
    }

    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }

  return summary;
}

export async function importMilestoneTypes(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "milestoneTypes",
    total: 0,
    created: 0,
    mapped: 0,
  };

  for (const [key, config] of Object.entries(
    configuration.milestoneTypes ?? {}
  )) {
    const milestoneId = Number(key);
    if (!Number.isFinite(milestoneId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Milestone type ${milestoneId} is configured to map but no target type was provided.`
        );
      }

      const existing = await tx.milestoneTypes.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Milestone type ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Milestone type ${milestoneId} requires a name before it can be created.`
      );
    }

    const existing = await tx.milestoneTypes.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
      continue;
    }

    if (config.isDefault) {
      await tx.milestoneTypes.updateMany({
        data: { isDefault: false },
        where: { isDefault: true },
      });
    }

    if (config.iconId !== null && config.iconId !== undefined) {
      const iconExists = await tx.fieldIcon.findUnique({
        where: { id: config.iconId },
      });
      if (!iconExists) {
        throw new Error(
          `Icon ${config.iconId} configured for milestone type "${name}" does not exist.`
        );
      }
    }

    const created = await tx.milestoneTypes.create({
      data: {
        name,
        iconId: config.iconId ?? null,
        isDefault: config.isDefault ?? false,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    config.name = created.name;
    summary.created += 1;
  }

  return summary;
}

const resolveConfigurationVariants = async (
  tx: Prisma.TransactionClient,
  mapping: TestmoConfigurationMappingConfig
): Promise<{ variantIds: number[]; createdCount: number }> => {
  const variantIds: number[] = [];
  let createdCount = 0;

  for (const [tokenIndex, variantConfig] of Object.entries(
    mapping.variants ?? {}
  )) {
    const index = Number(tokenIndex);
    if (!Number.isFinite(index) || !variantConfig) {
      continue;
    }

    const entry = variantConfig as TestmoConfigVariantMappingConfig;

    if (entry.action === "map-variant") {
      if (
        entry.mappedVariantId === null ||
        entry.mappedVariantId === undefined
      ) {
        throw new Error(
          `Configuration variant ${entry.token} is configured to map but no variant was selected.`
        );
      }

      const existing = await tx.configVariants.findUnique({
        where: { id: entry.mappedVariantId },
        include: { category: true },
      });

      if (!existing) {
        throw new Error(
          `Configuration variant ${entry.mappedVariantId} selected for mapping was not found.`
        );
      }

      entry.mappedVariantId = existing.id;
      entry.categoryId = existing.categoryId;
      entry.categoryName = existing.category.name;
      entry.variantName = existing.name;
      variantIds.push(existing.id);
      continue;
    }

    if (entry.action === "create-variant-existing-category") {
      if (entry.categoryId === null || entry.categoryId === undefined) {
        throw new Error(
          `Configuration variant ${entry.token} requires a category to be selected before creation.`
        );
      }

      const category = await tx.configCategories.findUnique({
        where: { id: entry.categoryId },
      });

      if (!category) {
        throw new Error(
          `Configuration category ${entry.categoryId} associated with variant ${entry.token} was not found.`
        );
      }

      const variantName = (entry.variantName ?? entry.token).trim();
      if (!variantName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a name before it can be created.`
        );
      }

      const existingVariant = await tx.configVariants.findFirst({
        where: {
          categoryId: category.id,
          name: variantName,
          isDeleted: false,
        },
      });

      if (existingVariant) {
        entry.action = "map-variant";
        entry.mappedVariantId = existingVariant.id;
        entry.categoryId = category.id;
        entry.categoryName = category.name;
        entry.variantName = existingVariant.name;
        variantIds.push(existingVariant.id);
        continue;
      }

      const createdVariant = await tx.configVariants.create({
        data: {
          name: variantName,
          categoryId: category.id,
        },
      });

      entry.action = "map-variant";
      entry.mappedVariantId = createdVariant.id;
      entry.categoryId = category.id;
      entry.categoryName = category.name;
      entry.variantName = createdVariant.name;
      variantIds.push(createdVariant.id);
      createdCount += 1;
      continue;
    }

    if (entry.action === "create-category-variant") {
      const categoryName = (entry.categoryName ?? entry.token).trim();
      const variantName = (entry.variantName ?? entry.token).trim();

      if (!categoryName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a category name before it can be created.`
        );
      }
      if (!variantName) {
        throw new Error(
          `Configuration variant ${entry.token} requires a variant name before it can be created.`
        );
      }

      let category = await tx.configCategories.findFirst({
        where: { name: categoryName, isDeleted: false },
      });

      if (!category) {
        category = await tx.configCategories.create({
          data: { name: categoryName },
        });
      }

      let variant = await tx.configVariants.findFirst({
        where: {
          categoryId: category.id,
          name: variantName,
          isDeleted: false,
        },
      });

      if (!variant) {
        variant = await tx.configVariants.create({
          data: {
            name: variantName,
            categoryId: category.id,
          },
        });
        createdCount += 1;
      }

      entry.action = "map-variant";
      entry.mappedVariantId = variant.id;
      entry.categoryId = category.id;
      entry.categoryName = category.name;
      entry.variantName = variant.name;
      variantIds.push(variant.id);
      continue;
    }

    throw new Error(
      `Unsupported configuration variant action "${entry.action}" for token ${entry.token}.`
    );
  }

  return { variantIds: Array.from(new Set(variantIds)), createdCount };
};

export async function importConfigurations(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "configurations",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      variantsCreated: 0,
    },
  };

  for (const [key, configEntry] of Object.entries(
    configuration.configurations ?? {}
  )) {
    const configId = Number(key);
    if (!Number.isFinite(configId) || !configEntry) {
      continue;
    }

    summary.total += 1;

    const entry = configEntry as TestmoConfigurationMappingConfig;

    if (entry.action === "map") {
      if (entry.mappedTo === null || entry.mappedTo === undefined) {
        throw new Error(
          `Configuration ${configId} is configured to map but no target configuration was provided.`
        );
      }

      const existing = await tx.configurations.findUnique({
        where: { id: entry.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Configuration ${entry.mappedTo} selected for mapping was not found.`
        );
      }

      entry.mappedTo = existing.id;
      const { variantIds, createdCount } = await resolveConfigurationVariants(
        tx,
        entry
      );

      if (variantIds.length > 0) {
        await tx.configurationConfigVariant.createMany({
          data: variantIds.map((variantId) => ({
            configurationId: existing.id,
            variantId,
          })),
          skipDuplicates: true,
        });
      }

      (summary.details as Record<string, unknown>).variantsCreated =
        ((summary.details as Record<string, unknown>)
          .variantsCreated as number) + createdCount;

      summary.mapped += 1;
      continue;
    }

    const name = (entry.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Configuration ${configId} requires a name before it can be created.`
      );
    }

    let configurationRecord = await tx.configurations.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (!configurationRecord) {
      configurationRecord = await tx.configurations.create({ data: { name } });
      summary.created += 1;
    } else {
      summary.mapped += 1;
    }

    entry.action = "map";
    entry.mappedTo = configurationRecord.id;
    entry.name = configurationRecord.name;

    const { variantIds, createdCount } = await resolveConfigurationVariants(
      tx,
      entry
    );

    if (variantIds.length > 0) {
      await tx.configurationConfigVariant.createMany({
        data: variantIds.map((variantId) => ({
          configurationId: configurationRecord.id,
          variantId,
        })),
        skipDuplicates: true,
      });
    }

    (summary.details as Record<string, unknown>).variantsCreated =
      ((summary.details as Record<string, unknown>).variantsCreated as number) +
      createdCount;
  }

  return summary;
}

export async function importUserGroups(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "userGroups",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const userGroupRows = datasetRows.get("user_groups") ?? [];

  for (const row of userGroupRows) {
    summary.total += 1;

    const testmoUserId = toNumberValue(row.user_id);
    const testmoGroupId = toNumberValue(row.group_id);

    if (!testmoUserId || !testmoGroupId) {
      continue;
    }

    // Resolve the mapped user ID
    const userConfig = configuration.users?.[testmoUserId];
    if (!userConfig || userConfig.action !== "map" || !userConfig.mappedTo) {
      // User wasn't imported/mapped, skip this group assignment
      continue;
    }

    // Resolve the mapped group ID
    const groupConfig = configuration.groups?.[testmoGroupId];
    if (!groupConfig || groupConfig.action !== "map" || !groupConfig.mappedTo) {
      // Group wasn't imported/mapped, skip this assignment
      continue;
    }

    const userId = userConfig.mappedTo;
    const groupId = groupConfig.mappedTo;

    // Check if assignment already exists
    const existing = await tx.groupAssignment.findUnique({
      where: {
        userId_groupId: {
          userId,
          groupId,
        },
      },
    });

    if (existing) {
      summary.mapped += 1;
      continue;
    }

    await tx.groupAssignment.create({
      data: {
        userId,
        groupId,
      },
    });

    summary.created += 1;
  }

  return summary;
}
