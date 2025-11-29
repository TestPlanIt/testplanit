import type {
  TestmoGroupMappingConfig,
  TestmoMappingConfiguration,
  TestmoMilestoneTypeMappingConfig,
  TestmoConfigurationMappingConfig,
  TestmoConfigVariantMappingConfig,
  TestmoConfigVariantAction,
  TestmoRoleMappingConfig,
  TestmoStatusMappingConfig,
  TestmoTagMappingConfig,
  TestmoIssueTargetMappingConfig,
  TestmoWorkflowMappingConfig,
  TestmoRolePermissions,
  TestmoRolePermissionConfig,
  TestmoUserMappingConfig,
  TestmoFieldOptionConfig,
  TestmoTemplateFieldMappingConfig,
  TestmoTemplateMappingConfig,
  TestmoTemplateAction,
} from "./types";
import type { Access } from "@prisma/client";
import { generateRandomPassword } from "~/utils/randomPassword";

const ACTION_MAP = new Set(["map", "create"]);
const CONFIG_VARIANT_ACTIONS = new Set([
  "map-variant",
  "create-variant-existing-category",
  "create-category-variant",
]);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return fallback;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toAccessValue = (value: unknown): Access | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case "ADMIN":
    case "USER":
    case "PROJECTADMIN":
    case "NONE":
      return normalized as Access;
    default:
      return undefined;
  }
};

export const createEmptyMappingConfiguration = (): TestmoMappingConfiguration => ({
  workflows: {},
  statuses: {},
  roles: {},
  milestoneTypes: {},
  groups: {},
  tags: {},
  issueTargets: {},
  users: {},
  configurations: {},
  templateFields: {},
  templates: {},
  customFields: {},
});

export const normalizeWorkflowConfig = (
  value: unknown
): TestmoWorkflowMappingConfig => {
  const base: TestmoWorkflowMappingConfig = {
    action: "map",
    mappedTo: null,
    workflowType: null,
    name: null,
    scope: null,
    iconId: null,
    colorId: null,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "map";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "map";

  const mappedTo = toNumber(record.mappedTo);
  const workflowType =
    typeof record.workflowType === "string"
      ? record.workflowType
      : typeof record.suggestedWorkflowType === "string"
      ? record.suggestedWorkflowType
      : null;

  const name = typeof record.name === "string" ? record.name : base.name;
  const scope = typeof record.scope === "string" ? record.scope : base.scope;
  const iconId = toNumber(record.iconId);
  const colorId = toNumber(record.colorId);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    workflowType,
    name: action === "create" ? name : undefined,
    scope: action === "create" ? scope : undefined,
    iconId: action === "create" ? iconId ?? null : undefined,
    colorId: action === "create" ? colorId ?? null : undefined,
  };
};

export const normalizeStatusConfig = (
  value: unknown
): TestmoStatusMappingConfig => {
  const base: TestmoStatusMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    systemName: undefined,
    colorHex: undefined,
    colorId: null,
    aliases: undefined,
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    isEnabled: true,
    scopeIds: [],
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);

  const colorId = toNumber(record.colorId);
  const scopeIds: number[] | undefined = Array.isArray(record.scopeIds)
    ? (record.scopeIds as unknown[])
        .map((value) => toNumber(value))
        .filter((value): value is number => value !== null)
    : undefined;

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
    systemName:
      typeof record.systemName === "string"
        ? record.systemName
        : typeof record.system_name === "string"
        ? record.system_name
        : base.systemName,
    colorHex: typeof record.colorHex === "string" ? record.colorHex : base.colorHex,
    colorId: action === "create" ? colorId ?? null : undefined,
    aliases: typeof record.aliases === "string" ? record.aliases : base.aliases,
    isSuccess: toBoolean(record.isSuccess, base.isSuccess ?? false),
    isFailure: toBoolean(record.isFailure, base.isFailure ?? false),
    isCompleted: toBoolean(record.isCompleted, base.isCompleted ?? false),
    isEnabled: toBoolean(record.isEnabled, base.isEnabled ?? true),
    scopeIds: action === "create" ? scopeIds ?? [] : undefined,
  };
};

