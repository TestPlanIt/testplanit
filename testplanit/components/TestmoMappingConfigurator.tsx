"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { FieldIconPicker } from "@/components/FieldIconPicker";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { ColorPicker } from "@/components/ColorPicker";
import { scopeDisplayData } from "~/app/constants";
import { generateRandomPassword } from "~/utils/randomPassword";
import {
  AddCaseFieldModal,
  type AddCaseFieldModalProps,
  type FieldDraftOption,
} from "~/app/[locale]/admin/fields/AddCaseField";
import {
  AddResultFieldModal,
  type AddResultFieldModalProps,
} from "~/app/[locale]/admin/fields/AddResultField";

import type {
  TestmoConfigVariantMappingConfig,
  TestmoConfigurationMappingConfig,
  TestmoConfigurationSuggestion,
  TestmoExistingConfigCategory,
  TestmoExistingConfigVariant,
  TestmoExistingConfiguration,
  TestmoExistingStatus,
  TestmoExistingWorkflow,
  TestmoGroupMappingConfig,
  TestmoGroupSuggestion,
  TestmoIssueTargetMappingConfig,
  TestmoIssueTargetSuggestion,
  TestmoExistingIntegration,
  TestmoMappingAnalysis,
  TestmoMappingConfiguration,
  TestmoFieldOptionConfig,
  TestmoRoleMappingConfig,
  TestmoRolePermissions,
  TestmoRoleSuggestion,
  TestmoMilestoneTypeMappingConfig,
  TestmoMilestoneTypeSuggestion,
  TestmoStatusMappingConfig,
  TestmoStatusSuggestion,
  TestmoUserMappingConfig,
  TestmoUserSuggestion,
  TestmoWorkflowMappingConfig,
  TestmoWorkflowSuggestion,
  TestmoTemplateFieldAction,
  TestmoTemplateFieldMappingConfig,
  TestmoTemplateFieldSuggestion,
  TestmoExistingCaseField,
  TestmoExistingResultField,
  TestmoTemplateFieldTargetType,
  TestmoTemplateSuggestion,
  TestmoTemplateMappingConfig,
  TestmoExistingTemplate,
} from "~/services/imports/testmo/types";
import { useFindManyColor, useFindManyStatusScope } from "~/lib/hooks";
import DynamicIcon from "@/components/DynamicIcon";
import { Access, ApplicationArea, type FieldOptions } from "@prisma/client";
import { Separator } from "./ui/separator";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BetweenHorizontalStart,
  EqualNot,
  FilePlus2,
  SquareDashed,
} from "lucide-react";
import { IconName } from "~/types/globals";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface TestmoMappingConfiguratorProps {
  analysis: TestmoMappingAnalysis | null;
  configuration: TestmoMappingConfiguration;
  onConfigurationChange: (configuration: TestmoMappingConfiguration) => void;
  datasetKey?: string;
  visibleSections?: {
    workflows?: boolean;
    statuses?: boolean;
    roles?: boolean;
    groups?: boolean;
    issueTargets?: boolean;
    users?: boolean;
    templates?: boolean;
    templateFields?: boolean;
    milestoneTypes?: boolean;
    configurations?: boolean;
  };
  sectionDescriptions?: {
    workflows?: string;
    statuses?: string;
    roles?: string;
    groups?: string;
    issueTargets?: string;
    users?: string;
    templates?: string;
    templateFields?: string;
    milestoneTypes?: string;
    configurations?: string;
  };
  sectionCounts?: {
    workflows?: number;
    statuses?: number;
    roles?: number;
    groups?: number;
    issueTargets?: number;
    users?: number;
    templates?: number;
    templateFields?: number;
    milestoneTypes?: number;
    configurations?: number;
  };
}

function ensureWorkflowConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoWorkflowMappingConfig {
  return (
    configuration.workflows[id] ?? {
      action: "map",
      mappedTo: null,
      workflowType: null,
      name: null,
      scope: null,
      iconId: null,
      colorId: null,
    }
  );
}

function ensureStatusConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoStatusMappingConfig {
  return (
    configuration.statuses[id] ?? {
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
    }
  );
}

function ensureGroupConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoGroupMappingConfig {
  return (
    configuration.groups[id] ?? {
      action: "create",
      mappedTo: null,
      name: undefined,
      note: undefined,
    }
  );
}

function ensureIssueTargetConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoIssueTargetMappingConfig {
  return (
    configuration.issueTargets[id] ?? {
      action: "map",
      mappedTo: null,
      name: undefined,
      provider: null,
      testmoType: null,
    }
  );
}

function ensureUserConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoUserMappingConfig {
  return (
    configuration.users[id] ?? {
      action: "map",
      mappedTo: null,
      name: undefined,
      email: undefined,
      password: null,
      access: undefined,
      roleId: null,
      isActive: undefined,
      isApi: undefined,
    }
  );
}

export const convertNamesToOptionConfigs = (
  options?: (string | null | undefined)[]
): TestmoFieldOptionConfig[] | undefined => {
  if (!Array.isArray(options)) {
    return undefined;
  }

  const normalized = options
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((name) => name.length > 0)
    .map((name, index) => ({
      name,
      iconId: null,
      iconColorId: null,
      isEnabled: true,
      isDefault: index === 0,
      order: index,
    }));

  return normalized.length > 0 ? normalized : undefined;
};

function ensureTemplateFieldConfig(
  configuration: TestmoMappingConfiguration,
  id: number,
  fallback?: Partial<TestmoTemplateFieldMappingConfig>
): TestmoTemplateFieldMappingConfig {
  return (
    configuration.templateFields[id] ?? {
      action: fallback?.action ?? "map",
      targetType: fallback?.targetType ?? "case",
      mappedTo: null,
      displayName: fallback?.displayName,
      systemName: fallback?.systemName,
      typeId: fallback?.typeId ?? null,
      typeName: fallback?.typeName ?? null,
      hint: fallback?.hint,
      isRequired: fallback?.isRequired ?? false,
      isRestricted: fallback?.isRestricted ?? false,
      defaultValue: fallback?.defaultValue ?? null,
      isChecked: fallback?.isChecked ?? null,
      minValue: fallback?.minValue ?? null,
      maxValue: fallback?.maxValue ?? null,
      minIntegerValue: fallback?.minIntegerValue ?? null,
      maxIntegerValue: fallback?.maxIntegerValue ?? null,
      initialHeight: fallback?.initialHeight ?? null,
      dropdownOptions: fallback?.dropdownOptions ?? undefined,
      templateName: fallback?.templateName ?? null,
      order: fallback?.order ?? null,
    }
  );
}

function ensureTemplateConfig(
  configuration: TestmoMappingConfiguration,
  id: number,
  suggestion?: TestmoTemplateSuggestion
): TestmoTemplateMappingConfig {
  return (
    configuration.templates[id] ?? {
      action: "create",
      mappedTo: null,
      name: suggestion?.name ?? undefined,
    }
  );
}

const toNumberValue = (value: unknown): number | null => {
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
};

const toBooleanValue = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return fallback;
};

const toTrimmedStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeAccessValue = (value: unknown): Access | undefined => {
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

function ensureRoleConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoRoleMappingConfig {
  return (
    configuration.roles[id] ?? {
      action: "create",
      mappedTo: null,
      name: undefined,
      isDefault: false,
      permissions: {},
    }
  );
}

function ensureMilestoneTypeConfig(
  configuration: TestmoMappingConfiguration,
  id: number
): TestmoMilestoneTypeMappingConfig {
  return (
    configuration.milestoneTypes[id] ?? {
      action: "create",
      mappedTo: null,
      name: undefined,
      iconId: null,
      isDefault: false,
    }
  );
}

function ensureConfigVariantMappingConfig(
  value: TestmoConfigVariantMappingConfig | undefined,
  token: string
): TestmoConfigVariantMappingConfig {
  if (!value) {
    return {
      token,
      action: "create-category-variant",
      mappedVariantId: undefined,
      categoryId: undefined,
      categoryName: token,
      variantName: token,
    };
  }

  if (value.action === "map-variant") {
    return {
      ...value,
      token: value.token ?? token,
      mappedVariantId: value.mappedVariantId ?? null,
      categoryId: undefined,
      categoryName: undefined,
      variantName: undefined,
    };
  }

  if (value.action === "create-variant-existing-category") {
    return {
      ...value,
      token: value.token ?? token,
      mappedVariantId: undefined,
      categoryId: value.categoryId ?? null,
      categoryName: undefined,
      variantName: value.variantName ?? token,
    };
  }

  return {
    ...value,
    token: value.token ?? token,
    mappedVariantId: undefined,
    categoryId: undefined,
    categoryName: value.categoryName ?? token,
    variantName: value.variantName ?? token,
  };
}

function ensureConfigurationConfig(
  configuration: TestmoMappingConfiguration,
  id: number,
  suggestion?: TestmoConfigurationSuggestion
): TestmoConfigurationMappingConfig {
  const existing = configuration.configurations[id];
  const base: TestmoConfigurationMappingConfig = existing
    ? {
        ...existing,
        variants: { ...(existing.variants ?? {}) },
      }
    : {
        action: "create",
        mappedTo: null,
        name: suggestion?.name ?? undefined,
        variants: {},
      };

  if (suggestion) {
    suggestion.variantTokens.forEach((token, index) => {
      base.variants[index] = ensureConfigVariantMappingConfig(
        base.variants[index],
        token
      );
    });
  }

  return base;
}

const WORKFLOW_TYPE_VALUES = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;

const WORKFLOW_TYPE_TRANSLATION_KEYS: Record<string, string> = {
  NOT_STARTED: "workflowTypeOptions.notStarted",
  IN_PROGRESS: "workflowTypeOptions.inProgress",
  DONE: "workflowTypeOptions.done",
};

function translateWorkflowType(
  type: string | null | undefined,
  t: Translator
): string {
  if (!type) {
    return "";
  }

  const normalized = type.toUpperCase();
  const translationKey = WORKFLOW_TYPE_TRANSLATION_KEYS[normalized];

  if (translationKey) {
    try {
      return t(translationKey);
    } catch (error) {
      return type;
    }
  }

  return type;
}

const DEFAULT_WORKFLOW_SCOPE = "CASES";

const SYSTEM_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
const ALIAS_LIST_REGEX =
  /^(?:[A-Za-z][A-Za-z0-9_]*)(?:,(?:[A-Za-z][A-Za-z0-9_]*))*$/;
const DEFAULT_STATUS_COLOR = "#B1B2B3";

const ADD_EDIT_EXCLUDED_AREAS = new Set<ApplicationArea>([
  ApplicationArea.ClosedTestRuns,
  ApplicationArea.ClosedSessions,
]);

const DELETE_EXCLUDED_AREAS = new Set<ApplicationArea>([
  ApplicationArea.Documentation,
  ApplicationArea.TestCaseRestrictedFields,
  ApplicationArea.TestRunResultRestrictedFields,
  ApplicationArea.SessionsRestrictedFields,
  ApplicationArea.Tags,
]);

const CLOSE_ALLOWED_AREAS = new Set<ApplicationArea>([
  ApplicationArea.TestRuns,
  ApplicationArea.Sessions,
]);

const generateSystemName = (value: string): string => {
  if (!value) {
    return "";
  }

  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "");

  return normalized;
};

const sanitizeAliasInput = (value: string): string => value.replace(/\s+/g, "");

