import DynamicIcon from "@/components/DynamicIcon";
import { MilestoneSourceIcon } from "@/components/MilestoneSourceIcon";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export interface MilestoneSelectProps {
  value: string | number | null | undefined;
  onChange: (value: string | number | null | undefined) => void;
  milestones: {
    value: string;
    label: string;
    milestoneType?: {
      icon?: { name?: IconName } | null;
    };
    parentId: number | null;
    integrationId?: number | null;
    externalKind?: string | null;
    detachedAt?: Date | string | null;
  }[];
  isLoading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

const renderMilestoneOptions = (
  milestones: {
    value: string;
    label: string;
    milestoneType?: {
      icon?: { name?: IconName } | null;
    };
    parentId: number | null;
    integrationId?: number | null;
    externalKind?: string | null;
    detachedAt?: Date | string | null;
  }[],
  parentId: number | null = null,
  level: number = 0
): React.ReactElement[] => {
  return milestones
    .filter((milestone) => milestone.parentId === parentId)
    .map((milestone) => (
      <React.Fragment key={milestone.value}>
        <SelectItem
          value={milestone.value}
          style={{ paddingInlineStart: `${level * 20}px` }}
        >
          <div className="flex items-center gap-1">
            {milestone.milestoneType?.icon?.name && (
              <DynamicIcon
                className="w-4 h-4 shrink-0"
                name={milestone.milestoneType.icon.name as IconName}
              />
            )}
            {milestone.label}
            <MilestoneSourceIcon milestone={milestone} />
          </div>
        </SelectItem>
        {renderMilestoneOptions(
          milestones,
          parseInt(milestone.value),
          level + 1
        )}
      </React.Fragment>
    ));
};

export const MilestoneSelect: React.FC<MilestoneSelectProps> = ({
  value,
  onChange,
  milestones,
  isLoading = false,
  placeholder: _placeholder = "Select Milestone",
  disabled = false,
}) => {
  const tCommon = useTranslations("common");

  return (
    <Select
      onValueChange={(val) => onChange(val === "none" ? null : val)}
      value={value ? value.toString() : "none"}
      disabled={disabled || isLoading || !milestones || milestones.length === 0}
    >
      <SelectTrigger>
        <SelectValue placeholder={tCommon("placeholders.selectMilestone")} />
      </SelectTrigger>
      <SelectContent>
        {isLoading ? (
          <SelectItem value="loading">{tCommon("loading")}</SelectItem>
        ) : (
          <SelectGroup>
            <SelectItem value="none">{tCommon("access.none")}</SelectItem>
            {renderMilestoneOptions(milestones)}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
};