export const normalizeGroupConfig = (
  value: unknown
): TestmoGroupMappingConfig => {
  const base: TestmoGroupMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    note: undefined,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
    note: typeof record.note === "string" ? record.note : base.note,
  };
};

export const normalizeTagConfig = (
  value: unknown
): TestmoTagMappingConfig => {
  const base: TestmoTagMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
  };
};

export const normalizeIssueTargetConfig = (
  value: unknown
): TestmoIssueTargetMappingConfig => {
  const base: TestmoIssueTargetMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    provider: null,
    testmoType: null,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);
  const testmoType = toNumber(record.testmoType ?? record.type);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
    provider: typeof record.provider === "string" ? record.provider : base.provider,
    testmoType: action === "create" ? testmoType ?? null : undefined,
  };
};

export const normalizeUserConfig = (
  value: unknown
): TestmoUserMappingConfig => {
  const base: TestmoUserMappingConfig = {
    action: "map",
    mappedTo: null,
    name: undefined,
    email: undefined,
    password: undefined,
    access: undefined,
    roleId: null,
    isActive: true,
    isApi: false,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "map";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "map";

  const mappedTo = typeof record.mappedTo === "string" ? record.mappedTo : null;
  const name = toStringValue(record.name);
  const email = toStringValue(record.email);
  const passwordValue = toStringValue(record.password);
  const password =
    typeof passwordValue === "string" && passwordValue.length > 0
      ? passwordValue
      : null;
  const access = toAccessValue(record.access);
  const roleId = toNumber(record.roleId);
  const isActive = toBoolean(record.isActive, true);
  const isApi = toBoolean(record.isApi, false);

  return {
    action,
    mappedTo: action === "map" ? mappedTo : undefined,
    name: action === "create" ? name : undefined,
    email: action === "create" ? email : undefined,
    password:
      action === "create"
        ? password ?? generateRandomPassword()
        : undefined,
    access: action === "create" ? access : undefined,
    roleId: action === "create" ? roleId ?? null : undefined,
    isActive: action === "create" ? isActive : undefined,
    isApi: action === "create" ? isApi : undefined,
  };
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => {
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        if (typeof entry === "object" && entry && "name" in entry) {
          const raw = (entry as Record<string, unknown>).name;
          if (typeof raw === "string") {
            const trimmed = raw.trim();
            return trimmed.length > 0 ? trimmed : null;
          }
        }
        return null;
      })
      .filter((entry): entry is string => entry !== null);
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
    return segments.length > 0 ? segments : undefined;
  }

  return undefined;
};

const normalizeOptionConfigList = (
  value: unknown
): TestmoFieldOptionConfig[] | undefined => {
  const coerceFromStringArray = (
    entries: string[]
  ): TestmoFieldOptionConfig[] | undefined => {
    if (entries.length === 0) {
      return undefined;
    }
    return entries.map((name, index) => ({
      name,
      iconId: null,
      iconColorId: null,
      isEnabled: true,
      isDefault: index === 0,
      order: index,
    }));
  };

  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalized: TestmoFieldOptionConfig[] = [];
    let defaultAssigned = false;

    value.forEach((entry, index) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed.length === 0) {
          return;
        }
        normalized.push({
          name: trimmed,
          iconId: null,
          iconColorId: null,
          isEnabled: true,
          isDefault: !defaultAssigned && index === 0,
          order: index,
        });
        defaultAssigned = defaultAssigned || index === 0;
        return;
      }

      if (!entry || typeof entry !== "object") {
        return;
      }

      const record = entry as Record<string, unknown>;
      const name =
        toStringValue(
          record.name ??
            record.label ??
            record.value ??
            record.displayName ??
            record.display_name
        ) ?? null;

      if (!name) {
        return;
      }

      const iconId =
        toNumber(
          record.iconId ?? record.icon_id ?? record.icon ?? record.iconID
        ) ?? null;
      const iconColorId =
        toNumber(
          record.iconColorId ??
            record.icon_color_id ??
            record.colorId ??
            record.color_id ??
            record.color
        ) ?? null;
      const isEnabled = toBoolean(
        record.isEnabled ?? record.enabled ?? record.is_enabled,
        true
      );
      const isDefault = toBoolean(
        record.isDefault ??
          record.default ??
          record.is_default ??
          record.defaultOption,
        false
      );
      const order =
        toNumber(
          record.order ??
            record.position ??
            record.ordinal ??
            record.index ??
            record.sort
        ) ?? index;

      if (isDefault && !defaultAssigned) {
        defaultAssigned = true;
      }

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
      return undefined;
    }

    const sorted = normalized
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let defaultSeen = false;
    sorted.forEach((entry) => {
      if (entry.isDefault && !defaultSeen) {
        defaultSeen = true;
        return;
      }
      if (entry.isDefault && defaultSeen) {
        entry.isDefault = false;
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
      order: entry.order ?? index,
    }));
  }

  if (typeof value === "string") {
    const normalizedStrings = normalizeStringArray(value);
    return normalizedStrings
      ? coerceFromStringArray(normalizedStrings)
      : undefined;
  }

  return undefined;
};