export default function TestmoMappingConfigurator({
  analysis,
  configuration,
  onConfigurationChange,
  datasetKey,
  visibleSections,
  sectionDescriptions,
  sectionCounts,
}: TestmoMappingConfiguratorProps) {
  const t = useTranslations(
    "admin.imports.testmo.mapping"
  ) as unknown as Translator;
  const tWorkflowTypes = useTranslations(
    "admin.workflows.types"
  ) as unknown as Translator;
  const tWorkflowCreate = useTranslations(
    "admin.imports.testmo.workflowCreate"
  ) as unknown as Translator;

  const workflowSuggestions = analysis?.ambiguousEntities?.workflows ?? [];
  const statusSuggestions = analysis?.ambiguousEntities?.statuses ?? [];
  const roleSuggestions = analysis?.ambiguousEntities?.roles ?? [];
  const milestoneTypeSuggestions =
    analysis?.ambiguousEntities?.milestoneTypes ?? [];
  const groupSuggestions = analysis?.ambiguousEntities?.groups ?? [];
  const issueTargetSuggestions =
    analysis?.ambiguousEntities?.issueTargets ?? [];
  const templateFieldSuggestions = useMemo(
    () => analysis?.ambiguousEntities?.templateFields ?? [],
    [analysis?.ambiguousEntities?.templateFields]
  );
  const templateSuggestions = useMemo(
    () => analysis?.ambiguousEntities?.templates ?? [],
    [analysis?.ambiguousEntities?.templates]
  );
  const userSuggestions = useMemo(() => {
    const suggestions = analysis?.ambiguousEntities?.users ?? [];
    if (suggestions.length > 0) {
      return suggestions;
    }

    const raw = analysis?.preservedDatasets?.users;
    const rows: unknown[] = Array.isArray(raw)
      ? raw
      : raw
        ? Object.values(raw as Record<string, unknown>)
        : [];

    const derived: TestmoUserSuggestion[] = [];

    rows.forEach((row, index) => {
      if (!row || typeof row !== "object") {
        return;
      }
      const record = row as Record<string, unknown>;
      const idFromRecord = toNumberValue(record.id);
      const id = idFromRecord !== null ? idFromRecord : index + 1;
      const email =
        toTrimmedStringValue(record.email) ??
        toTrimmedStringValue(record.email_address) ??
        toTrimmedStringValue(record.emailAddress) ??
        toTrimmedStringValue(record.user_email) ??
        toTrimmedStringValue(record.userEmail) ??
        null;
      const name =
        toTrimmedStringValue(record.name) ??
        toTrimmedStringValue(record.full_name) ??
        toTrimmedStringValue(record.fullName) ??
        toTrimmedStringValue(record.display_name) ??
        toTrimmedStringValue(record.displayName) ??
        toTrimmedStringValue(record.username) ??
        null;

      if (!email && !name) {
        return;
      }

      const access =
        normalizeAccessValue(record.access) ??
        normalizeAccessValue(record.system_access) ??
        normalizeAccessValue(record.systemAccess) ??
        normalizeAccessValue(record.user_access) ??
        normalizeAccessValue(record.userAccess) ??
        undefined;

      const activeSource =
        record.active ??
        record.is_active ??
        record.enabled ??
        record.isActive ??
        (typeof record.status === "string"
          ? record.status.trim().toLowerCase() === "active"
          : undefined);

      const apiSource = record.is_api ?? record.api ?? record.isApi;

      const roleName =
        toTrimmedStringValue(record.role_name) ??
        toTrimmedStringValue(record.roleName) ??
        toTrimmedStringValue(record.role) ??
        null;

      derived.push({
        id,
        email,
        name,
        isActive: toBooleanValue(activeSource, true),
        isApi: toBooleanValue(apiSource, false),
        access: access ?? Access.USER,
        roleName,
      });
    });

    return derived;
  }, [analysis?.ambiguousEntities?.users, analysis?.preservedDatasets?.users]);
  const configurationSuggestions = useMemo(
    () => analysis?.ambiguousEntities?.configurations ?? [],
    [analysis?.ambiguousEntities?.configurations]
  );
  const existingWorkflows = useMemo(
    () => analysis?.existingEntities?.workflows ?? [],
    [analysis?.existingEntities?.workflows]
  );
  const existingStatuses = useMemo(
    () => analysis?.existingEntities?.statuses ?? [],
    [analysis?.existingEntities?.statuses]
  );
  const existingRoles = useMemo(
    () => analysis?.existingEntities?.roles ?? [],
    [analysis?.existingEntities?.roles]
  );
  const existingMilestoneTypes = useMemo(
    () => analysis?.existingEntities?.milestoneTypes ?? [],
    [analysis?.existingEntities?.milestoneTypes]
  );
  const existingGroups = useMemo(
    () => analysis?.existingEntities?.groups ?? [],
    [analysis?.existingEntities?.groups]
  );
  const existingIntegrations = useMemo(
    () => analysis?.existingEntities?.issueTargets ?? [],
    [analysis?.existingEntities?.issueTargets]
  );
  const existingUsers = useMemo(
    () => analysis?.existingEntities?.users ?? [],
    [analysis?.existingEntities?.users]
  );
  const existingCaseFields = useMemo(
    () => analysis?.existingEntities?.caseFields ?? [],
    [analysis?.existingEntities?.caseFields]
  );
  const existingResultFields = useMemo(
    () => analysis?.existingEntities?.resultFields ?? [],
    [analysis?.existingEntities?.resultFields]
  );
  const caseFieldTypes = useMemo(
    () => analysis?.existingEntities?.caseFieldTypes ?? [],
    [analysis?.existingEntities?.caseFieldTypes]
  );
  const existingConfigCategories = useMemo(
    () => analysis?.existingEntities?.configurationCategories ?? [],
    [analysis?.existingEntities?.configurationCategories]
  );
  const existingConfigVariants = useMemo(
    () => analysis?.existingEntities?.configurationVariants ?? [],
    [analysis?.existingEntities?.configurationVariants]
  );
  const existingConfigurations = useMemo(
    () => analysis?.existingEntities?.configurations ?? [],
    [analysis?.existingEntities?.configurations]
  );
  const existingTemplates = useMemo(
    () => analysis?.existingEntities?.templates ?? [],
    [analysis?.existingEntities?.templates]
  );
  const templateTargetUsage = useMemo(() => {
    const usage = new Map<number, number>();
    Object.values(configuration.templates ?? {}).forEach((config) => {
      if (
        config &&
        config.action === "map" &&
        config.mappedTo !== null &&
        config.mappedTo !== undefined
      ) {
        usage.set(config.mappedTo, (usage.get(config.mappedTo) ?? 0) + 1);
      }
    });
    return usage;
  }, [configuration.templates]);
  const configurationSuggestionMap = useMemo(() => {
    const map = new Map<number, TestmoConfigurationSuggestion>();
    configurationSuggestions.forEach((suggestion) => {
      map.set(suggestion.id, suggestion);
    });
    return map;
  }, [configurationSuggestions]);

  const showWorkflows =
    visibleSections === undefined ? true : Boolean(visibleSections.workflows);
  const showStatuses =
    visibleSections === undefined ? true : Boolean(visibleSections.statuses);
  const showRoles =
    visibleSections === undefined ? true : Boolean(visibleSections.roles);
  const showGroups =
    visibleSections === undefined ? true : Boolean(visibleSections.groups);
  const showIssueTargets =
    datasetKey === "issue_targets"
      ? true
      : visibleSections === undefined
        ? true
        : Boolean(visibleSections.issueTargets);
  const showTemplates =
    datasetKey === "templates"
      ? true
      : visibleSections === undefined
        ? Boolean(datasetKey === undefined && templateSuggestions.length > 0)
        : Boolean(visibleSections.templates);
  const showTemplateFields =
    datasetKey === "template_fields"
      ? true
      : visibleSections === undefined
        ? Boolean(
            datasetKey === undefined && templateFieldSuggestions.length > 0
          )
        : Boolean(visibleSections.templateFields);
  const showUsers =
    datasetKey === "users"
      ? true
      : visibleSections === undefined
        ? Boolean(datasetKey === undefined && userSuggestions.length > 0)
        : Boolean(visibleSections.users);
  const showMilestoneTypes =
    visibleSections === undefined
      ? true
      : Boolean(visibleSections.milestoneTypes);
  const showConfigurations =
    visibleSections === undefined
      ? true
      : Boolean(visibleSections.configurations);

  const workflowOptions = useMemo(() => {
    return existingWorkflows
      .map((workflow) => {
        const scope = workflow.scope ?? "";
        const order = workflow.order ?? 0;
        const typeKey = workflow.workflowType ?? null;
        let typeLabel: string | null = null;
        if (typeKey) {
          try {
            typeLabel = tWorkflowTypes(typeKey);
          } catch (error) {
            typeLabel = typeKey;
          }
        }

        return {
          scope,
          order,
          label: typeLabel ? `${workflow.name} (${typeLabel})` : workflow.name,
          value: workflow.id.toString(),
        };
      })
      .sort((a, b) => {
        if (a.scope === b.scope) {
          return a.order - b.order;
        }
        return a.scope.localeCompare(b.scope);
      });
  }, [existingWorkflows, tWorkflowTypes]);

  const statusOptions = useMemo(
    () =>
      existingStatuses.map((status) => ({
        value: status.id.toString(),
        name: status.name,
        systemName: status.systemName,
        colorHex: status.colorHex ?? null,
      })),
    [existingStatuses]
  );

  const groupOptions = useMemo(
    () =>
      existingGroups.map((group) => ({
        value: group.id.toString(),
        label: group.name,
        note: group.note ?? null,
      })),
    [existingGroups]
  );

  const integrationOptions = useMemo(
    () =>
      existingIntegrations.map((integration) => ({
        value: integration.id.toString(),
        label: integration.name,
        provider: integration.provider,
        status: integration.status,
      })),
    [existingIntegrations]
  );

  const caseFieldOptions = useMemo(
    () =>
      existingCaseFields.map((field) => ({
        value: field.id.toString(),
        label: `${field.displayName} (${field.systemName})`,
        displayName: field.displayName,
        systemName: field.systemName,
        typeId: field.typeId,
        typeName: field.typeName,
        isRestricted: field.isRestricted,
      })),
    [existingCaseFields]
  );

  const resultFieldOptions = useMemo(
    () =>
      existingResultFields.map((field) => ({
        value: field.id.toString(),
        label: `${field.displayName} (${field.systemName})`,
        displayName: field.displayName,
        systemName: field.systemName,
        typeId: field.typeId,
        typeName: field.typeName,
        isRestricted: field.isRestricted,
      })),
    [existingResultFields]
  );

  const fieldTypeOptions = useMemo(
    () =>
      caseFieldTypes.map((type) => ({
        value: type.id.toString(),
        label: type.type,
      })),
    [caseFieldTypes]
  );

  const userOptions = useMemo(
    () =>
      existingUsers.map((user) => ({
        value: user.id,
        label: user.name ? `${user.name} (${user.email})` : user.email,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        access: user.access,
        roleName: user.roleName ?? null,
      })),
    [existingUsers]
  );

  const roleOptions = useMemo(
    () =>
      existingRoles.map((role) => ({
        value: role.id.toString(),
        label: role.name,
        isDefault: role.isDefault,
        permissions: role.permissions,
      })),
    [existingRoles]
  );

  const milestoneTypeOptions = useMemo(
    () =>
      existingMilestoneTypes.map((milestoneType) => ({
        value: milestoneType.id.toString(),
        label: milestoneType.name,
        iconId: milestoneType.iconId ?? null,
        iconName: milestoneType.iconName ?? null,
        isDefault: milestoneType.isDefault,
      })),
    [existingMilestoneTypes]
  );

  const handleWorkflowChange = (
    workflowId: number,
    updater: (
      current: TestmoWorkflowMappingConfig
    ) => TestmoWorkflowMappingConfig
  ) => {
    const current = ensureWorkflowConfig(configuration, workflowId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      workflows: {
        ...configuration.workflows,
        [workflowId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleStatusChange = (
    statusId: number,
    updater: (current: TestmoStatusMappingConfig) => TestmoStatusMappingConfig
  ) => {
    const current = ensureStatusConfig(configuration, statusId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      statuses: {
        ...configuration.statuses,
        [statusId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleGroupChange = (
    groupId: number,
    updater: (current: TestmoGroupMappingConfig) => TestmoGroupMappingConfig
  ) => {
    const current = ensureGroupConfig(configuration, groupId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      groups: {
        ...configuration.groups,
        [groupId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleIssueTargetChange = (
    issueTargetId: number,
    updater: (
      current: TestmoIssueTargetMappingConfig
    ) => TestmoIssueTargetMappingConfig
  ) => {
    const current = ensureIssueTargetConfig(configuration, issueTargetId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      issueTargets: {
        ...configuration.issueTargets,
        [issueTargetId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleUserChange = (
    userId: number,
    updater: (current: TestmoUserMappingConfig) => TestmoUserMappingConfig
  ) => {
    const current = ensureUserConfig(configuration, userId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      users: {
        ...configuration.users,
        [userId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleRoleChange = (
    roleId: number,
    updater: (current: TestmoRoleMappingConfig) => TestmoRoleMappingConfig
  ) => {
    const current = ensureRoleConfig(configuration, roleId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      roles: {
        ...configuration.roles,
        [roleId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleTemplateFieldChange = (
    fieldId: number,
    updater: (
      current: TestmoTemplateFieldMappingConfig
    ) => TestmoTemplateFieldMappingConfig
  ) => {
    const suggestion = templateFieldSuggestions.find(
      (entry) => entry.id === fieldId
    );
    const fallback: Partial<TestmoTemplateFieldMappingConfig> | undefined =
      suggestion
        ? (() => {
            let matchedField:
              | TestmoExistingCaseField
              | TestmoExistingResultField
              | undefined;
            if (
              suggestion.fieldId !== null &&
              suggestion.fieldId !== undefined
            ) {
              matchedField =
                suggestion.targetType === "result"
                  ? existingResultFields.find(
                      (field) => field.id === suggestion.fieldId
                    )
                  : existingCaseFields.find(
                      (field) => field.id === suggestion.fieldId
                    );
            }

            return {
              action: "map",
              targetType: suggestion.targetType,
              displayName: suggestion.displayName ?? undefined,
              systemName: suggestion.systemName ?? undefined,
              typeId: matchedField?.typeId ?? null,
              typeName:
                suggestion.fieldType ?? matchedField?.typeName ?? undefined,
              hint: suggestion.hint ?? undefined,
              isRequired: suggestion.isRequired ?? false,
              isRestricted: suggestion.isRestricted ?? false,
              defaultValue: suggestion.defaultValue ?? null,
              isChecked: suggestion.isChecked ?? null,
              minValue: suggestion.minValue ?? null,
              maxValue: suggestion.maxValue ?? null,
              minIntegerValue: suggestion.minIntegerValue ?? null,
              maxIntegerValue: suggestion.maxIntegerValue ?? null,
              initialHeight: suggestion.initialHeight ?? null,
              dropdownOptions: suggestion.dropdownOptions,
              templateName: suggestion.templateName ?? undefined,
              order: suggestion.order ?? undefined,
            };
          })()
        : undefined;

    const current = ensureTemplateFieldConfig(configuration, fieldId, fallback);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      templateFields: {
        ...configuration.templateFields,
        [fieldId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleTemplateChange = (
    templateId: number,
    updater: (
      current: TestmoTemplateMappingConfig
    ) => TestmoTemplateMappingConfig
  ) => {
    const suggestion = templateSuggestions.find(
      (entry) => entry.id === templateId
    );
    const current = ensureTemplateConfig(configuration, templateId, suggestion);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      templates: {
        ...configuration.templates,
        [templateId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleMilestoneTypeChange = (
    milestoneTypeId: number,
    updater: (
      current: TestmoMilestoneTypeMappingConfig
    ) => TestmoMilestoneTypeMappingConfig
  ) => {
    const current = ensureMilestoneTypeConfig(configuration, milestoneTypeId);
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      milestoneTypes: {
        ...configuration.milestoneTypes,
        [milestoneTypeId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleConfigurationChange = (
    configurationId: number,
    updater: (
      current: TestmoConfigurationMappingConfig
    ) => TestmoConfigurationMappingConfig
  ) => {
    const suggestion = configurationSuggestionMap.get(configurationId);
    const current = ensureConfigurationConfig(
      configuration,
      configurationId,
      suggestion
    );
    const nextConfig: TestmoMappingConfiguration = {
      ...configuration,
      configurations: {
        ...configuration.configurations,
        [configurationId]: updater(current),
      },
    };
    onConfigurationChange(nextConfig);
  };

  const handleConfigVariantChange = (
    configurationId: number,
    variantIndex: number,
    updater: (
      current: TestmoConfigVariantMappingConfig
    ) => TestmoConfigVariantMappingConfig
  ) => {
    const suggestion = configurationSuggestionMap.get(configurationId);
    handleConfigurationChange(configurationId, (current) => {
      const token = suggestion?.variantTokens[variantIndex] ?? "";
      const nextVariant = updater(
        ensureConfigVariantMappingConfig(current.variants[variantIndex], token)
      );
      return {
        ...current,
        variants: {
          ...current.variants,
          [variantIndex]: nextVariant,
        },
      };
    });
  };

  const workflowSection = showWorkflows ? (
    workflowSuggestions.length > 0 ? (
      <WorkflowMappingSection
        t={t}
        tWorkflowCreate={tWorkflowCreate}
        suggestions={workflowSuggestions}
        existingWorkflows={existingWorkflows}
        workflowOptions={workflowOptions}
        configuration={configuration}
        onChange={handleWorkflowChange}
        description={sectionDescriptions?.workflows}
        totalCount={sectionCounts?.workflows}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noWorkflowsAvailable")}
      </p>
    )
  ) : null;

  const statusSection = showStatuses ? (
    statusSuggestions.length > 0 ? (
      <StatusMappingSection
        t={t}
        suggestions={statusSuggestions}
        existingStatuses={existingStatuses}
        statusOptions={statusOptions}
        configuration={configuration}
        onChange={handleStatusChange}
        description={sectionDescriptions?.statuses}
        totalCount={sectionCounts?.statuses}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noStatusesAvailable")}
      </p>
    )
  ) : null;

  if (
    !showWorkflows &&
    !showStatuses &&
    !showGroups &&
    !showRoles &&
    !showMilestoneTypes &&
    !showConfigurations &&
    !showUsers &&
    !showTemplates &&
    !showTemplateFields &&
    !showIssueTargets
  ) {
    return null;
  }

  const configurationSection = showConfigurations ? (
    configurationSuggestions.length > 0 ? (
      <ConfigurationMappingSection
        t={t}
        suggestions={configurationSuggestions}
        existingConfigurations={existingConfigurations}
        existingConfigCategories={existingConfigCategories}
        existingConfigVariants={existingConfigVariants}
        configuration={configuration}
        onConfigurationChange={handleConfigurationChange}
        onVariantChange={handleConfigVariantChange}
        description={sectionDescriptions?.configurations}
        totalCount={sectionCounts?.configurations}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noConfigurationsAvailable")}
      </p>
    )
  ) : null;

  const templateSection = showTemplates ? (
    templateSuggestions.length > 0 ? (
      <TemplateMappingSection
        t={t}
        suggestions={templateSuggestions}
        templateFieldSuggestions={templateFieldSuggestions}
        existingTemplates={existingTemplates}
        configuration={configuration}
        templateTargetUsage={templateTargetUsage}
        onChange={handleTemplateChange}
        description={sectionDescriptions?.templates}
        totalCount={sectionCounts?.templates}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noTemplatesAvailable")}
      </p>
    )
  ) : null;

  const templateFieldSection = showTemplateFields ? (
    templateFieldSuggestions.length > 0 ? (
      <TemplateFieldMappingSection
        t={t}
        suggestions={templateFieldSuggestions}
        caseFieldOptions={caseFieldOptions}
        resultFieldOptions={resultFieldOptions}
        fieldTypeOptions={fieldTypeOptions}
        configuration={configuration}
        onChange={handleTemplateFieldChange}
        description={sectionDescriptions?.templateFields}
        totalCount={sectionCounts?.templateFields}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noTemplateFieldsAvailable")}
      </p>
    )
  ) : null;

  const groupSection = showGroups ? (
    groupSuggestions.length > 0 ? (
      <GroupMappingSection
        t={t}
        suggestions={groupSuggestions}
        groupOptions={groupOptions}
        configuration={configuration}
        onChange={handleGroupChange}
        description={sectionDescriptions?.groups}
        totalCount={sectionCounts?.groups}
      />
    ) : (
      <p className="text-sm text-muted-foreground">{t("noGroupsAvailable")}</p>
    )
  ) : null;

  const issueTargetSection = showIssueTargets ? (
    issueTargetSuggestions.length > 0 ? (
      <IssueTargetMappingSection
        t={t}
        suggestions={issueTargetSuggestions}
        integrationOptions={integrationOptions}
        configuration={configuration}
        onChange={handleIssueTargetChange}
        description={sectionDescriptions?.issueTargets}
        totalCount={sectionCounts?.issueTargets}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noIssueTargetsAvailable")}
      </p>
    )
  ) : null;

  const userSection = showUsers ? (
    userSuggestions.length > 0 ? (
      <UserMappingSection
        t={t}
        suggestions={userSuggestions}
        userOptions={userOptions}
        roleOptions={roleOptions}
        configuration={configuration}
        onChange={handleUserChange}
        description={sectionDescriptions?.users}
        totalCount={sectionCounts?.users}
      />
    ) : (
      <p className="text-sm text-muted-foreground">{t("noUsersAvailable")}</p>
    )
  ) : null;

  const milestoneTypeSection = showMilestoneTypes ? (
    milestoneTypeSuggestions.length > 0 ? (
      <MilestoneTypeMappingSection
        t={t}
        suggestions={milestoneTypeSuggestions}
        milestoneOptions={milestoneTypeOptions}
        configuration={configuration}
        onChange={handleMilestoneTypeChange}
        description={sectionDescriptions?.milestoneTypes}
        totalCount={sectionCounts?.milestoneTypes}
      />
    ) : (
      <p className="text-sm text-muted-foreground">
        {t("noMilestoneTypesAvailable")}
      </p>
    )
  ) : null;

  const roleSection = showRoles ? (
    roleSuggestions.length > 0 ? (
      <RoleMappingSection
        t={t}
        suggestions={roleSuggestions}
        roleOptions={roleOptions}
        configuration={configuration}
        onChange={handleRoleChange}
        description={sectionDescriptions?.roles}
        totalCount={sectionCounts?.roles}
      />
    ) : (
      <p className="text-sm text-muted-foreground">{t("noRolesAvailable")}</p>
    )
  ) : null;

  if (
    !workflowSection &&
    !statusSection &&
    !configurationSection &&
    !templateSection &&
    !templateFieldSection &&
    !groupSection &&
    !issueTargetSection &&
    !userSection &&
    !roleSection &&
    !milestoneTypeSection
  ) {
    return null;
  }

  return (
    <div className="space-y-8">
      {workflowSection}
      {statusSection}
      {configurationSection}
      {templateSection}
      {templateFieldSection}
      {roleSection}
      {milestoneTypeSection}
      {userSection}
      {groupSection}
      {issueTargetSection}
    </div>
  );
}

interface WorkflowSectionProps {
  t: Translator;
  tWorkflowCreate: Translator;
  suggestions: TestmoWorkflowSuggestion[];
  existingWorkflows: TestmoExistingWorkflow[];
  workflowOptions: Array<{
    label: string;
    value: string;
    scope?: string | null;
    order?: number;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    workflowId: number,
    updater: (
      current: TestmoWorkflowMappingConfig
    ) => TestmoWorkflowMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

function WorkflowMappingSection({
  t,
  tWorkflowCreate,
  suggestions,
  existingWorkflows,
  workflowOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: WorkflowSectionProps) {
  const groupedWorkflowOptions = useMemo(
    () => groupWorkflowOptions(workflowOptions, t),
    [workflowOptions, t]
  );

  const workflowTypeSelectOptions = useMemo(
    () =>
      WORKFLOW_TYPE_VALUES.map((value) => ({
        value,
        label: translateWorkflowType(value, t),
      })),
    [t]
  );

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("workflowsHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSuggestedWorkflowType")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((workflow) => {
            const current = ensureWorkflowConfig(configuration, workflow.id);
            return (
              <TableRow key={workflow.id}>
                <TableCell className="font-medium">{workflow.name}</TableCell>
                <TableCell>
                  {workflow.suggestedWorkflowType ? (
                    <Badge variant="secondary">
                      {translateWorkflowType(workflow.suggestedWorkflowType, t)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("workflowTypeUnknown")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(workflow.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (workflowOptions[0]
                                ? Number(workflowOptions[0].value)
                                : null))
                            : undefined,
                        workflowType:
                          value === "map"
                            ? prev.workflowType
                            : (workflow.suggestedWorkflowType ??
                              prev.workflowType ??
                              null),
                        name:
                          value === "create"
                            ? (prev.name ?? workflow.name)
                            : undefined,
                        scope:
                          value === "create"
                            ? (prev.scope ?? DEFAULT_WORKFLOW_SCOPE)
                            : undefined,
                        iconId:
                          value === "create"
                            ? (prev.iconId ?? null)
                            : undefined,
                        colorId:
                          value === "create"
                            ? (prev.colorId ?? null)
                            : undefined,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-2">
                  {current.action === "map" ? (
                    workflowOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onChange(workflow.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("workflowSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {groupedWorkflowOptions.map((group) => (
                            <SelectGroup key={group.label}>
                              <SelectLabel>{group.label}</SelectLabel>
                              {group.options.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  className="ml-2"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noWorkflowsAvailable")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tWorkflowCreate("nameLabel")}
                        </p>
                        <Input
                          value={current.name ?? workflow.name}
                          onChange={(event) =>
                            onChange(workflow.id, (prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={tWorkflowCreate("namePlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tWorkflowCreate("scopeLabel")}
                        </p>
                        <Select
                          value={current.scope ?? DEFAULT_WORKFLOW_SCOPE}
                          onValueChange={(value) =>
                            onChange(workflow.id, (prev) => ({
                              ...prev,
                              scope: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={tWorkflowCreate("scopePlaceholder")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {Object.entries(scopeDisplayData).map(
                                ([scopeKey, { text }]) => (
                                  <SelectItem key={scopeKey} value={scopeKey}>
                                    {text}
                                  </SelectItem>
                                )
                              )}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tWorkflowCreate("iconColorLabel")}
                        </p>
                        <FieldIconPicker
                          initialIconId={current.iconId ?? undefined}
                          initialColorId={current.colorId ?? undefined}
                          onIconSelect={(iconId) =>
                            onChange(workflow.id, (prev) => ({
                              ...prev,
                              iconId,
                            }))
                          }
                          onColorSelect={(colorId) =>
                            onChange(workflow.id, (prev) => ({
                              ...prev,
                              colorId,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tWorkflowCreate("typeLabel")}
                        </p>
                        <Select
                          value={
                            current.workflowType ??
                            workflow.suggestedWorkflowType ??
                            ""
                          }
                          onValueChange={(value) =>
                            onChange(workflow.id, (prev) => ({
                              ...prev,
                              workflowType: value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("workflowTypePlaceholder")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {workflowTypeSelectOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface StatusSectionProps {
  t: Translator;
  suggestions: TestmoStatusSuggestion[];
  existingStatuses: TestmoExistingStatus[];
  statusOptions: Array<{
    value: string;
    name: string;
    systemName: string;
    colorHex?: string | null;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    statusId: number,
    updater: (current: TestmoStatusMappingConfig) => TestmoStatusMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface GroupSectionProps {
  t: Translator;
  suggestions: TestmoGroupSuggestion[];
  groupOptions: Array<{ value: string; label: string; note?: string | null }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    groupId: number,
    updater: (current: TestmoGroupMappingConfig) => TestmoGroupMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface IssueTargetSectionProps {
  t: Translator;
  suggestions: TestmoIssueTargetSuggestion[];
  integrationOptions: Array<{
    value: string;
    label: string;
    provider: string;
    status: string;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    issueTargetId: number,
    updater: (
      current: TestmoIssueTargetMappingConfig
    ) => TestmoIssueTargetMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface UserSectionProps {
  t: Translator;
  suggestions: TestmoUserSuggestion[];
  userOptions: Array<{
    value: string;
    label: string;
    email: string;
    name: string | null;
    isActive: boolean;
    access: Access;
    roleName: string | null;
  }>;
  roleOptions: Array<{
    value: string;
    label: string;
    isDefault: boolean;
    permissions: TestmoRolePermissions;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    userId: number,
    updater: (current: TestmoUserMappingConfig) => TestmoUserMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

function UserMappingSection({
  t,
  suggestions,
  userOptions,
  roleOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: UserSectionProps) {
  const tCommon = useTranslations("common");

  const accessOptionList = useMemo(() => {
    const ordered: Access[] = [
      Access.ADMIN,
      Access.USER,
      Access.PROJECTADMIN,
      Access.NONE,
    ];

    return ordered.map((value) => {
      let label: string;
      switch (value) {
        case Access.ADMIN:
          label = tCommon("access.admin");
          break;
        case Access.PROJECTADMIN:
          label = tCommon("access.projectAdmin");
          break;
        case Access.USER:
          label = tCommon("access.user");
          break;
        default:
          label = tCommon("access.none");
          break;
      }

      return { value, label };
    });
  }, [tCommon]);

  const accessLabel = (value: Access | null | undefined): string | null => {
    if (!value) {
      return null;
    }
    const match = accessOptionList.find((option) => option.value === value);
    return match ? match.label : value;
  };

  const defaultRoleOption = useMemo(() => {
    const preferred = roleOptions.find((option) => option.isDefault);
    return preferred ?? roleOptions[0] ?? null;
  }, [roleOptions]);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("usersHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((user) => {
            const current = ensureUserConfig(configuration, user.id);
            const nameValue = current.name ?? user.name ?? "";
            const emailValue = current.email ?? user.email ?? "";
            const passwordValue = current.password ?? "";
            const accessValue = current.access ?? user.access ?? Access.USER;
            const roleValue =
              current.roleId !== null && current.roleId !== undefined
                ? current.roleId.toString()
                : "";
            const isActiveValue =
              current.isActive !== undefined
                ? current.isActive
                : (user.isActive ?? true);
            const isApiValue =
              current.isApi !== undefined
                ? current.isApi
                : (user.isApi ?? false);

            const sourceDisplay =
              user.name ??
              user.email ??
              t("userDisplayFallback", { id: user.id });

            const requiresName =
              current.action === "create" && nameValue.trim().length === 0;
            const requiresEmail =
              current.action === "create" && emailValue.trim().length === 0;
            const requiresPassword =
              current.action === "create" && passwordValue.trim().length === 0;
            const requiresRole =
              current.action === "create" &&
              (current.roleId === null || current.roleId === undefined);
            const missingMapTarget =
              current.action === "map" &&
              (!current.mappedTo ||
                current.mappedTo.toString().trim().length === 0);

            const hasMissingData =
              requiresName ||
              requiresEmail ||
              requiresPassword ||
              requiresRole ||
              missingMapTarget;

            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  {sourceDisplay}
                  {hasMissingData && (
                    <div className="text-xs text-destructive">
                      {t("userMissingRequired")}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {user.email && (
                      <span className="text-sm text-muted-foreground">
                        {user.email}
                      </span>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant={isActiveValue ? "secondary" : "outline"}>
                        {isActiveValue
                          ? tCommon("status.active")
                          : tCommon("status.disabled")}
                      </Badge>
                      {accessLabel(user.access) && (
                        <Badge variant="outline">
                          {accessLabel(user.access)}
                        </Badge>
                      )}
                      {user.roleName && (
                        <Badge variant="outline">{user.roleName}</Badge>
                      )}
                      {user.isApi && (
                        <Badge variant="outline">{t("userApiBadge")}</Badge>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(user.id, (prev) => {
                        if (value === "map") {
                          return {
                            action: "map",
                            mappedTo: prev.mappedTo ?? null,
                          };
                        }

                        const fallbackRoleId =
                          prev.roleId ??
                          (defaultRoleOption
                            ? Number(defaultRoleOption.value)
                            : null);

                        const existingPassword =
                          typeof prev.password === "string" &&
                          prev.password.trim().length > 0
                            ? prev.password
                            : generateRandomPassword();

                        return {
                          action: "create",
                          mappedTo: null,
                          name: prev.name ?? user.name ?? "",
                          email: prev.email ?? user.email ?? "",
                          password: existingPassword,
                          access: prev.access ?? user.access ?? Access.USER,
                          roleId: fallbackRoleId,
                          isActive:
                            prev.isActive !== undefined
                              ? prev.isActive
                              : (user.isActive ?? true),
                          isApi:
                            prev.isApi !== undefined
                              ? prev.isApi
                              : (user.isApi ?? false),
                        };
                      })
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-3">
                  {current.action === "map" ? (
                    userOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo ?? ""}
                        onValueChange={(value) =>
                          onChange(user.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? value : null,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={
                            missingMapTarget
                              ? "border-destructive focus-visible:ring-destructive"
                              : undefined
                          }
                        >
                          <SelectValue
                            placeholder={t("userSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {userOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex flex-col">
                                <span>{option.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {option.email}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("userNoExistingTargets")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            {tCommon("fields.name")}
                          </p>
                          <Input
                            value={nameValue}
                            onChange={(event) =>
                              onChange(user.id, (prev) => ({
                                ...prev,
                                name: event.target.value,
                              }))
                            }
                            placeholder={t("userNamePlaceholder")}
                            className={
                              requiresName
                                ? "border-destructive focus-visible:ring-destructive"
                                : undefined
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            {tCommon("fields.email")}
                          </p>
                          <Input
                            type="email"
                            value={emailValue}
                            onChange={(event) =>
                              onChange(user.id, (prev) => ({
                                ...prev,
                                email: event.target.value,
                              }))
                            }
                            placeholder={t("userEmailPlaceholder")}
                            className={
                              requiresEmail
                                ? "border-destructive focus-visible:ring-destructive"
                                : undefined
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            {tCommon("fields.access")}
                          </p>
                          <Select
                            value={accessValue}
                            onValueChange={(value) =>
                              onChange(user.id, (prev) => ({
                                ...prev,
                                access: value as Access,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("userAccessPlaceholder")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {accessOptionList.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            {tCommon("fields.role")}
                          </p>
                          {roleOptions.length > 0 ? (
                            <Select
                              value={roleValue}
                              onValueChange={(value) =>
                                onChange(user.id, (prev) => ({
                                  ...prev,
                                  roleId: value ? Number(value) : null,
                                }))
                              }
                            >
                              <SelectTrigger
                                className={
                                  requiresRole
                                    ? "border-destructive focus-visible:ring-destructive"
                                    : undefined
                                }
                              >
                                <SelectValue
                                  placeholder={t("userRolePlaceholder")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {roleOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("userRoleUnavailable")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.password")}
                        </p>
                        <Input
                          type="password"
                          value={passwordValue}
                          onChange={(event) =>
                            onChange(user.id, (prev) => ({
                              ...prev,
                              password: event.target.value || "",
                            }))
                          }
                          placeholder={t("userPasswordPlaceholder")}
                          className={
                            requiresPassword
                              ? "border-destructive focus-visible:ring-destructive"
                              : undefined
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("userPasswordHint")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={isActiveValue}
                            onCheckedChange={(checked) =>
                              onChange(user.id, (prev) => ({
                                ...prev,
                                isActive: checked === true,
                              }))
                            }
                          />
                          {t("userActiveLabel")}
                        </label>
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={isApiValue}
                            onCheckedChange={(checked) =>
                              onChange(user.id, (prev) => ({
                                ...prev,
                                isApi: checked === true,
                              }))
                            }
                          />
                          {t("userApiLabel")}
                        </label>
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface MilestoneTypeSectionProps {
  t: Translator;
  suggestions: TestmoMilestoneTypeSuggestion[];
  milestoneOptions: Array<{
    value: string;
    label: string;
    iconId?: number | null;
    iconName?: string | null;
    isDefault: boolean;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    milestoneTypeId: number,
    updater: (
      current: TestmoMilestoneTypeMappingConfig
    ) => TestmoMilestoneTypeMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface ConfigurationSectionProps {
  t: Translator;
  suggestions: TestmoConfigurationSuggestion[];
  existingConfigurations: TestmoExistingConfiguration[];
  existingConfigCategories: TestmoExistingConfigCategory[];
  existingConfigVariants: TestmoExistingConfigVariant[];
  configuration: TestmoMappingConfiguration;
  onConfigurationChange: (
    configurationId: number,
    updater: (
      current: TestmoConfigurationMappingConfig
    ) => TestmoConfigurationMappingConfig
  ) => void;
  onVariantChange: (
    configurationId: number,
    variantIndex: number,
    updater: (
      current: TestmoConfigVariantMappingConfig
    ) => TestmoConfigVariantMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface TemplateSectionProps {
  t: Translator;
  suggestions: TestmoTemplateSuggestion[];
  templateFieldSuggestions: TestmoTemplateFieldSuggestion[];
  existingTemplates: TestmoExistingTemplate[];
  configuration: TestmoMappingConfiguration;
  templateTargetUsage: Map<number, number>;
  onChange: (
    templateId: number,
    updater: (
      current: TestmoTemplateMappingConfig
    ) => TestmoTemplateMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

interface TemplateFieldOption {
  value: string;
  label: string;
  displayName: string;
  systemName: string;
  typeId: number;
  typeName: string;
  isRestricted: boolean;
}

interface TemplateFieldSectionProps {
  t: Translator;
  suggestions: TestmoTemplateFieldSuggestion[];
  caseFieldOptions: TemplateFieldOption[];
  resultFieldOptions: TemplateFieldOption[];
  fieldTypeOptions: Array<{ value: string; label: string }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    templateFieldId: number,
    updater: (
      current: TestmoTemplateFieldMappingConfig
    ) => TestmoTemplateFieldMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}

function ConfigurationMappingSection({
  t,
  suggestions,
  existingConfigurations,
  existingConfigCategories,
  existingConfigVariants,
  configuration,
  onConfigurationChange,
  onVariantChange,
  description,
  totalCount,
}: ConfigurationSectionProps) {
  const configurationOptions = useMemo(
    () =>
      existingConfigurations.map((entry) => ({
        value: entry.id.toString(),
        label: entry.name,
      })),
    [existingConfigurations]
  );

  const variantOptions = useMemo(
    () =>
      existingConfigVariants.map((variant) => ({
        value: variant.id.toString(),
        label: variant.name,
        categoryName: variant.categoryName,
      })),
    [existingConfigVariants]
  );

  const categoryOptions = useMemo(
    () =>
      existingConfigCategories.map((category) => ({
        value: category.id.toString(),
        label: category.name,
      })),
    [existingConfigCategories]
  );

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">
          {t("configurationsHeading")}
        </h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnVariants")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((suggestion) => {
            const current = ensureConfigurationConfig(
              configuration,
              suggestion.id,
              suggestion
            );
            const variantTokens = suggestion.variantTokens ?? [];

            return (
              <TableRow key={suggestion.id}>
                <TableCell className="font-medium">{suggestion.name}</TableCell>
                <TableCell>
                  {variantTokens.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {variantTokens.map((token, index) => (
                        <Badge
                          key={`${suggestion.id}-token-${index}`}
                          variant="outline"
                        >
                          {token}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("configurationNoTokens")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onConfigurationChange(suggestion.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (configurationOptions[0]
                                ? Number(configurationOptions[0].value)
                                : null))
                            : undefined,
                        name:
                          value === "create"
                            ? (prev.name ?? suggestion.name)
                            : undefined,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {current.action === "map" ? (
                    configurationOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onConfigurationChange(suggestion.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("configurationSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {configurationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("configurationNoExistingTargets")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("configurationNameLabel")}
                        </p>
                        <Input
                          value={current.name ?? suggestion.name}
                          onChange={(event) =>
                            onConfigurationChange(suggestion.id, (prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={t("configurationNamePlaceholder")}
                        />
                      </div>
                      <div className="space-y-3">
                        {variantTokens.map((token, index) => {
                          const variantConfig =
                            ensureConfigVariantMappingConfig(
                              current.variants[index],
                              token
                            );
                          const selectedVariantId =
                            variantConfig.mappedVariantId !== undefined &&
                            variantConfig.mappedVariantId !== null
                              ? variantConfig.mappedVariantId.toString()
                              : "";
                          const selectedCategoryId =
                            variantConfig.categoryId !== undefined &&
                            variantConfig.categoryId !== null
                              ? variantConfig.categoryId.toString()
                              : "";

                          return (
                            <div
                              key={`${suggestion.id}-variant-${index}`}
                              className="space-y-3 rounded-md border p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    {t("configurationVariantLabel", {
                                      index: index + 1,
                                    })}
                                  </Badge>
                                  <Badge variant="outline">{token}</Badge>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">
                                  {t("configurationVariantActionLabel")}
                                </p>
                                <Select
                                  value={variantConfig.action}
                                  onValueChange={(value) =>
                                    onVariantChange(
                                      suggestion.id,
                                      index,
                                      (prev) => {
                                        const action =
                                          value as TestmoConfigVariantMappingConfig["action"];
                                        if (action === "map-variant") {
                                          const fallbackVariantId =
                                            variantOptions[0]
                                              ? Number(variantOptions[0].value)
                                              : null;
                                          return {
                                            ...prev,
                                            action,
                                            mappedVariantId: fallbackVariantId,
                                            categoryId: undefined,
                                            categoryName: undefined,
                                            variantName: undefined,
                                          };
                                        }

                                        if (
                                          action ===
                                          "create-variant-existing-category"
                                        ) {
                                          const fallbackCategoryId =
                                            categoryOptions[0]
                                              ? Number(categoryOptions[0].value)
                                              : null;
                                          return {
                                            ...prev,
                                            action,
                                            mappedVariantId: undefined,
                                            categoryId: fallbackCategoryId,
                                            categoryName: undefined,
                                            variantName:
                                              prev.variantName ?? token,
                                          };
                                        }

                                        return {
                                          ...prev,
                                          action,
                                          mappedVariantId: undefined,
                                          categoryId: undefined,
                                          categoryName:
                                            prev.categoryName ?? token,
                                          variantName:
                                            prev.variantName ?? token,
                                        };
                                      }
                                    )
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t(
                                        "configurationVariantActionPlaceholder"
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="map-variant">
                                      {t("configurationVariantMapOption")}
                                    </SelectItem>
                                    <SelectItem value="create-variant-existing-category">
                                      {t(
                                        "configurationVariantExistingCategoryOption"
                                      )}
                                    </SelectItem>
                                    <SelectItem value="create-category-variant">
                                      {t(
                                        "configurationVariantNewCategoryOption"
                                      )}
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {variantConfig.action === "map-variant" ? (
                                variantOptions.length > 0 ? (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      {t("configurationVariantSelectLabel")}
                                    </p>
                                    <Select
                                      value={selectedVariantId}
                                      onValueChange={(value) =>
                                        onVariantChange(
                                          suggestion.id,
                                          index,
                                          (prev) => ({
                                            ...prev,
                                            mappedVariantId: value
                                              ? Number(value)
                                              : null,
                                          })
                                        )
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue
                                          placeholder={t(
                                            "configurationVariantSelectPlaceholder"
                                          )}
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {variantOptions.map((option) => (
                                          <SelectItem
                                            key={option.value}
                                            value={option.value}
                                          >
                                            <div className="flex flex-col text-left">
                                              <span>{option.label}</span>
                                              {option.categoryName && (
                                                <span className="text-xs text-muted-foreground">
                                                  {option.categoryName}
                                                </span>
                                              )}
                                            </div>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {t("configurationVariantNoVariants")}
                                  </span>
                                )
                              ) : variantConfig.action ===
                                "create-variant-existing-category" ? (
                                categoryOptions.length > 0 ? (
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-muted-foreground">
                                        {t("configurationVariantCategoryLabel")}
                                      </p>
                                      <Select
                                        value={selectedCategoryId}
                                        onValueChange={(value) =>
                                          onVariantChange(
                                            suggestion.id,
                                            index,
                                            (prev) => ({
                                              ...prev,
                                              categoryId: value
                                                ? Number(value)
                                                : null,
                                            })
                                          )
                                        }
                                      >
                                        <SelectTrigger>
                                          <SelectValue
                                            placeholder={t(
                                              "configurationVariantCategoryPlaceholder"
                                            )}
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {categoryOptions.map((option) => (
                                            <SelectItem
                                              key={option.value}
                                              value={option.value}
                                            >
                                              {option.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium text-muted-foreground">
                                        {t("configurationVariantNameLabel")}
                                      </p>
                                      <Input
                                        value={
                                          variantConfig.variantName ?? token
                                        }
                                        onChange={(event) =>
                                          onVariantChange(
                                            suggestion.id,
                                            index,
                                            (prev) => ({
                                              ...prev,
                                              variantName: event.target.value,
                                            })
                                          )
                                        }
                                        placeholder={t(
                                          "configurationVariantNamePlaceholder"
                                        )}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {t("configurationVariantNoCategories")}
                                  </span>
                                )
                              ) : (
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      {t(
                                        "configurationVariantCategoryNameLabel"
                                      )}
                                    </p>
                                    <Input
                                      value={
                                        variantConfig.categoryName ?? token
                                      }
                                      onChange={(event) =>
                                        onVariantChange(
                                          suggestion.id,
                                          index,
                                          (prev) => ({
                                            ...prev,
                                            categoryName: event.target.value,
                                          })
                                        )
                                      }
                                      placeholder={t(
                                        "configurationVariantCategoryNamePlaceholder"
                                      )}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      {t("configurationVariantNameLabel")}
                                    </p>
                                    <Input
                                      value={variantConfig.variantName ?? token}
                                      onChange={(event) =>
                                        onVariantChange(
                                          suggestion.id,
                                          index,
                                          (prev) => ({
                                            ...prev,
                                            variantName: event.target.value,
                                          })
                                        )
                                      }
                                      placeholder={t(
                                        "configurationVariantNamePlaceholder"
                                      )}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function TemplateMappingSection({
  t,
  suggestions,
  templateFieldSuggestions,
  existingTemplates,
  configuration,
  templateTargetUsage,
  onChange,
  description,
  totalCount,
}: TemplateSectionProps) {
  const templateFieldMap = useMemo(() => {
    const map = new Map<number, TestmoTemplateFieldSuggestion>();
    templateFieldSuggestions.forEach((field) => {
      map.set(field.id, field);
    });
    return map;
  }, [templateFieldSuggestions]);

  const existingTemplateOptions = useMemo(
    () =>
      existingTemplates.map((template) => {
        const caseIds = template.caseFields
          .map((assignment) => assignment.fieldId)
          .filter((value): value is number => Number.isFinite(value));
        const resultIds = template.resultFields
          .map((assignment) => assignment.fieldId)
          .filter((value): value is number => Number.isFinite(value));

        return {
          value: template.id,
          label: template.name,
          caseIds,
          resultIds,
          caseSet: new Set(caseIds),
          resultSet: new Set(resultIds),
        };
      }),
    [existingTemplates]
  );

  if (suggestions.length === 0) {
    return null;
  }

  const statusTextMap: Record<string, string> = {
    mapped: t("templateFieldStatusMapped"),
    create: t("templateFieldStatusCreate"),
    missing: t("templateFieldStatusMissing"),
    mismatch: t("templateFieldStatusMismatch"),
  };

  const statusCardClasses: Record<
    "mapped" | "create" | "missing" | "mismatch",
    string
  > = {
    mapped:
      "border-secondary-foreground/60 bg-secondary-foreground/5 text-secondary-foreground",
    create: "border-primary/60 bg-primary/5 text-primary",
    missing: "border-destructive/60 bg-destructive/5 text-destructive",
    mismatch: "border-destructive/60 bg-destructive/5 text-destructive",
  };

  const statusIconMap: Record<
    "mapped" | "create" | "missing" | "mismatch",
    LucideIcon
  > = {
    mapped: BetweenHorizontalStart,
    create: FilePlus2,
    missing: SquareDashed,
    mismatch: EqualNot,
  };

  const getStatusColor = (
    status: "mapped" | "create" | "missing" | "mismatch"
  ) => {
    switch (status) {
      case "mapped":
        return "text-secondary-foreground";
      case "create":
        return "text-primary";
      default:
        return "text-destructive";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("templatesHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("templateColumnTemplate")}</TableHead>
            <TableHead>{t("templateColumnFields")}</TableHead>
            <TableHead>{t("templateColumnAction")}</TableHead>
            <TableHead>{t("templateColumnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((template) => {
            const current = ensureTemplateConfig(
              configuration,
              template.id,
              template
            );

            const buildEntries = (fieldIds: number[]) =>
              fieldIds
                .map((fieldId) => {
                  const fieldSuggestion = templateFieldMap.get(fieldId) ?? null;
                  const fallback:
                    | Partial<TestmoTemplateFieldMappingConfig>
                    | undefined = fieldSuggestion
                    ? {
                        action: fieldSuggestion.fieldId ? "map" : undefined,
                        targetType: fieldSuggestion.targetType,
                        displayName: fieldSuggestion.displayName ?? undefined,
                        systemName: fieldSuggestion.systemName ?? undefined,
                        templateName: fieldSuggestion.templateName ?? undefined,
                        typeName: fieldSuggestion.fieldType ?? undefined,
                        typeId: fieldSuggestion.fieldId ?? null,
                      }
                    : undefined;
                  const fieldConfig = ensureTemplateFieldConfig(
                    configuration,
                    fieldId,
                    fallback
                  );
                  const label = fieldSuggestion
                    ? (fieldSuggestion.displayName ??
                      fieldSuggestion.systemName ??
                      t("templateFieldDisplayFallback", { id: fieldId }))
                    : t("templateFieldDisplayFallback", { id: fieldId });

                  return {
                    fieldId,
                    label,
                    suggestion: fieldSuggestion,
                    config: fieldConfig,
                  };
                })
                .filter(
                  (entry, index, array) =>
                    array.findIndex(
                      (other) => other.fieldId === entry.fieldId
                    ) === index
                );

            const analyzeEntries = (
              entries: Array<{
                fieldId: number;
                label: string;
                suggestion: TestmoTemplateFieldSuggestion | null;
                config: TestmoTemplateFieldMappingConfig;
              }>
            ) => {
              const mappedIds: number[] = [];
              const enriched = entries.map((entry) => {
                const { config, suggestion } = entry;
                let status: "mapped" | "create" | "missing" = "missing";
                if (config.action === "create") {
                  status = "create";
                } else if (config.action === "map") {
                  if (
                    config.mappedTo !== null &&
                    config.mappedTo !== undefined
                  ) {
                    status = "mapped";
                    mappedIds.push(config.mappedTo);
                  } else {
                    status = "missing";
                  }
                }

                return {
                  ...entry,
                  status,
                  displayName:
                    config.displayName ??
                    suggestion?.displayName ??
                    suggestion?.systemName ??
                    t("templateFieldDisplayFallback", { id: entry.fieldId }),
                };
              });

              const hasCreate = enriched.some(
                (entry) => entry.status === "create"
              );
              const hasMissing = enriched.some(
                (entry) => entry.status === "missing"
              );
              const uniqueIds = new Set(mappedIds);
              const hasDuplicate = uniqueIds.size !== mappedIds.length;

              return {
                entries: enriched,
                mappedIds,
                uniqueIds,
                hasCreate,
                hasMissing,
                hasDuplicate,
              };
            };

            const caseAnalysis = analyzeEntries(
              buildEntries(template.caseTemplateFieldIds)
            );
            const resultAnalysis = analyzeEntries(
              buildEntries(template.resultTemplateFieldIds)
            );

            const mappedCaseIds = caseAnalysis.uniqueIds;
            const mappedResultIds = resultAnalysis.uniqueIds;

            const hasCreate =
              caseAnalysis.hasCreate || resultAnalysis.hasCreate;
            const hasMissing =
              caseAnalysis.hasMissing || resultAnalysis.hasMissing;
            const hasDuplicate =
              caseAnalysis.hasDuplicate || resultAnalysis.hasDuplicate;

            const canEvaluateMatch =
              !hasCreate &&
              !hasMissing &&
              !hasDuplicate &&
              mappedCaseIds.size === template.caseTemplateFieldIds.length &&
              mappedResultIds.size === template.resultTemplateFieldIds.length;

            const optionInfo = existingTemplateOptions.map((option) => {
              const matches =
                canEvaluateMatch &&
                option.caseSet.size === mappedCaseIds.size &&
                option.resultSet.size === mappedResultIds.size &&
                Array.from(mappedCaseIds).every((id) =>
                  option.caseSet.has(id)
                ) &&
                Array.from(mappedResultIds).every((id) =>
                  option.resultSet.has(id)
                );

              const usageCount = templateTargetUsage.get(option.value) ?? 0;
              const isMappedHere =
                current.action === "map" &&
                current.mappedTo !== null &&
                current.mappedTo !== undefined &&
                option.value === current.mappedTo;
              const alreadyUsed = usageCount > (isMappedHere ? 1 : 0);

              const disabled = !matches || alreadyUsed;
              const reason = alreadyUsed
                ? t("templateTargetAlreadyUsed")
                : !matches && canEvaluateMatch
                  ? t("templateTargetFieldsMismatch")
                  : undefined;

              return { option, matches, disabled, reason, alreadyUsed };
            });

            const matchingOptions = optionInfo.filter((entry) => entry.matches);
            const availableMatchingOptions = matchingOptions.filter(
              (entry) => !entry.disabled
            );

            const mapRadioDisabled =
              hasCreate ||
              hasMissing ||
              hasDuplicate ||
              matchingOptions.length === 0;

            let mapHint: string | undefined;
            if (hasCreate || hasMissing) {
              mapHint = t("templateMapHintIncomplete");
            } else if (hasDuplicate) {
              mapHint = t("templateMapHintDuplicate");
            } else if (matchingOptions.length === 0) {
              mapHint = t("templateMapHintNoMatch");
            } else if (availableMatchingOptions.length === 0) {
              const hasUsageBlocker = matchingOptions.some(
                (entry) => entry.alreadyUsed
              );
              if (hasUsageBlocker) {
                mapHint = t("templateMapHintAlreadyMapped");
              }
            }

            const selectOptionsMap = new Map<
              number,
              {
                option: (typeof existingTemplateOptions)[number];
                disabled: boolean;
                reason?: string;
              }
            >();

            matchingOptions.forEach((entry) => {
              selectOptionsMap.set(entry.option.value, {
                option: entry.option,
                disabled: entry.disabled,
                reason: entry.reason,
              });
            });

            const currentMappedValue =
              current.action === "map" &&
              current.mappedTo !== null &&
              current.mappedTo !== undefined
                ? current.mappedTo
                : null;

            if (
              currentMappedValue !== null &&
              !selectOptionsMap.has(currentMappedValue)
            ) {
              const fallback = optionInfo.find(
                (entry) => entry.option.value === currentMappedValue
              );
              if (fallback) {
                selectOptionsMap.set(fallback.option.value, {
                  option: fallback.option,
                  disabled: true,
                  reason:
                    fallback.reason ?? t("templateTargetNoLongerMatching"),
                });
              }
            }

            const selectOptions = Array.from(selectOptionsMap.values()).sort(
              (a, b) =>
                a.option.label.localeCompare(b.option.label, undefined, {
                  sensitivity: "base",
                })
            );

            const templateFieldCounts = (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">
                  {t("templateCaseFieldCountBadge", {
                    count: template.caseTemplateFieldIds.length,
                  })}
                </Badge>
                <Badge variant="outline">
                  {t("templateResultFieldCountBadge", {
                    count: template.resultTemplateFieldIds.length,
                  })}
                </Badge>
              </div>
            );

            const mappedTargetUsageCount =
              current.action === "map" &&
              current.mappedTo !== null &&
              current.mappedTo !== undefined
                ? (templateTargetUsage.get(current.mappedTo) ?? 0)
                : 0;
            const hasTargetConflict = mappedTargetUsageCount > 1;
            const missingTargetSelection =
              current.action === "map" &&
              (current.mappedTo === null || current.mappedTo === undefined);
            const templateHasFieldErrors =
              caseAnalysis.entries.some(
                (entry) => entry.status === "missing"
              ) ||
              resultAnalysis.entries.some(
                (entry) => entry.status === "missing"
              );
            const templateIssueMessages: string[] = [];
            if (missingTargetSelection) {
              templateIssueMessages.push(t("templateIssueNoSelection"));
            }
            if (hasTargetConflict) {
              templateIssueMessages.push(t("templateIssueTargetConflict"));
            }
            if (templateHasFieldErrors) {
              templateIssueMessages.push(t("templateIssueFieldErrors"));
            }

            if (
              process.env.NODE_ENV !== "production" &&
              templateIssueMessages.length > 0
            ) {
              console.debug("[TemplateMappingSection] Template issues", {
                templateId: template.id,
                templateName: template.name,
                issueMessages: templateIssueMessages,
                currentAction: current.action,
                mappedTo: current.mappedTo,
                fieldStatuses: {
                  caseFields: caseAnalysis.entries.map((entry) => ({
                    fieldId: entry.fieldId,
                    status: entry.status,
                    displayName: entry.displayName,
                  })),
                  resultFields: resultAnalysis.entries.map((entry) => ({
                    fieldId: entry.fieldId,
                    status: entry.status,
                    displayName: entry.displayName,
                  })),
                },
              });
            }

            const templateRowHasIssues = templateIssueMessages.length > 0;
            const templateRowClassName = templateRowHasIssues
              ? "border border-destructive/70 bg-destructive/5"
              : "border border-border";

            const renderFieldList = (
              label: string,
              entries: Array<{
                fieldId: number;
                label: string;
                status: "mapped" | "create" | "missing" | "mismatch";
                displayName: string;
                mappedSummary?: string;
              }>
            ) => (
              <div className="grid grid-cols-[140px,1fr] items-start gap-3">
                <span className="font-medium leading-5 whitespace-nowrap">
                  {label}
                </span>
                <div className="flex flex-col gap-2">
                  {entries.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {t("templateNoFieldsPlaceholder")}
                    </span>
                  ) : (
                    entries.map((entry) => {
                      const Icon = statusIconMap[entry.status];
                      const colorClass = getStatusColor(entry.status);
                      const statusLabel = statusTextMap[entry.status];
                      return (
                        <div
                          key={`${template.id}-${label}-${entry.fieldId}`}
                          className={`flex items-start gap-2 rounded-md border p-2 text-xs ${statusCardClasses[entry.status]}`}
                          title={statusLabel}
                        >
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {entry.displayName}
                              </span>
                              <span className="sr-only">{statusLabel}</span>
                            </div>
                            {entry.mappedSummary && (
                              <div className="text-[11px] text-muted-foreground">
                                {entry.mappedSummary}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );

            return (
              <TableRow key={template.id} className={templateRowClassName}>
                <TableCell className="align-top">
                  <div className="space-y-2">
                    <span className="font-medium leading-5">
                      {template.name}
                    </span>
                    {templateFieldCounts}
                    {templateIssueMessages.length > 0 && (
                      <div className="flex flex-col gap-1 text-xs">
                        {templateIssueMessages.map((message, index) => (
                          <Badge
                            key={`${template.id}-issue-${index}`}
                            variant="destructive"
                          >
                            {message}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-3 text-xs text-muted-foreground">
                    {renderFieldList(
                      t("templateCaseFieldsLabel"),
                      caseAnalysis.entries
                    )}
                    {renderFieldList(
                      t("templateResultFieldsLabel"),
                      resultAnalysis.entries
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top w-60">
                  <RadioGroup
                    value={current.action}
                    onValueChange={(value) => {
                      if (value === current.action) {
                        return;
                      }
                      if (value === "map") {
                        if (mapRadioDisabled) {
                          return;
                        }
                        const firstAvailable =
                          availableMatchingOptions[0]?.option.value ?? null;
                        onChange(template.id, (prev) => ({
                          ...prev,
                          action: "map",
                          mappedTo: firstAvailable,
                        }));
                      } else {
                        onChange(template.id, (prev) => ({
                          ...prev,
                          action: "create",
                          mappedTo: undefined,
                          name: prev.name ?? template.name,
                        }));
                      }
                    }}
                    className="space-y-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="map"
                        id={`template-${template.id}-action-map`}
                        disabled={mapRadioDisabled}
                      />
                      <Label
                        htmlFor={`template-${template.id}-action-map`}
                        className={
                          mapRadioDisabled ? "text-muted-foreground" : ""
                        }
                      >
                        {t("templateMapLabel")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="create"
                        id={`template-${template.id}-action-create`}
                      />
                      <Label htmlFor={`template-${template.id}-action-create`}>
                        {t("templateCreateLabel")}
                      </Label>
                    </div>
                  </RadioGroup>
                </TableCell>
                <TableCell className="align-top w-[280px] space-y-2">
                  {current.action === "map" ? (
                    selectOptions.length > 0 ? (
                      <Select
                        value={
                          currentMappedValue
                            ? currentMappedValue.toString()
                            : ""
                        }
                        onValueChange={(value) =>
                          onChange(template.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                        disabled={selectOptions.length === 0}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={t("templateSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {selectOptions.map((entry) => (
                            <SelectItem
                              key={entry.option.value}
                              value={entry.option.value.toString()}
                              disabled={entry.disabled}
                            >
                              <div className="flex flex-col">
                                <span className="truncate max-w-[220px]">
                                  {entry.option.label}
                                </span>
                                {entry.reason && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {entry.reason}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("templateNoMatchingTargets")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-2">
                      <Label
                        htmlFor={`template-${template.id}-name`}
                        className="text-xs"
                      >
                        {t("templateNewNameLabel")}
                      </Label>
                      <Input
                        id={`template-${template.id}-name`}
                        value={current.name ?? template.name}
                        onChange={(event) =>
                          onChange(template.id, (prev) => ({
                            ...prev,
                            name:
                              event.target.value.trim().length > 0
                                ? event.target.value
                                : template.name,
                          }))
                        }
                      />
                    </div>
                  )}
                  {mapHint && current.action === "map" && (
                    <p className="text-xs text-muted-foreground">{mapHint}</p>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function groupWorkflowOptions(
  options: Array<{
    label: string;
    value: string;
    scope?: string | null;
    order?: number;
  }>,
  t: Translator
): Array<{ label: string; options: Array<{ label: string; value: string }> }> {
  const groups = new Map<
    string,
    { label: string; options: Array<{ label: string; value: string }> }
  >();

  options.forEach((option) => {
    const scopeKey = option.scope ?? "";
    const label = formatWorkflowScopeLabel(option.scope, t);
    const existing = groups.get(scopeKey);
    if (existing) {
      existing.options.push({ label: option.label, value: option.value });
    } else {
      groups.set(scopeKey, {
        label,
        options: [{ label: option.label, value: option.value }],
      });
    }
  });

  return Array.from(groups.values());
}

function formatWorkflowScopeLabel(
  scope: string | null | undefined,
  t: Translator
): string {
  if (!scope) {
    return t("workflowScope.default");
  }

  const normalized = scope.toLowerCase();
  try {
    return t(`workflowScope.${normalized}`);
  } catch (error) {
    return scope;
  }
}

function formatApplicationAreaLabel(area: string): string {
  if (!area) {
    return "";
  }
  return area
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) =>
      word.length > 0
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : word
    )
    .join(" ");
}

function StatusMappingSection({
  t,
  suggestions,
  existingStatuses,
  statusOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: StatusSectionProps) {
  const tCommon = useTranslations("common");
  const tStatusAdd = useTranslations("admin.statuses.add");
  const tStatuses = useTranslations("admin.statuses");
  const systemNameEditedRef = useRef<Map<number, boolean>>(new Map());

  const { data: colorData } = useFindManyColor({
    select: { id: true, value: true },
    orderBy: { order: "asc" },
  });

  const colorMap = useMemo(() => {
    const map = new Map<number, string>();
    colorData?.forEach((color) => {
      map.set(color.id, color.value);
    });
    return map;
  }, [colorData]);

  const colorOptions = useMemo(
    () =>
      (colorData ?? []).map((color) => ({ id: color.id, value: color.value })),
    [colorData]
  );

  const { data: statusScopeData } = useFindManyStatusScope({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const scopeOptions = useMemo(
    () =>
      (statusScopeData ?? []).map((scope) => ({
        id: scope.id,
        name: scope.name,
      })),
    [statusScopeData]
  );

  const allScopeIds = useMemo(
    () => scopeOptions.map((scope) => scope.id),
    [scopeOptions]
  );

  useEffect(() => {
    if (suggestions.length === 0 || allScopeIds.length === 0) {
      return;
    }

    suggestions.forEach((status) => {
      const current = configuration.statuses?.[status.id];
      if (!current || current.action !== "create") {
        return;
      }

      const hasScopes =
        Array.isArray(current.scopeIds) && current.scopeIds.length > 0;

      if (!hasScopes) {
        onChange(status.id, (prev) => {
          if (prev.action !== "create") {
            return prev;
          }

          const prevHasScopes =
            Array.isArray(prev.scopeIds) && prev.scopeIds.length > 0;
          if (prevHasScopes) {
            return prev;
          }

          return {
            ...prev,
            scopeIds: allScopeIds,
          };
        });
      }
    });
  }, [allScopeIds, configuration, onChange, suggestions]);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("statusesHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((status) => {
            const current = ensureStatusConfig(configuration, status.id);
            const mappedOption =
              statusOptions.find(
                (option) => option.value === current.mappedTo?.toString()
              ) ?? null;
            const nameValue = current.name ?? status.name;
            const systemNameValue =
              current.systemName ?? status.systemName ?? "";
            const aliasesValue = current.aliases ?? "";
            const sanitizedAliases = sanitizeAliasInput(aliasesValue);
            const aliasInvalid =
              sanitizedAliases.length > 0 &&
              !ALIAS_LIST_REGEX.test(sanitizedAliases);
            const systemNameInvalid =
              systemNameValue.length > 0 &&
              !SYSTEM_NAME_REGEX.test(systemNameValue);
            const scopeIds =
              current.scopeIds && current.scopeIds.length > 0
                ? current.scopeIds
                : allScopeIds;
            const scopeInvalid =
              current.action === "create" &&
              scopeIds.length === 0 &&
              scopeOptions.length > 0;
            const resolvedColorId =
              current.colorId !== undefined && current.colorId !== null
                ? current.colorId
                : (colorOptions[0]?.id ?? null);
            const mappedColorHex =
              resolvedColorId !== null
                ? (colorMap.get(resolvedColorId) ?? null)
                : null;
            const selectedColorHex =
              mappedColorHex ??
              current.colorHex ??
              status.colorHex ??
              DEFAULT_STATUS_COLOR;
            const colorMissing =
              current.action === "create" && resolvedColorId === null;

            return (
              <TableRow key={status.id}>
                <TableCell className="font-medium">
                  <StatusDotDisplay
                    name={status.name}
                    color={status.colorHex ?? DEFAULT_STATUS_COLOR}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {status.systemName && (
                      <Badge variant="outline">
                        {t("labelSystemName")}: {status.systemName}
                      </Badge>
                    )}
                    {status.isSuccess && (
                      <Badge variant="secondary">{t("flagSuccess")}</Badge>
                    )}
                    {status.isFailure && (
                      <Badge variant="destructive">{t("flagFailure")}</Badge>
                    )}
                    {status.isCompleted && (
                      <Badge variant="secondary">{t("flagCompleted")}</Badge>
                    )}
                    {status.isUntested && (
                      <Badge variant="outline">{t("flagUntested")}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(status.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ?? existingStatuses[0]?.id ?? null)
                            : undefined,
                        scopeIds:
                          value === "create"
                            ? prev.scopeIds && prev.scopeIds.length > 0
                              ? prev.scopeIds
                              : allScopeIds
                            : prev.scopeIds,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {current.action === "map" ? (
                    statusOptions.length > 0 ? (
                      <div className="space-y-2">
                        <Select
                          value={current.mappedTo?.toString() ?? ""}
                          onValueChange={(value) =>
                            onChange(status.id, (prev) => ({
                              ...prev,
                              mappedTo: value ? Number(value) : null,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("statusSelectPlaceholder")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                <div className="flex items-center gap-2">
                                  <StatusDotDisplay
                                    name={option.name}
                                    color={
                                      option.colorHex ?? DEFAULT_STATUS_COLOR
                                    }
                                  />
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noStatusesAvailable")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <StatusDotDisplay
                          name={nameValue || status.name}
                          color={selectedColorHex}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.name")}
                        </p>
                        <Input
                          value={nameValue}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            onChange(status.id, (prev) => {
                              const next = {
                                ...prev,
                                name: nextValue,
                              };
                              if (!systemNameEditedRef.current.get(status.id)) {
                                const generated = generateSystemName(nextValue);
                                next.systemName = generated || undefined;
                              }
                              return next;
                            });
                          }}
                          placeholder={t("statusNamePlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.systemName")}
                        </p>
                        <Input
                          value={systemNameValue}
                          onFocus={() =>
                            systemNameEditedRef.current.set(status.id, true)
                          }
                          onChange={(event) => {
                            systemNameEditedRef.current.set(status.id, true);
                            const sanitized = generateSystemName(
                              event.target.value
                            );
                            onChange(status.id, (prev) => ({
                              ...prev,
                              systemName: sanitized || undefined,
                            }));
                          }}
                          placeholder={t("statusSystemNamePlaceholder")}
                        />
                        {systemNameInvalid && (
                          <p className="text-xs text-destructive">
                            {tStatusAdd("errors.systemNameInvalid")}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.aliases")}
                        </p>
                        <Input
                          value={aliasesValue}
                          onChange={(event) => {
                            const sanitized = sanitizeAliasInput(
                              event.target.value
                            );
                            onChange(status.id, (prev) => ({
                              ...prev,
                              aliases: sanitized || undefined,
                            }));
                          }}
                          placeholder={tStatusAdd("aliasesHelp")}
                        />
                        {aliasInvalid && (
                          <p className="text-xs text-destructive">
                            {tStatusAdd("errors.aliasesInvalid")}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tStatuses("fields.color")}
                        </p>
                        <div className="flex items-center w-10 h-10">
                          <div style={{ backgroundColor: selectedColorHex }} />
                          <ColorPicker
                            initialColorId={resolvedColorId ?? undefined}
                            onColorSelect={(colorId) => {
                              const colorValue =
                                colorMap.get(colorId) ?? DEFAULT_STATUS_COLOR;
                              onChange(status.id, (prev) => ({
                                ...prev,
                                colorId,
                                colorHex: colorValue,
                              }));
                            }}
                          />
                        </div>
                        {colorMissing && (
                          <p className="text-xs text-destructive">
                            {"Select a color"}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.scope")}
                        </p>
                        <div className="flex flex-wrap gap-3">
                          {scopeOptions.map((scope) => {
                            const isChecked = scopeIds.includes(scope.id);
                            return (
                              <label
                                key={scope.id}
                                className="flex items-center gap-2 text-xs"
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) =>
                                    onChange(status.id, (prev) => {
                                      const baseScopeIds = scopeIds;
                                      const normalizedChecked =
                                        checked === true;
                                      const nextScopeIds = normalizedChecked
                                        ? Array.from(
                                            new Set([...baseScopeIds, scope.id])
                                          )
                                        : baseScopeIds.filter(
                                            (value) => value !== scope.id
                                          );
                                      return {
                                        ...prev,
                                        scopeIds: nextScopeIds,
                                      };
                                    })
                                  }
                                />
                                {scope.name}
                              </label>
                            );
                          })}
                        </div>
                        {scopeInvalid && (
                          <p className="text-xs text-destructive">
                            {"Select at least one scope"}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={current.isEnabled ?? true}
                            onCheckedChange={(checked) =>
                              onChange(status.id, (prev) => ({
                                ...prev,
                                isEnabled: checked !== false,
                              }))
                            }
                          />
                          {tCommon("fields.enabled")}
                        </label>
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={current.isSuccess ?? false}
                            onCheckedChange={(checked) =>
                              onChange(status.id, (prev) => ({
                                ...prev,
                                isSuccess: checked === true,
                                isFailure:
                                  checked === true
                                    ? false
                                    : (prev.isFailure ?? false),
                              }))
                            }
                          />
                          {tCommon("fields.success")}
                        </label>
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={current.isFailure ?? false}
                            onCheckedChange={(checked) =>
                              onChange(status.id, (prev) => ({
                                ...prev,
                                isFailure: checked === true,
                                isSuccess:
                                  checked === true
                                    ? false
                                    : (prev.isSuccess ?? false),
                              }))
                            }
                          />
                          {tCommon("fields.failure")}
                        </label>
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={current.isCompleted ?? false}
                            onCheckedChange={(checked) =>
                              onChange(status.id, (prev) => ({
                                ...prev,
                                isCompleted: checked === true,
                              }))
                            }
                          />
                          {tCommon("fields.completed")}
                        </label>
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function IssueTargetMappingSection({
  t,
  suggestions,
  integrationOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: IssueTargetSectionProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("issueTargetsHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((issueTarget) => {
            const current = ensureIssueTargetConfig(
              configuration,
              issueTarget.id
            );

            return (
              <TableRow key={issueTarget.id}>
                <TableCell className="font-medium">
                  {issueTarget.name}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {issueTarget.provider && (
                      <Badge variant="outline" className="text-xs capitalize">
                        {issueTarget.provider}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {`Type ${issueTarget.type}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(issueTarget.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (integrationOptions[0]
                                ? Number(integrationOptions[0].value)
                                : null))
                            : undefined,
                        name:
                          value === "create"
                            ? (prev.name ?? issueTarget.name)
                            : undefined,
                        provider: issueTarget.provider,
                        testmoType: issueTarget.type,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-2">
                  {current.action === "map" ? (
                    integrationOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onChange(issueTarget.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                            provider: issueTarget.provider,
                            testmoType: issueTarget.type,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("issueTargetSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {integrationOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex flex-col">
                                <span>{option.label}</span>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Badge
                                    variant="outline"
                                    className="text-xs capitalize"
                                  >
                                    {option.provider}
                                  </Badge>
                                  <span>{option.status}</span>
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noIssueTargetsAvailable")}
                      </span>
                    )
                  ) : (
                    <Input
                      value={current.name ?? issueTarget.name}
                      onChange={(event) =>
                        onChange(issueTarget.id, (prev) => ({
                          ...prev,
                          name: event.target.value,
                          provider: issueTarget.provider,
                          testmoType: issueTarget.type,
                        }))
                      }
                      placeholder={t("issueTargetNamePlaceholder")}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function GroupMappingSection({
  t,
  suggestions,
  groupOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: GroupSectionProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("groupsHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((group) => {
            const current = ensureGroupConfig(configuration, group.id);
            const mappedGroup = groupOptions.find(
              (option) => option.value === current.mappedTo?.toString()
            );

            return (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell>
                  {group.note ? (
                    <p className="text-xs text-muted-foreground whitespace-pre-line">
                      {group.note}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("groupNoteEmpty")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(group.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (groupOptions[0]
                                ? Number(groupOptions[0].value)
                                : null))
                            : undefined,
                        name:
                          value === "create"
                            ? (prev.name ?? group.name)
                            : undefined,
                        note:
                          value === "create"
                            ? (prev.note ?? group.note ?? "")
                            : undefined,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-2">
                  {current.action === "map" ? (
                    groupOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onChange(group.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("groupSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {groupOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex flex-col">
                                <span>{option.label}</span>
                                {option.note && (
                                  <span className="text-xs text-muted-foreground">
                                    {option.note}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noGroupsAvailable")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={current.name ?? group.name}
                        onChange={(event) =>
                          onChange(group.id, (prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        placeholder={t("groupNamePlaceholder")}
                      />
                      <Input
                        value={current.note ?? group.note ?? ""}
                        onChange={(event) =>
                          onChange(group.id, (prev) => ({
                            ...prev,
                            note: event.target.value || undefined,
                          }))
                        }
                        placeholder={t("groupNotePlaceholder")}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function TemplateFieldMappingSection({
  t,
  suggestions,
  caseFieldOptions,
  resultFieldOptions,
  fieldTypeOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: TemplateFieldSectionProps) {
  const tCommon = useTranslations("common");

  const buildDraftOptionsFromConfig = (
    options?: TestmoFieldOptionConfig[]
  ): { drafts: FieldDraftOption[]; names: string[] } => {
    if (!options || options.length === 0) {
      return { drafts: [], names: [] };
    }

    const sorted = options
      .map((option, index) => ({ option, fallbackIndex: index }))
      .filter(({ option }) => typeof option?.name === "string")
      .sort(
        (a, b) =>
          (a.option.order ?? a.fallbackIndex) -
          (b.option.order ?? b.fallbackIndex)
      )
      .map(({ option }) => option as TestmoFieldOptionConfig);

    let defaultSeen = false;
    const drafts = sorted.map((option, index) => {
      const optionIsDefault = Boolean(option.isDefault) && !defaultSeen;
      if (option.isDefault && !defaultSeen) {
        defaultSeen = true;
      }
      return {
        name: option.name,
        iconId: option.iconId ?? undefined,
        iconColorId: option.iconColorId ?? undefined,
        isEnabled: option.isEnabled ?? true,
        isDefault: optionIsDefault,
        order: option.order ?? index,
      } satisfies FieldDraftOption;
    });

    if (!defaultSeen && drafts.length > 0) {
      drafts[0] = { ...drafts[0], isDefault: true };
    }

    return {
      drafts,
      names: drafts.map((draft) => draft.name),
    };
  };

  const buildOptionConfigsFromFieldOptions = (
    options: FieldOptions[],
    defaultOptionId: number | null
  ): TestmoFieldOptionConfig[] | undefined => {
    if (!options || options.length === 0) {
      return undefined;
    }

    const resolvedDefaultId =
      defaultOptionId ?? options.find((option) => option.isDefault)?.id ?? null;

    const normalized = options
      .filter(
        (option) =>
          option &&
          typeof option.name === "string" &&
          option.name.trim().length > 0 &&
          option.isDeleted !== true
      )
      .map((option, index) => ({
        name: option.name.trim(),
        iconId: option.iconId ?? null,
        iconColorId: option.iconColorId ?? null,
        isEnabled: option.isEnabled ?? true,
        isDefault:
          resolvedDefaultId !== null
            ? option.id === resolvedDefaultId
            : index === 0,
        order: option.order ?? index,
      }));

    if (normalized.length === 0) {
      return undefined;
    }

    const sorted = normalized
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((entry, index) => ({
        name: entry.name,
        iconId: entry.iconId ?? null,
        iconColorId: entry.iconColorId ?? null,
        isEnabled: entry.isEnabled ?? true,
        isDefault: entry.isDefault ?? false,
        order: index,
      }));

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

    return sorted;
  };

  const resolveOptionLabel = (
    option: string | TestmoFieldOptionConfig
  ): string => (typeof option === "string" ? option : option.name);

  type TargetOption = TemplateFieldOption & { group: "case" | "result" };

  const isCheckboxLabel = (value?: string | null): boolean => {
    if (typeof value !== "string") {
      return false;
    }
    return value.trim().toLowerCase().includes("checkbox");
  };

  const caseTargetOptions = useMemo<TargetOption[]>(
    () => caseFieldOptions.map((option) => ({ ...option, group: "case" })),
    [caseFieldOptions]
  );

  const resultTargetOptions = useMemo<TargetOption[]>(
    () => resultFieldOptions.map((option) => ({ ...option, group: "result" })),
    [resultFieldOptions]
  );

  const groupedTargetOptions = useMemo(
    () =>
      [
        {
          key: "case" as const,
          label: t("templateFieldTargetGroupCase"),
          options: caseTargetOptions,
        },
        {
          key: "result" as const,
          label: t("templateFieldTargetGroupResult"),
          options: resultTargetOptions,
        },
      ].filter((group) => group.options.length > 0),
    [caseTargetOptions, resultTargetOptions, t]
  );

  const flatTargetOptions = useMemo(
    () => [...caseTargetOptions, ...resultTargetOptions],
    [caseTargetOptions, resultTargetOptions]
  );

  const buildDraftFromConfig = (
    config?: TestmoTemplateFieldMappingConfig
  ): {
    values: Record<string, unknown>;
    options: FieldDraftOption[];
  } => {
    const { drafts: optionDrafts, names: optionNames } =
      buildDraftOptionsFromConfig(config?.dropdownOptions);

    const values: Record<string, unknown> = {
      displayName: config?.displayName ?? "",
      systemName: config?.systemName ?? "",
      typeId: config?.typeId ? config.typeId.toString() : "",
      hint: config?.hint ?? "",
      isEnabled: true,
      isRequired: config?.isRequired ?? false,
      isRestricted: config?.isRestricted ?? false,
      defaultValue: config?.defaultValue ?? "",
      isChecked: config?.isChecked ?? false,
      minValue: config?.minValue ?? null,
      maxValue: config?.maxValue ?? null,
      minIntegerValue: config?.minIntegerValue ?? null,
      maxIntegerValue: config?.maxIntegerValue ?? null,
      initialHeight: config?.initialHeight ?? null,
      dropdownOptions: optionNames,
    };

    const options: FieldDraftOption[] = optionDrafts;

    return { values, options };
  };

  type FieldDraftSubmitPayload = {
    values: Record<string, unknown>;
    dropdownOptions: FieldOptions[];
    defaultOptionId: number | null;
    typeName: string | undefined;
  };

  type FieldEditorDraft = ReturnType<typeof buildDraftFromConfig>;

  const [fieldEditorState, setFieldEditorState] = useState<{
    fieldId: number;
    targetType: TestmoTemplateFieldTargetType;
    draft: FieldEditorDraft;
  } | null>(null);

  const openFieldEditor = (
    fieldId: number,
    targetType: TestmoTemplateFieldTargetType,
    draft: FieldEditorDraft
  ) => {
    setFieldEditorState({ fieldId, targetType, draft });
  };

  const closeFieldEditor = () => setFieldEditorState(null);

  const editorDraft = fieldEditorState?.draft ?? null;
  const editorTargetType = fieldEditorState?.targetType ?? null;
  const caseModalOpen = editorTargetType === "case";
  const resultModalOpen = editorTargetType === "result";

  const coerceNullableNumber = (input: unknown): number | null => {
    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }
    if (typeof input === "string" && input.trim().length > 0) {
      const parsed = Number(input);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const coerceBoolean = (input: unknown): boolean => {
    if (typeof input === "boolean") {
      return input;
    }
    if (typeof input === "string") {
      const normalized = input.trim().toLowerCase();
      return normalized === "true" || normalized === "1";
    }
    if (typeof input === "number") {
      return input !== 0;
    }
    return false;
  };

  const handleFieldDraftSubmit = (
    fieldId: number,
    targetType: TestmoTemplateFieldTargetType,
    payload: FieldDraftSubmitPayload
  ) => {
    const values = payload.values;
    const typeIdValue =
      typeof values.typeId === "string" && values.typeId
        ? Number(values.typeId)
        : null;
    const resolvedTypeName =
      payload.typeName ??
      (typeIdValue !== null
        ? (fieldTypeOptions.find(
            (option) => option.value === typeIdValue.toString()
          )?.label ?? undefined)
        : undefined);

    const normalizedOptions = buildOptionConfigsFromFieldOptions(
      payload.dropdownOptions,
      payload.defaultOptionId
    );

    onChange(fieldId, (prev) => ({
      ...prev,
      action: "create",
      targetType,
      mappedTo: null,
      displayName:
        typeof values.displayName === "string"
          ? values.displayName
          : (prev.displayName ?? ""),
      systemName:
        typeof values.systemName === "string"
          ? values.systemName
          : (prev.systemName ?? ""),
      typeId: typeIdValue,
      typeName: resolvedTypeName ?? prev.typeName ?? undefined,
      hint:
        typeof values.hint === "string" && values.hint.length > 0
          ? values.hint
          : undefined,
      isRequired: coerceBoolean(values.isRequired),
      isRestricted: coerceBoolean(values.isRestricted),
      defaultValue:
        typeof values.defaultValue === "string" &&
        values.defaultValue.length > 0
          ? values.defaultValue
          : null,
      isChecked: coerceBoolean(values.isChecked),
      minValue: coerceNullableNumber(values.minValue),
      maxValue: coerceNullableNumber(values.maxValue),
      minIntegerValue: coerceNullableNumber(values.minIntegerValue),
      maxIntegerValue: coerceNullableNumber(values.maxIntegerValue),
      initialHeight: coerceNullableNumber(values.initialHeight),
      dropdownOptions: normalizedOptions,
    }));

    closeFieldEditor();
    return true;
  };

  const templateFieldTargetUsage = useMemo(() => {
    const usage = new Map<string, number>();
    Object.values(configuration.templateFields ?? {}).forEach((config) => {
      if (
        config &&
        config.action === "map" &&
        config.mappedTo !== null &&
        config.mappedTo !== undefined
      ) {
        const targetTypeKey = config.targetType ?? "case";
        const key = `${targetTypeKey}:${config.mappedTo}`;
        usage.set(key, (usage.get(key) ?? 0) + 1);
      }
    });
    return usage;
  }, [configuration.templateFields]);

  const renderTargetOption = (option?: TargetOption | null, note?: string) => {
    if (!option) {
      return null;
    }
    const display = option.displayName || option.label;
    const system = option.systemName;
    const content = (
      <span className="inline-flex max-w-full items-center gap-1 truncate">
        <span className="max-w-[200px] truncate">{display}</span>
        {system ? (
          <span className="text-muted-foreground max-w-[200px] truncate">
            {"("}
            {system}
            {")"}
          </span>
        ) : null}
      </span>
    );

    if (!note) {
      return content;
    }

    return (
      <span className="inline-flex max-w-full flex-col gap-1 truncate">
        {content}
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
    );
  };

  const normalizeFieldTypeName = (value?: string | null) =>
    value ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") || null : null;

  const findFieldTypeOption = (typeName?: string | null) => {
    const normalized = normalizeFieldTypeName(typeName ?? null);
    if (!normalized) {
      return null;
    }
    return (
      fieldTypeOptions.find(
        (option) => normalizeFieldTypeName(option.label) === normalized
      ) ?? null
    );
  };

  const includeComposite = (
    set: Set<string>,
    targetType: "case" | "result",
    value: string
  ): boolean => set.has(`${targetType}:${value}`) || set.has(value);

  const findBestOptionForField = (
    field: TestmoTemplateFieldSuggestion,
    preferred: TargetOption[],
    fallbackPool: TargetOption[],
    excludeValues?: Set<string>
  ): TargetOption | null => {
    const filterExcluded = (options: TargetOption[]) =>
      excludeValues
        ? options.filter(
            (option) =>
              !includeComposite(excludeValues, option.group, option.value)
          )
        : options;

    const filteredPreferred = filterExcluded(preferred);
    const filteredFallback = filterExcluded(fallbackPool);

    const normalizedDesiredType = normalizeFieldTypeName(
      field.fieldType ?? undefined
    );
    const candidatePool =
      filteredPreferred.length > 0 ? filteredPreferred : filteredFallback;
    const typeMatched = normalizedDesiredType
      ? candidatePool.filter(
          (option) =>
            normalizeFieldTypeName(option.typeName) === normalizedDesiredType
        )
      : [];
    const prioritized = typeMatched.length > 0 ? typeMatched : candidatePool;

    const tryMatch = (options: TargetOption[]) =>
      options.find((option) => {
        const normalizedSystem = (option.systemName ?? "").trim().toLowerCase();
        return (
          (field.systemName &&
            normalizedSystem === field.systemName.trim().toLowerCase()) ||
          (field.displayName &&
            option.label
              .toLowerCase()
              .includes(field.displayName.trim().toLowerCase()))
        );
      });

    const directMatch = tryMatch(prioritized);
    if (directMatch) {
      return directMatch;
    }

    if (prioritized.length > 0) {
      return prioritized[0];
    }

    const fallbackMatch = tryMatch(filteredFallback);
    if (fallbackMatch) {
      return fallbackMatch;
    }

    return filteredFallback[0] ?? null;
  };

  const renderSummaryValue = (value: unknown): ReactNode => {
    if (value === undefined || value === null || value === "") {
      return (
        <span className="text-muted-foreground">
          {t("templateFieldSummaryMissingValue")}
        </span>
      );
    }
    if (typeof value === "boolean") {
      return value ? tCommon("yes") : tCommon("no");
    }
    return value as ReactNode;
  };

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">
          {t("templateFieldsHeading")}
        </h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <AddCaseFieldModal
        open={caseModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeFieldEditor();
          }
        }}
        trigger={null}
        submitLabel={t("templateFieldModalSaveButton")}
        draft={
          caseModalOpen && editorDraft
            ? {
                values: editorDraft.values,
                options: editorDraft.options,
              }
            : undefined
        }
        onSubmitField={(payload) => {
          if (!fieldEditorState) {
            return false;
          }
          return handleFieldDraftSubmit(
            fieldEditorState.fieldId,
            "case",
            payload
          );
        }}
      />
      <AddResultFieldModal
        open={resultModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeFieldEditor();
          }
        }}
        trigger={null}
        submitLabel={t("templateFieldModalSaveButton")}
        draft={
          resultModalOpen && editorDraft
            ? {
                values: editorDraft.values,
                options: editorDraft.options,
              }
            : undefined
        }
        onSubmitField={(payload) => {
          if (!fieldEditorState) {
            return false;
          }
          return handleFieldDraftSubmit(
            fieldEditorState.fieldId,
            "result",
            payload
          );
        }}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead className="min-w-48">{t("columnAction")}</TableHead>
            <TableHead className="min-w-96">{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((field) => {
            const displayNameFallback =
              field.displayName ??
              field.systemName ??
              t("templateFieldDisplayFallback", { id: field.id });

            const fallbackTypeOption = findFieldTypeOption(
              field.fieldType ?? null
            );

            const fallback: Partial<TestmoTemplateFieldMappingConfig> = {
              action: "map",
              targetType: field.targetType,
              displayName: displayNameFallback,
              systemName: field.systemName ?? undefined,
              typeId: fallbackTypeOption
                ? Number(fallbackTypeOption.value)
                : undefined,
              typeName:
                fallbackTypeOption?.label ?? field.fieldType ?? undefined,
              isRequired: field.isRequired ?? false,
              isRestricted: field.isRestricted ?? false,
              defaultValue: field.defaultValue ?? null,
              hint: field.hint ?? undefined,
              dropdownOptions: field.dropdownOptions,
              order: field.order ?? undefined,
              templateName: field.templateName ?? undefined,
            };

            const current = ensureTemplateFieldConfig(
              configuration,
              field.id,
              fallback
            );

            const matchedOption =
              current.mappedTo !== undefined && current.mappedTo !== null
                ? flatTargetOptions.find(
                    (option) =>
                      option.value === current.mappedTo?.toString() &&
                      option.group === current.targetType
                  )
                : undefined;

            const disallowedTargets = new Set<string>();
            const currentCompositeKey =
              current.action === "map" &&
              current.mappedTo !== null &&
              current.mappedTo !== undefined
                ? `${current.targetType}:${current.mappedTo}`
                : null;
            templateFieldTargetUsage.forEach((count, value) => {
              const otherCount =
                value === currentCompositeKey ? count - 1 : count;
              if (otherCount > 0) {
                disallowedTargets.add(value);
              }
            });

            const isTargetInUse =
              currentCompositeKey !== null &&
              disallowedTargets.has(currentCompositeKey);

            const existingTypeOption =
              current.typeId !== null && current.typeId !== undefined
                ? (fieldTypeOptions.find(
                    (option) => option.value === current.typeId?.toString()
                  ) ?? null)
                : null;

            const automaticTypeOption =
              existingTypeOption ?? fallbackTypeOption;

            const resolvedTypeName =
              current.typeName ??
              automaticTypeOption?.label ??
              field.fieldType ??
              null;

            const isCheckboxType = isCheckboxLabel(resolvedTypeName);

            const effectiveTypeId =
              current.typeId !== null && current.typeId !== undefined
                ? current.typeId
                : automaticTypeOption
                  ? Number(automaticTypeOption.value)
                  : null;

            if (
              current.action === "create" &&
              (current.typeId === null || current.typeId === undefined) &&
              effectiveTypeId !== null &&
              resolvedTypeName
            ) {
              onChange(field.id, (prev) => ({
                ...prev,
                typeId: effectiveTypeId,
                typeName: resolvedTypeName,
              }));
            }
            const targetTypeLabel =
              current.targetType === "result"
                ? t("templateFieldTargetResult")
                : t("templateFieldTargetCase");
            const summaryDisplayName =
              current.displayName && current.displayName.length > 0
                ? current.displayName
                : displayNameFallback;

            const trimmedDisplayName = summaryDisplayName
              ? summaryDisplayName.trim()
              : "";
            const systemNameForValidation = (() => {
              if (current.systemName && current.systemName.trim().length > 0) {
                return current.systemName.trim();
              }
              if (field.systemName && field.systemName.trim().length > 0) {
                return field.systemName.trim();
              }
              const generated = generateSystemName(trimmedDisplayName);
              if (generated.length > 0) {
                return generated;
              }
              return `field_${field.id}`;
            })();
            const systemNameDisplayValue =
              current.systemName && current.systemName.trim().length > 0
                ? current.systemName
                : systemNameForValidation;

            const creationSummaryRows: Array<{
              label: string;
              value: ReactNode;
            }> = [
              {
                label: t("templateFieldTargetTypeLabel"),
                value: renderSummaryValue(targetTypeLabel),
              },
              {
                label: tCommon("fields.fieldType"),
                value: renderSummaryValue(resolvedTypeName),
              },
              {
                label: tCommon("fields.displayName"),
                value: renderSummaryValue(summaryDisplayName),
              },
              {
                label: tCommon("fields.systemName"),
                value: renderSummaryValue(systemNameDisplayValue),
              },
              {
                label: t("templateFieldRequiredLabel"),
                value: renderSummaryValue(coerceBoolean(current.isRequired)),
              },
              {
                label: t("templateFieldRestrictedLabel"),
                value: renderSummaryValue(coerceBoolean(current.isRestricted)),
              },
            ];

            if (current.defaultValue) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsDefaultValueLabel"),
                value: renderSummaryValue(current.defaultValue),
              });
            }

            if (current.hint) {
              creationSummaryRows.push({
                label: tCommon("fields.hint"),
                value: renderSummaryValue(current.hint),
              });
            }

            if (
              current.isChecked !== null &&
              current.isChecked !== undefined &&
              isCheckboxType
            ) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsCheckedLabel"),
                value: renderSummaryValue(coerceBoolean(current.isChecked)),
              });
            }

            if (current.minValue !== null) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsMinValueLabel"),
                value: renderSummaryValue(current.minValue),
              });
            }

            if (current.maxValue !== null) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsMaxValueLabel"),
                value: renderSummaryValue(current.maxValue),
              });
            }

            if (current.minIntegerValue !== null) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsMinIntegerLabel"),
                value: renderSummaryValue(current.minIntegerValue),
              });
            }

            if (current.maxIntegerValue !== null) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsMaxIntegerLabel"),
                value: renderSummaryValue(current.maxIntegerValue),
              });
            }

            if (current.initialHeight !== null) {
              creationSummaryRows.push({
                label: t("templateFieldOptionsInitialHeightLabel"),
                value: renderSummaryValue(current.initialHeight),
              });
            }

            const sourceDisplay = displayNameFallback;
            const normalizedTemplateNames = (field.templateNames ?? []).filter(
              (name) => typeof name === "string" && name.trim().length > 0
            );
            const templateNamesToDisplay =
              normalizedTemplateNames.length > 0
                ? normalizedTemplateNames
                : [t("templateFieldUnknownTemplate")];
            const detailRows: Array<{ label: string; value: ReactNode }> = [
              {
                label:
                  templateNamesToDisplay.length === 1
                    ? t("templateFieldTemplateLabelSingular")
                    : t("templateFieldTemplateLabelPlural"),
                value: (
                  <div className="flex flex-wrap gap-1">
                    {templateNamesToDisplay.map((name) => (
                      <Badge
                        key={`${field.id}-template-${name}`}
                        variant="default"
                      >
                        {name}
                      </Badge>
                    ))}
                  </div>
                ),
              },
            ];

            if (field.fieldType) {
              detailRows.push({
                label: t("templateFieldTypeBadgeLabel"),
                value: <span>{field.fieldType}</span>,
              });
            }

            if (field.isRequired) {
              detailRows.push({
                label: t("templateFieldRequiredLabel"),
                value: (
                  <Badge variant="outline">
                    {t("templateFieldRequiredBadge")}
                  </Badge>
                ),
              });
            }

            if (field.isRestricted) {
              detailRows.push({
                label: t("templateFieldRestrictedLabel"),
                value: (
                  <Badge variant="outline">
                    {t("templateFieldRestrictedBadge")}
                  </Badge>
                ),
              });
            }

            if (field.dropdownOptions && field.dropdownOptions.length > 0) {
              detailRows.push({
                label: t("templateFieldOptionsListLabel"),
                value: (
                  <div className="flex flex-wrap gap-1">
                    {field.dropdownOptions.map((option) => {
                      const optionLabel = resolveOptionLabel(option);
                      return (
                        <Badge
                          key={`${field.id}-option-${optionLabel}`}
                          variant="outline"
                        >
                          {optionLabel}
                        </Badge>
                      );
                    })}
                  </div>
                ),
              });
            }

            const missingTarget =
              current.action === "map" &&
              (current.mappedTo === null ||
                current.mappedTo === undefined ||
                !matchedOption);
            const missingCreateDetails =
              current.action === "create" &&
              (trimmedDisplayName.length === 0 ||
                systemNameForValidation.trim().length === 0 ||
                effectiveTypeId === null ||
                effectiveTypeId === undefined);

            const fieldHasIssue =
              missingTarget || isTargetInUse || missingCreateDetails;

            return (
              <TableRow
                className={`border-primary/40 ${
                  fieldHasIssue ? "border-destructive/40 bg-destructive/5" : ""
                }`}
                key={field.id}
              >
                <TableCell className="align-top font-medium">
                  <div className="flex items-start gap-2">
                    {fieldHasIssue ? (
                      <Badge variant="destructive">{sourceDisplay}</Badge>
                    ) : (
                      <span>{sourceDisplay}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top w-full">
                  <div className="space-y-4 text-xs text-muted-foreground">
                    {detailRows.map((row, index) => (
                      <div
                        key={`${field.id}-detail-${index}`}
                        className="flex gap-3 items-baseline"
                      >
                        <span className="font-bold min-w-20 max-w-36">
                          {row.label}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                          {row.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="align-top w-[260px]">
                  <div className="space-y-3 text-xs">
                    <RadioGroup
                      value={current.action}
                      onValueChange={(value) => {
                        let nextConfigForDraft: TestmoTemplateFieldMappingConfig | null =
                          null;
                        onChange(field.id, (prev) => {
                          const action = value as TestmoTemplateFieldAction;
                          if (action === "map") {
                            const candidateOptions =
                              prev.targetType === "result"
                                ? resultTargetOptions
                                : caseTargetOptions;
                            const match = findBestOptionForField(
                              field,
                              candidateOptions,
                              flatTargetOptions,
                              disallowedTargets
                            );
                            const nextConfig: TestmoTemplateFieldMappingConfig =
                              {
                                ...prev,
                                action,
                                mappedTo: match ? Number(match.value) : null,
                              };
                            nextConfigForDraft = nextConfig;
                            return nextConfig;
                          }

                          const matchedFieldTypeOption = findFieldTypeOption(
                            field.fieldType ?? prev.typeName ?? null
                          );

                          const resolvedTypeId =
                            prev.typeId ??
                            (matchedFieldTypeOption
                              ? Number(matchedFieldTypeOption.value)
                              : null);

                          const resolvedTypeName =
                            prev.typeName ??
                            matchedFieldTypeOption?.label ??
                            field.fieldType ??
                            undefined;

                          const generatedSystemName =
                            generateSystemName(displayNameFallback);
                          const normalizedSystemName =
                            field.systemName &&
                            field.systemName.trim().length > 0
                              ? field.systemName
                              : prev.systemName &&
                                  prev.systemName.trim().length > 0
                                ? prev.systemName
                                : generatedSystemName.length > 0
                                  ? generatedSystemName
                                  : `field_${field.id}`;

                          const nextConfig: TestmoTemplateFieldMappingConfig = {
                            ...prev,
                            action,
                            mappedTo: null,
                            displayName:
                              prev.displayName && prev.displayName.length > 0
                                ? prev.displayName
                                : displayNameFallback,
                            systemName: normalizedSystemName,
                            dropdownOptions:
                              field.dropdownOptions ?? prev.dropdownOptions,
                            typeId: resolvedTypeId,
                            typeName: resolvedTypeName,
                          };
                          nextConfigForDraft = nextConfig;
                          return nextConfig;
                        });
                        if (value === "create") {
                          const draftSource =
                            nextConfigForDraft ??
                            ensureTemplateFieldConfig(configuration, field.id, {
                              displayName: displayNameFallback,
                              typeName: resolvedTypeName ?? undefined,
                            });
                          const draft = buildDraftFromConfig({
                            ...draftSource,
                            displayName:
                              draftSource.displayName &&
                              draftSource.displayName.length > 0
                                ? draftSource.displayName
                                : displayNameFallback,
                            typeName:
                              draftSource.typeName ??
                              resolvedTypeName ??
                              undefined,
                          });
                          openFieldEditor(field.id, current.targetType, draft);
                        }
                      }}
                      className="grid gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="map"
                          id={`template-field-${field.id}-action-map`}
                        />
                        <Label
                          htmlFor={`template-field-${field.id}-action-map`}
                        >
                          {t("actionMap")}
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="create"
                          id={`template-field-${field.id}-action-create`}
                        />
                        <Label
                          htmlFor={`template-field-${field.id}-action-create`}
                        >
                          {t("actionCreate")}
                        </Label>
                      </div>
                    </RadioGroup>
                    <Separator />
                    <RadioGroup
                      value={current.targetType}
                      onValueChange={(value) => {
                        let nextConfigForDraft: TestmoTemplateFieldMappingConfig | null =
                          null;
                        onChange(field.id, (prev) => {
                          const target = value as TestmoTemplateFieldTargetType;
                          const candidateOptions =
                            target === "result"
                              ? resultTargetOptions
                              : caseTargetOptions;
                          const defaultOption = findBestOptionForField(
                            field,
                            candidateOptions,
                            flatTargetOptions,
                            disallowedTargets
                          );
                          const nextConfig: TestmoTemplateFieldMappingConfig = {
                            ...prev,
                            targetType: target,
                            mappedTo:
                              prev.action === "map"
                                ? defaultOption
                                  ? Number(defaultOption.value)
                                  : null
                                : null,
                          };
                          nextConfigForDraft = nextConfig;
                          return nextConfig;
                        });
                        if (current.action === "create") {
                          const draftSource =
                            nextConfigForDraft ??
                            ensureTemplateFieldConfig(configuration, field.id, {
                              displayName: summaryDisplayName,
                              targetType:
                                value as TestmoTemplateFieldTargetType,
                              typeName: resolvedTypeName ?? undefined,
                            });
                          const draft = buildDraftFromConfig({
                            ...draftSource,
                            displayName:
                              draftSource.displayName &&
                              draftSource.displayName.length > 0
                                ? draftSource.displayName
                                : summaryDisplayName,
                            typeName:
                              draftSource.typeName ??
                              resolvedTypeName ??
                              undefined,
                          });
                          openFieldEditor(
                            field.id,
                            value as TestmoTemplateFieldTargetType,
                            draft
                          );
                        }
                      }}
                      className="grid gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="case"
                          id={`template-field-${field.id}-target-case`}
                        />
                        <Label
                          htmlFor={`template-field-${field.id}-target-case`}
                        >
                          {t("templateFieldTargetCase")}
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="result"
                          id={`template-field-${field.id}-target-result`}
                        />
                        <Label
                          htmlFor={`template-field-${field.id}-target-result`}
                        >
                          {t("templateFieldTargetResult")}
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </TableCell>
                <TableCell className="align-top space-y-3">
                  {current.action === "map" ? (
                    flatTargetOptions.length > 0 ? (
                      <div className="space-y-1">
                        <Select
                          value={current.mappedTo?.toString() ?? ""}
                          onValueChange={(value) =>
                            onChange(field.id, (prev) => {
                              if (value) {
                                const compositeKey = `${prev.targetType}:${value}`;
                                if (disallowedTargets.has(compositeKey)) {
                                  return prev;
                                }
                              }
                              return {
                                ...prev,
                                mappedTo: value ? Number(value) : null,
                              };
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t("templateFieldSelectPlaceholder")}
                            >
                              {renderTargetOption(
                                flatTargetOptions.find(
                                  (option) =>
                                    option.value ===
                                      current.mappedTo?.toString() &&
                                    option.group === current.targetType
                                )
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {groupedTargetOptions.map((group) => (
                              <SelectGroup key={group.key}>
                                <SelectLabel>{group.label}</SelectLabel>
                                {group.options.map((option) => {
                                  const compositeKey = `${group.key}:${option.value}`;
                                  const isDisabled =
                                    disallowedTargets.has(compositeKey);
                                  return (
                                    <SelectItem
                                      key={`${group.key}-${option.value}`}
                                      value={option.value}
                                      className="pl-6"
                                      disabled={isDisabled}
                                    >
                                      {renderTargetOption(
                                        option,
                                        isDisabled
                                          ? t("templateFieldTargetAlreadyUsed")
                                          : undefined
                                      )}
                                    </SelectItem>
                                  );
                                })}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                        {(() => {
                          if (!field.fieldType) {
                            return null;
                          }
                          const selected = flatTargetOptions.find(
                            (option) =>
                              option.value === current.mappedTo?.toString() &&
                              option.group === current.targetType
                          );
                          if (!selected) {
                            return null;
                          }
                          const fieldTypeNormalized = normalizeFieldTypeName(
                            field.fieldType
                          );
                          const targetTypeNormalized = normalizeFieldTypeName(
                            selected.typeName
                          );
                          if (
                            fieldTypeNormalized &&
                            targetTypeNormalized &&
                            fieldTypeNormalized !== targetTypeNormalized
                          ) {
                            return (
                              <p className="text-xs text-primary font-bold flex items-start">
                                <AlertTriangle className="w-4 h-4 mr-1 inline" />
                                {t("templateFieldTypeMismatchWarning", {
                                  source: field.fieldType,
                                  target: selected.typeName,
                                })}
                              </p>
                            );
                          }
                          return null;
                        })()}
                        {missingTarget && (
                          <p className="text-xs text-destructive flex items-start">
                            <AlertTriangle className="w-4 h-4 mr-1 inline" />
                            {t("templateFieldIssueMissingTarget")}
                          </p>
                        )}
                        {isTargetInUse && (
                          <p className="text-xs text-destructive flex items-start">
                            <AlertTriangle className="w-4 h-4 mr-1 inline" />
                            {t("templateFieldDuplicateTargetWarning")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("templateFieldNoExistingTargets")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div className="space-y-3 rounded-md border border-dashed p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">
                              {t("templateFieldNewFieldSummaryTitle")}
                            </p>
                            <p className="text-muted-foreground">
                              {t("templateFieldNewFieldSummaryDescription")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const draftConfig: TestmoTemplateFieldMappingConfig =
                                {
                                  ...current,
                                  displayName: summaryDisplayName,
                                  typeName:
                                    current.typeName ??
                                    resolvedTypeName ??
                                    undefined,
                                };
                              const draft = buildDraftFromConfig(draftConfig);
                              openFieldEditor(
                                field.id,
                                current.targetType,
                                draft
                              );
                            }}
                          >
                            {current.displayName
                              ? t("templateFieldEditFieldButton")
                              : t("templateFieldConfigureFieldButton")}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {creationSummaryRows.map((row, index) => (
                            <div
                              key={`${field.id}-create-row-${index}`}
                              className="flex items-baseline gap-3"
                            >
                              <span className="font-bold min-w-28 max-w-40 text-muted-foreground">
                                {row.label}
                              </span>
                              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                                {row.value}
                              </div>
                            </div>
                          ))}
                        </div>
                        {current.dropdownOptions &&
                        current.dropdownOptions.length > 0 ? (
                          <div className="space-y-1">
                            <p className="font-medium">
                              {t("templateFieldOptionsListLabel")}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {current.dropdownOptions.map((option, index) => {
                                const optionLabel = resolveOptionLabel(option);
                                return (
                                  <Badge
                                    key={`${field.id}-create-option-${index}-${optionLabel}`}
                                    variant="outline"
                                  >
                                    {optionLabel}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {(!current.displayName || !current.systemName) && (
                        <p className="text-muted-foreground">
                          {t("templateFieldSummaryMissingDetailsHint")}
                        </p>
                      )}
                      {missingCreateDetails && (
                        <p className="text-xs text-destructive flex items-start">
                          <AlertTriangle className="w-4 h-4 mr-1 inline" />
                          {t("templateFieldIssueMissingDetails")}
                        </p>
                      )}
                    </div>
                  )}
                  {current.action === "map" &&
                    matchedOption &&
                    !fieldHasIssue && (
                      <p className="text-xs text-muted-foreground">
                        {t("templateFieldMappedSummary", {
                          name: matchedOption.label,
                          type: matchedOption.typeName,
                        })}
                      </p>
                    )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RoleMappingSection({
  t,
  suggestions,
  roleOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: {
  t: Translator;
  suggestions: TestmoRoleSuggestion[];
  roleOptions: Array<{
    value: string;
    label: string;
    isDefault: boolean;
    permissions: TestmoRolePermissions;
  }>;
  configuration: TestmoMappingConfiguration;
  onChange: (
    roleId: number,
    updater: (current: TestmoRoleMappingConfig) => TestmoRoleMappingConfig
  ) => void;
  description?: string;
  totalCount?: number;
}) {
  const tCommon = useTranslations("common");
  const applicationAreas = useMemo(
    () => Object.values(ApplicationArea) as string[],
    []
  );

  if (suggestions.length === 0) {
    return null;
  }

  const defaultPermissionForArea = (
    permissions: TestmoRolePermissions,
    area: string
  ) => {
    const existing = permissions?.[area];
    if (existing) {
      return existing;
    }
    return {
      canAddEdit: false,
      canDelete: false,
      canClose: false,
    };
  };

  const renderPermissionSummary = (
    permissions: TestmoRolePermissions | undefined
  ) => {
    if (!permissions || Object.keys(permissions).length === 0) {
      return (
        <span className="text-xs text-muted-foreground">
          {t("rolePermissionsEmpty")}
        </span>
      );
    }

    return (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.entries(permissions).map(([area, permission]) => {
          const areaEnum = area as ApplicationArea;
          const showAddEdit = !ADD_EDIT_EXCLUDED_AREAS.has(areaEnum);
          const showDelete = !DELETE_EXCLUDED_AREAS.has(areaEnum);
          const showClose = CLOSE_ALLOWED_AREAS.has(areaEnum);
          const parts: string[] = [];
          if (showAddEdit && permission.canAddEdit) {
            parts.push(t("rolePermissionAddEdit"));
          }
          if (showDelete && permission.canDelete) {
            parts.push(t("rolePermissionDelete"));
          }
          if (showClose && permission.canClose) {
            parts.push(t("rolePermissionClose"));
          }
          return (
            <Badge key={area} variant="outline" className="whitespace-nowrap">
              {`${formatApplicationAreaLabel(area)}: ${
                parts.length > 0 ? parts.join(", ") : t("rolePermissionNone")
              }`}
            </Badge>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">{t("rolesHeading")}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((role) => {
            const current = ensureRoleConfig(configuration, role.id);
            const mappedRole = roleOptions.find(
              (option) => option.value === current.mappedTo?.toString()
            );
            const effectivePermissions =
              current.permissions && Object.keys(current.permissions).length > 0
                ? current.permissions
                : (role.permissions ?? {});

            return (
              <TableRow key={role.id}>
                <TableCell className="font-medium">{role.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {role.isDefault && (
                      <Badge variant="secondary">{t("roleDefaultLabel")}</Badge>
                    )}
                    {renderPermissionSummary(role.permissions)}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(role.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (roleOptions[0]
                                ? Number(roleOptions[0].value)
                                : null))
                            : undefined,
                        name:
                          value === "create"
                            ? (prev.name ?? role.name)
                            : undefined,
                        permissions:
                          value === "create"
                            ? Object.keys(prev.permissions ?? {}).length > 0
                              ? prev.permissions
                              : (role.permissions ?? {})
                            : undefined,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-3">
                  {current.action === "map" ? (
                    roleOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onChange(role.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("roleSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex flex-col">
                                <span>
                                  {option.label}
                                  {option.isDefault &&
                                    ` (${t("roleDefaultLabel")})`}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noRolesAvailable")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("roleNameLabel")}
                        </p>
                        <Input
                          value={current.name ?? role.name}
                          onChange={(event) =>
                            onChange(role.id, (prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={t("roleNamePlaceholder")}
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("rolePermissionsHeading")}
                        </p>
                        <div className="overflow-x-auto">
                          <div className="min-w-[420px]">
                            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,100px)] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                              <span>{t("roleAreaColumn")}</span>
                              <span className="text-center">
                                {t("rolePermissionAddEdit")}
                              </span>
                              <span className="text-center">
                                {t("rolePermissionDelete")}
                              </span>
                              <span className="text-center">
                                {t("rolePermissionClose")}
                              </span>
                            </div>
                            <div className="space-y-2 pt-2">
                              {applicationAreas.map((area) => {
                                const permission = defaultPermissionForArea(
                                  effectivePermissions,
                                  area
                                );
                                const areaEnum = area as ApplicationArea;
                                const showAddEdit =
                                  !ADD_EDIT_EXCLUDED_AREAS.has(areaEnum);
                                const showDelete =
                                  !DELETE_EXCLUDED_AREAS.has(areaEnum);
                                const showClose =
                                  CLOSE_ALLOWED_AREAS.has(areaEnum);
                                return (
                                  <div
                                    key={area}
                                    className="grid grid-cols-[minmax(0,1fr)_repeat(3,100px)] items-center gap-2 text-xs"
                                  >
                                    <span className="font-medium">
                                      {formatApplicationAreaLabel(area)}
                                    </span>
                                    <div className="flex justify-center">
                                      {showAddEdit ? (
                                        <Checkbox
                                          checked={permission.canAddEdit}
                                          onCheckedChange={(checked) =>
                                            onChange(role.id, (prev) => {
                                              const prevPermissions =
                                                prev.permissions ?? {};
                                              const existing =
                                                prevPermissions[area] ??
                                                defaultPermissionForArea(
                                                  effectivePermissions,
                                                  area
                                                );
                                              return {
                                                ...prev,
                                                permissions: {
                                                  ...prevPermissions,
                                                  [area]: {
                                                    ...existing,
                                                    canAddEdit:
                                                      checked === true,
                                                  },
                                                },
                                              };
                                            })
                                          }
                                          aria-label={`${formatApplicationAreaLabel(
                                            area
                                          )} ${t("rolePermissionAddEdit")}`}
                                        />
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {"\u2014"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {showDelete ? (
                                        <Checkbox
                                          checked={permission.canDelete}
                                          onCheckedChange={(checked) =>
                                            onChange(role.id, (prev) => {
                                              const prevPermissions =
                                                prev.permissions ?? {};
                                              const existing =
                                                prevPermissions[area] ??
                                                defaultPermissionForArea(
                                                  effectivePermissions,
                                                  area
                                                );
                                              return {
                                                ...prev,
                                                permissions: {
                                                  ...prevPermissions,
                                                  [area]: {
                                                    ...existing,
                                                    canDelete: checked === true,
                                                  },
                                                },
                                              };
                                            })
                                          }
                                          aria-label={`${formatApplicationAreaLabel(
                                            area
                                          )} ${t("rolePermissionDelete")}`}
                                        />
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {"\u2014"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex justify-center">
                                      {showClose ? (
                                        <Checkbox
                                          checked={permission.canClose}
                                          onCheckedChange={(checked) =>
                                            onChange(role.id, (prev) => {
                                              const prevPermissions =
                                                prev.permissions ?? {};
                                              const existing =
                                                prevPermissions[area] ??
                                                defaultPermissionForArea(
                                                  effectivePermissions,
                                                  area
                                                );
                                              return {
                                                ...prev,
                                                permissions: {
                                                  ...prevPermissions,
                                                  [area]: {
                                                    ...existing,
                                                    canClose: checked === true,
                                                  },
                                                },
                                              };
                                            })
                                          }
                                          aria-label={`${formatApplicationAreaLabel(
                                            area
                                          )} ${t("rolePermissionClose")}`}
                                        />
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {"\u2014"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function MilestoneTypeMappingSection({
  t,
  suggestions,
  milestoneOptions,
  configuration,
  onChange,
  description,
  totalCount,
}: MilestoneTypeSectionProps) {
  const tCommon = useTranslations("common");

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-base font-semibold">
          {t("milestoneTypesHeading")}
        </h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {typeof totalCount === "number" && (
            <Badge variant="outline">
              {t("datasetTotalLabel", { count: totalCount })}
            </Badge>
          )}
          <Badge variant="secondary">{suggestions.length}</Badge>
        </div>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnSource")}</TableHead>
            <TableHead>{t("columnSourceDetails")}</TableHead>
            <TableHead>{t("columnAction")}</TableHead>
            <TableHead>{t("columnTarget")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suggestions.map((milestoneType) => {
            const current = ensureMilestoneTypeConfig(
              configuration,
              milestoneType.id
            );
            const matchedOption = milestoneOptions.find(
              (option) => option.value === current.mappedTo?.toString()
            );
            const iconMissing =
              current.action === "create" && (current.iconId ?? null) === null;

            return (
              <TableRow key={milestoneType.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {milestoneType.iconName ? (
                      <DynamicIcon
                        name={milestoneType.iconName as any}
                        className="h-4 w-4"
                      />
                    ) : null}
                    <span>{milestoneType.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {milestoneType.isDefault && (
                      <Badge variant="secondary">
                        {t("milestoneDefaultLabel")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={current.action}
                    onValueChange={(value) =>
                      onChange(milestoneType.id, (prev) => ({
                        ...prev,
                        action: value as "map" | "create",
                        mappedTo:
                          value === "map"
                            ? (prev.mappedTo ??
                              (milestoneOptions[0]
                                ? Number(milestoneOptions[0].value)
                                : null))
                            : undefined,
                        name:
                          value === "create"
                            ? (prev.name ?? milestoneType.name)
                            : undefined,
                        iconId:
                          value === "create"
                            ? (prev.iconId ?? null)
                            : undefined,
                      }))
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="map">{t("actionMap")}</SelectItem>
                      <SelectItem value="create">
                        {t("actionCreate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="space-y-3">
                  {current.action === "map" ? (
                    milestoneOptions.length > 0 ? (
                      <Select
                        value={current.mappedTo?.toString() ?? ""}
                        onValueChange={(value) =>
                          onChange(milestoneType.id, (prev) => ({
                            ...prev,
                            mappedTo: value ? Number(value) : null,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("milestoneSelectPlaceholder")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {milestoneOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <div className="flex items-center gap-2">
                                {option.iconName ? (
                                  <DynamicIcon
                                    name={option.iconName as any}
                                    className="h-4 w-4"
                                  />
                                ) : null}
                                <span>{option.label}</span>
                                {option.isDefault && (
                                  <Badge variant="outline" className="ml-2">
                                    {t("milestoneDefaultLabel")}
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("noMilestoneTypesAvailable")}
                      </span>
                    )
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.name")}
                        </p>
                        <Input
                          value={current.name ?? milestoneType.name}
                          onChange={(event) =>
                            onChange(milestoneType.id, (prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={t("milestoneNamePlaceholder")}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {tCommon("fields.icon")}
                        </p>
                        <FieldIconPicker
                          initialIconId={current.iconId ?? undefined}
                          onIconSelect={(iconId) =>
                            onChange(milestoneType.id, (prev) => ({
                              ...prev,
                              iconId,
                            }))
                          }
                        />
                        {iconMissing && (
                          <p className="text-xs text-destructive">
                            {t("milestoneIconRequired")}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
