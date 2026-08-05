import {
  ASSIGNED_TO_UNASSIGNED_SENTINEL,
  STATUS_UNTESTED_SENTINEL,
  type FilterDimension,
} from "~/lib/repository/filterDimensions";

/**
 * View-options-derived value lists for the FilterBar. Mirrors the shape the
 * view-options route returns (and ProjectRepository's ViewOptions memo
 * produces) structurally, so the bar stays decoupled from the page component.
 */

export interface FilterValueOption {
  id: string | number;
  name: string;
  count?: number;
  icon?: { name: string } | null;
  iconColor?: { value: string } | null;
  color?: { value: string } | null;
}

export interface FilterBarViewOptions {
  templates?: Array<{ id: number; name: string; count?: number }>;
  states?: Array<{
    id: number;
    name: string;
    count?: number;
    icon?: { name: string } | null;
    iconColor?: { value: string } | null;
  }>;
  creators?: Array<{ id: string; name: string; count?: number }>;
  automated?: Array<{ value: boolean; count: number }>;
  parameterized?: Array<{ value: boolean; count: number }>;
  attachments?: Array<{ value: boolean; count: number }>;
  dynamicFields?: Record<
    string,
    {
      type: string;
      fieldId: number;
      options?: Array<{
        id: number;
        name: string;
        icon?: { name: string } | null;
        iconColor?: { value: string } | null;
        count?: number;
      }>;
      counts?: { hasValue: number; noValue: number };
    }
  >;
  tags?: Array<{ id: number | string; name: string; count?: number }>;
  issues?: Array<{ id: number | string; name: string; count?: number }>;
  testRunOptions?: {
    statuses: Array<{
      id: number;
      name: string;
      color?: { value: string };
      count: number;
    }>;
    assignedTo: Array<{ id: string; name: string; count: number }>;
    untestedCount: number;
    unassignedCount: number;
    totalCount: number;
  };
}

const UNTESTED_COLOR = "#B1B2B3";

function booleanOptions(
  entries: Array<{ value: boolean; count: number }> | undefined,
  t: (key: string) => string,
  trueKey: string,
  falseKey: string
): FilterValueOption[] {
  const countFor = (value: boolean) =>
    entries?.find((entry) => entry.value === value)?.count;
  return [
    { id: 1, name: t(trueKey), count: countFor(true) },
    { id: 0, name: t(falseKey), count: countFor(false) },
  ];
}

/**
 * Selectable values for one dimension, hydrated from the view-options
 * payload. Ids missing from the payload (cold reload before it resolves)
 * simply render raw in the chip and upgrade in place when it arrives.
 */
export function getDimensionValueOptions(
  dimension: FilterDimension,
  viewOptions: FilterBarViewOptions | undefined,
  t: (key: string) => string
): FilterValueOption[] {
  switch (dimension.key) {
    case "templates":
      return viewOptions?.templates ?? [];
    case "states":
      return viewOptions?.states ?? [];
    case "creators":
      return viewOptions?.creators ?? [];
    case "automated":
      return booleanOptions(
        viewOptions?.automated,
        t,
        "common.fields.automated",
        "common.fields.notAutomated"
      );
    case "parameterized":
      return booleanOptions(
        viewOptions?.parameterized,
        t,
        "common.fields.parameterized",
        "common.fields.notParameterized"
      );
    case "attachments":
      return booleanOptions(
        viewOptions?.attachments,
        t,
        "common.fields.hasAttachments",
        "common.fields.noAttachments"
      );
    case "tags":
      // The tags/issues payloads ship "any"/"none" pseudo-rows for the
      // ViewSelector; the FilterBar expresses those as operators instead.
      return (viewOptions?.tags ?? []).filter(
        (tag) => tag.id !== "any" && tag.id !== "none"
      );
    case "issues":
      return (viewOptions?.issues ?? []).filter(
        (issue) => issue.id !== "any" && issue.id !== "none"
      );
    case "status": {
      const runOptions = viewOptions?.testRunOptions;
      return [
        {
          id: STATUS_UNTESTED_SENTINEL,
          name: t("common.labels.untested"),
          color: { value: UNTESTED_COLOR },
          count: runOptions?.untestedCount,
        },
        ...(runOptions?.statuses ?? []),
      ];
    }
    case "assignedTo": {
      const runOptions = viewOptions?.testRunOptions;
      return [
        {
          id: ASSIGNED_TO_UNASSIGNED_SENTINEL,
          name: t("common.labels.unassigned"),
          count: runOptions?.unassignedCount,
        },
        ...(runOptions?.assignedTo ?? []),
      ];
    }
    default:
      break;
  }

  if (dimension.fieldId === undefined) return [];
  const field = Object.values(viewOptions?.dynamicFields ?? {}).find(
    (candidate) => candidate.fieldId === dimension.fieldId
  );
  if (!field) return [];
  if (dimension.valueType === "boolean") {
    return [
      {
        id: 1,
        name: t("common.fields.checked"),
        count: field.counts?.hasValue,
      },
      {
        id: 0,
        name: t("repository.fields.unchecked"),
        count: field.counts?.noValue,
      },
    ];
  }
  if (dimension.valueType === "options") {
    return field.options ?? [];
  }
  return [];
}