const normalizeTemplateFieldTarget = (
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
  return fallback;
};

export const normalizeTemplateFieldConfig = (
  value: unknown
): TestmoTemplateFieldMappingConfig => {
  const base: TestmoTemplateFieldMappingConfig = {
    action: "create",
    targetType: "case",
    mappedTo: null,
    displayName: undefined,
    systemName: undefined,
    typeId: null,
    typeName: null,
    hint: undefined,
    isRequired: false,
    isRestricted: false,
    defaultValue: undefined,
    isChecked: undefined,
    minValue: undefined,
    maxValue: undefined,
    minIntegerValue: undefined,
    maxIntegerValue: undefined,
    initialHeight: undefined,
    dropdownOptions: undefined,
    templateName: undefined,
    order: undefined,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = actionValue === "map" ? "map" : "create";

  const targetSource =
    record.targetType ??
    record.target_type ??
    record.fieldTarget ??
    record.field_target ??
    record.scope ??
    record.assignment ??
    record.fieldCategory ??
    record.field_category;
  const targetType = normalizeTemplateFieldTarget(targetSource, base.targetType);

  const mappedTo = toNumber(record.mappedTo);
  const typeId = toNumber(record.typeId ?? record.type_id ?? record.fieldTypeId);
  const typeName =
    typeof record.typeName === "string"
      ? record.typeName
      : typeof record.type_name === "string"
      ? record.type_name
      : typeof record.fieldType === "string"
      ? record.fieldType
      : typeof record.field_type === "string"
      ? record.field_type
      : base.typeName;

  const dropdownOptions =
    normalizeOptionConfigList(
      record.dropdownOptions ??
        record.dropdown_options ??
        record.options ??
        record.choices
    ) ?? base.dropdownOptions;

  return {
    action,
    targetType,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    displayName:
      typeof record.displayName === "string"
        ? record.displayName
        : typeof record.display_name === "string"
        ? record.display_name
        : typeof record.label === "string"
        ? record.label
        : base.displayName,
    systemName:
      typeof record.systemName === "string"
        ? record.systemName
        : typeof record.system_name === "string"
        ? record.system_name
        : typeof record.name === "string"
        ? record.name
        : base.systemName,
    typeId: typeId ?? null,
    typeName: typeName ?? null,
    hint:
      typeof record.hint === "string"
        ? record.hint
        : typeof record.description === "string"
        ? record.description
        : base.hint,
    isRequired: toBoolean(record.isRequired ?? record.is_required ?? base.isRequired),
    isRestricted: toBoolean(record.isRestricted ?? record.is_restricted ?? base.isRestricted),
    defaultValue:
      typeof record.defaultValue === "string"
        ? record.defaultValue
        : typeof record.default_value === "string"
        ? record.default_value
        : base.defaultValue,
    isChecked: typeof record.isChecked === "boolean" ? record.isChecked : base.isChecked,
    minValue: toNumber(record.minValue ?? record.min_value) ?? base.minValue,
    maxValue: toNumber(record.maxValue ?? record.max_value) ?? base.maxValue,
    minIntegerValue:
      toNumber(record.minIntegerValue ?? record.min_integer_value) ?? base.minIntegerValue,
    maxIntegerValue:
      toNumber(record.maxIntegerValue ?? record.max_integer_value) ?? base.maxIntegerValue,
    initialHeight:
      toNumber(record.initialHeight ?? record.initial_height) ?? base.initialHeight,
    dropdownOptions,
    templateName:
      typeof record.templateName === "string"
        ? record.templateName
        : typeof record.template_name === "string"
        ? record.template_name
        : base.templateName,
    order: toNumber(record.order ?? record.position ?? record.ordinal) ?? base.order,
  };
};

export const normalizeTemplateConfig = (
  value: unknown
): TestmoTemplateMappingConfig => {
  const base: TestmoTemplateMappingConfig = {
    action: "map",
    mappedTo: null,
    name: undefined,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = ACTION_MAP.has(actionValue)
    ? (actionValue as TestmoTemplateAction)
    : base.action;
  const mappedTo = toNumber(record.mappedTo);
  const name = typeof record.name === "string" ? record.name : base.name;

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: action === "create" ? name ?? undefined : undefined,
  };
};

const normalizeRolePermissions = (
  value: unknown
): TestmoRolePermissions => {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: TestmoRolePermissions = {};

  const assignPermission = (area: string, source: Record<string, unknown>) => {
    const perm: TestmoRolePermissionConfig = {
      canAddEdit: toBoolean(source.canAddEdit ?? false),
      canDelete: toBoolean(source.canDelete ?? false),
      canClose: toBoolean(source.canClose ?? false),
    };
    result[area] = perm;
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const area = typeof record.area === "string" ? record.area : undefined;
        if (area) {
          assignPermission(area, record);
        }
      }
    });
    return result;
  }

  for (const [area, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry && typeof entry === "object") {
      assignPermission(area, entry as Record<string, unknown>);
    }
  }

  return result;
};

