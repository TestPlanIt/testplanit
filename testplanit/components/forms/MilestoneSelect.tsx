import DynamicIcon from "@/components/DynamicIcon";
import { MilestoneSourceIcon } from "@/components/MilestoneSourceIcon";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { useTranslations } from "next-intl";
import React from "react";
import { IconName } from "~/types/globals";

// Utility function to transform milestones into milestonesOptions
export const transformMilestones = (
  milestones: {
    id: number;
    name: string;
    milestoneType?: {
      icon?: { name: string } | null;
    };
    parentId: number | null;
    // Tracker-linkage fields (optional — options without them just don't
    // show the source icon).
    integrationId?: number | null;
    externalKind?: string | null;
    detachedAt?: Date | string | null;
  }[]
) => {
  return (
    milestones?.map((milestone) => ({
      value: milestone.id.toString(),
      label: milestone.name,
      milestoneType: {
        icon: milestone.milestoneType?.icon
          ? { name: milestone.milestoneType.icon.name as IconName }
          : null,
      },
      parentId: milestone.parentId,
      integrationId: milestone.integrationId,
      externalKind: milestone.externalKind,
      detachedAt: milestone.detachedAt,
    })) || []
  );
};

interface MilestoneSelectOption {
  value: string;
  label: string;
  milestoneType?: {
    icon?: { name?: IconName } | null;
  };
  parentId: number | null;
  integrationId?: number | null;
  externalKind?: string | null;
  detachedAt?: Date | string | null;
  /** Nesting depth while browsing the tree; absent/0 for search results and
   *  the trigger's selected-value rendering. */
  level?: number;
}

export interface MilestoneSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null | undefined) => void;
  milestones: MilestoneSelectOption[];
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Depth-first flatten preserving the parent → children ordering the old
 * recursive <SelectItem> render produced, with the nesting level kept for
 * indentation while browsing.
 */
const flattenMilestoneTree = (
  milestones: MilestoneSelectOption[],
  parentId: number | null = null,
  level: number = 0
): MilestoneSelectOption[] => {
  return milestones
    .filter((milestone) => milestone.parentId === parentId)
    .flatMap((milestone) => [
      { ...milestone, level },
      ...flattenMilestoneTree(milestones, parseInt(milestone.value), level + 1),
    ]);
};

const MilestoneOptionContent = ({
  milestone,
}: {
  milestone: MilestoneSelectOption;
}) => (
  <div
    className="flex min-w-0 items-center gap-1"
    style={
      milestone.level
        ? { paddingInlineStart: `${milestone.level * 20}px` }
        : undefined
    }
  >
    {milestone.milestoneType?.icon?.name && (
      <DynamicIcon
        className="w-4 h-4 shrink-0"
        name={milestone.milestoneType.icon.name as IconName}
      />
    )}
    <span className="truncate">{milestone.label}</span>
    <MilestoneSourceIcon milestone={milestone} />
  </div>
);

/**
 * Searchable milestone picker — a thin wrapper over the shared
 * `AsyncCombobox`, fed by a LOCAL option source (the callers all have the
 * full, small milestone list in memory): `fetchOptions` filters the
 * flattened tree by the typed query and ignores paging. Browsing (empty
 * query) keeps the parent → child indentation; an active search renders
 * matches flat, since a child whose parent didn't match would indent under
 * nothing. The external API is unchanged from the old Radix Select version.
 */
export const MilestoneSelect: React.FC<MilestoneSelectProps> = ({
  value,
  onChange,
  milestones,
  isLoading = false,
  placeholder: _placeholder = "Select Milestone",
  disabled = false,
}) => {
  const tCommon = useTranslations("common");

  const flattened = React.useMemo(
    () => flattenMilestoneTree(milestones),
    [milestones]
  );

  const fetchOptions = React.useCallback(
    async (query: string): Promise<MilestoneSelectOption[]> => {
      const q = query.trim().toLowerCase();
      if (!q) return flattened;
      return flattened
        .filter((m) => m.label.toLowerCase().includes(q))
        .map((m) => ({ ...m, level: 0 }));
    },
    [flattened]
  );

  const selectedValue =
    value !== null && value !== undefined ? value.toString() : null;
  const selected = selectedValue
    ? (milestones.find((m) => m.value === selectedValue) ?? null)
    : null;

  return (
    <AsyncCombobox<MilestoneSelectOption>
      value={selected}
      onValueChange={(option) => onChange(option ? option.value : null)}
      fetchOptions={fetchOptions}
      renderOption={(option) => <MilestoneOptionContent milestone={option} />}
      getOptionValue={(option) => option.value}
      placeholder={tCommon("placeholders.selectMilestone")}
      disabled={disabled || isLoading || !milestones || milestones.length === 0}
      className="w-full justify-between bg-transparent font-normal hover:bg-muted"
      showUnassigned
      unassignedLabel={tCommon("access.none")}
      unassignedIcon={<React.Fragment />}
      showPagination={false}
      minDropdownWidth={200}
      pageSize={10000}
    />
  );
};
