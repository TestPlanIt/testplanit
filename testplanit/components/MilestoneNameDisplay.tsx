import React from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";

interface MilestoneNameDisplayProps {
  milestone: {
    id: number | string;
    name: string;
    milestoneTypeIconName?: string;
    isDeleted?: boolean;
  };
  showIcon?: boolean;
  fallbackPrefix?: string;
}

export function MilestoneNameDisplay({
  milestone,
  showIcon = true,
  fallbackPrefix = "Milestone",
}: MilestoneNameDisplayProps) {
  const t = useTranslations("common.labels");

  // Extract the values
  const name = milestone.name;
  const id = milestone.id;
  const isDeleted = milestone.isDeleted || false;
  const iconName = milestone.milestoneTypeIconName;

  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (isDeleted) {
      icon = <Trash2 className="h-4 w-4 shrink-0 mt-1" />;
    } else {
      icon = (
        <DynamicIcon
          name={(iconName as IconName) || "milestone"}
          className="h-4 w-4 shrink-0 mt-1"
        />
      );
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  return (
    <span className="flex items-start gap-1">
      {icon}
      {displayName}
    </span>
  );
}