export const normalizeRoleConfig = (
  value: unknown
): TestmoRoleMappingConfig => {
  const base: TestmoRoleMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    isDefault: false,
    permissions: {},
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);

  const permissions = normalizeRolePermissions(record.permissions);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
    isDefault:
      action === "create" ? toBoolean(record.isDefault ?? false) : undefined,
    permissions: action === "create" ? permissions : undefined,
  };
};

export const normalizeMilestoneTypeConfig = (
  value: unknown
): TestmoMilestoneTypeMappingConfig => {
  const base: TestmoMilestoneTypeMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    iconId: null,
    isDefault: false,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);
  const iconId = toNumber(record.iconId);

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: typeof record.name === "string" ? record.name : base.name,
    iconId: action === "create" ? iconId ?? null : undefined,
    isDefault:
      action === "create" ? toBoolean(record.isDefault ?? false) : undefined,
  };
};

const normalizeConfigVariantConfig = (
  key: string,
  value: unknown
): TestmoConfigVariantMappingConfig => {
  const base: TestmoConfigVariantMappingConfig = {
    token: key,
    action: "create-category-variant",
    mappedVariantId: undefined,
    categoryId: undefined,
    categoryName: null,
    variantName: null,
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : base.action;
  const action = CONFIG_VARIANT_ACTIONS.has(actionValue)
    ? (actionValue as TestmoConfigVariantAction)
    : base.action;

  const token = typeof record.token === "string" ? record.token : base.token;
  const mappedVariantId = toNumber(record.mappedVariantId);
  const categoryId = toNumber(record.categoryId);
  const categoryName = typeof record.categoryName === "string" ? record.categoryName : base.categoryName;
  const variantName = typeof record.variantName === "string" ? record.variantName : base.variantName;

  return {
    token,
    action,
    mappedVariantId: action === "map-variant" ? mappedVariantId ?? null : undefined,
    categoryId:
      action === "create-variant-existing-category"
        ? categoryId ?? null
        : undefined,
    categoryName: action === "create-category-variant" ? categoryName : undefined,
    variantName:
      action === "map-variant"
        ? undefined
        : variantName ?? token,
  };
};

export const normalizeConfigurationConfig = (
  value: unknown
): TestmoConfigurationMappingConfig => {
  const base: TestmoConfigurationMappingConfig = {
    action: "create",
    mappedTo: null,
    name: undefined,
    variants: {},
  };

  if (!value || typeof value !== "object") {
    return base;
  }

  const record = value as Record<string, unknown>;
  const actionValue = typeof record.action === "string" ? record.action : "create";
  const action = ACTION_MAP.has(actionValue) ? (actionValue as "map" | "create") : "create";
  const mappedTo = toNumber(record.mappedTo);
  const name = typeof record.name === "string" ? record.name : base.name;

  const variants: Record<number, TestmoConfigVariantMappingConfig> = {};
  if (record.variants && typeof record.variants === "object") {
    for (const [variantKey, entry] of Object.entries(
      record.variants as Record<string, unknown>
    )) {
      const index = Number(variantKey);
      if (!Number.isFinite(index)) {
        continue;
      }
      variants[index] = normalizeConfigVariantConfig(variantKey, entry);
    }
  }

  return {
    action,
    mappedTo: action === "map" ? mappedTo ?? null : undefined,
    name: action === "create" ? name : undefined,
    variants,
  };
};

export const normalizeMappingConfiguration = (
  value: unknown
): TestmoMappingConfiguration => {
  const configuration = createEmptyMappingConfiguration();

  if (!value || typeof value !== "object") {
    return configuration;
  }

  const record = value as Record<string, unknown>;

  if (record.workflows && typeof record.workflows === "object") {
    for (const [key, entry] of Object.entries(
      record.workflows as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.workflows[id] = normalizeWorkflowConfig(entry);
    }
  }

  if (record.statuses && typeof record.statuses === "object") {
    for (const [key, entry] of Object.entries(
      record.statuses as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.statuses[id] = normalizeStatusConfig(entry);
    }
  }

  if (record.groups && typeof record.groups === "object") {
    for (const [key, entry] of Object.entries(
      record.groups as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.groups[id] = normalizeGroupConfig(entry);
    }
  }

  if (record.tags && typeof record.tags === "object") {
    for (const [key, entry] of Object.entries(
      record.tags as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.tags[id] = normalizeTagConfig(entry);
    }
  }

  if (record.issueTargets && typeof record.issueTargets === "object") {
    for (const [key, entry] of Object.entries(
      record.issueTargets as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.issueTargets[id] = normalizeIssueTargetConfig(entry);
    }
  }

  if (record.roles && typeof record.roles === "object") {
    for (const [key, entry] of Object.entries(
      record.roles as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.roles[id] = normalizeRoleConfig(entry);
    }
  }

  if (record.users && typeof record.users === "object") {
    for (const [key, entry] of Object.entries(
      record.users as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.users[id] = normalizeUserConfig(entry);
    }
  }

  if (record.configurations && typeof record.configurations === "object") {
    for (const [key, entry] of Object.entries(
      record.configurations as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.configurations[id] = normalizeConfigurationConfig(entry);
    }
  }

  if (record.templateFields && typeof record.templateFields === "object") {
    for (const [key, entry] of Object.entries(
      record.templateFields as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.templateFields[id] = normalizeTemplateFieldConfig(entry);
    }
  }

  if (record.milestoneTypes && typeof record.milestoneTypes === "object") {
    for (const [key, entry] of Object.entries(
      record.milestoneTypes as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.milestoneTypes[id] = normalizeMilestoneTypeConfig(entry);
    }
  }

  if (record.templates && typeof record.templates === "object") {
    for (const [key, entry] of Object.entries(
      record.templates as Record<string, unknown>
    )) {
      const id = Number(key);
      if (!Number.isFinite(id)) {
        continue;
      }
      configuration.templates[id] = normalizeTemplateConfig(entry);
    }
  }

  if (record.customFields && typeof record.customFields === "object") {
    configuration.customFields = JSON.parse(
      JSON.stringify(record.customFields)
    ) as Record<number, unknown>;
  }

  return configuration;
};

export const serializeMappingConfiguration = (
  configuration: TestmoMappingConfiguration
): Record<string, unknown> => JSON.parse(JSON.stringify(configuration));
