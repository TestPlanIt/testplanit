import DynamicIcon from "@/components/DynamicIcon";
import { MilestoneSourceIcon } from "@/components/MilestoneSourceIcon";
import { LinkIcon } from "lucide-react";
import { Link } from "~/lib/navigation";
import { IconName } from "~/types/globals";

interface MilestoneIconAndNameProps {
  milestone: {
    id: number;
    name: string;
    milestoneType: {
      icon?: {
        name: string;
      } | null;
    };
    // Tracker-linkage fields (optional — callers with narrower selections
    // simply don't show the source icon).
    integrationId?: number | null;
    externalKind?: string | null;
    detachedAt?: Date | string | null;
  };
  projectId?: number;
  /** Set false where the full MilestoneSourceBadge renders adjacently
   *  (milestone list cards) to avoid a duplicate tracker glyph. */
  showSourceIcon?: boolean;
}

export const MilestoneIconAndName: React.FC<MilestoneIconAndNameProps> = ({
  milestone,
  projectId,
  showSourceIcon = true,
}) => {
  // Determine the appropriate link based on whether projectId is provided
  const href = projectId
    ? `/projects/milestones/${projectId}/${milestone.id}`
    : `/milestone/${milestone.id}`;

  return (
    <Link href={href} className="group max-w-full min-w-0 overflow-hidden">
      <span className="flex items-center gap-1 min-w-0">
        <DynamicIcon
          name={
            (milestone.milestoneType?.icon?.name as IconName) || "milestone"
          }
          className="w-6 h-6 shrink-0"
        />
        <span className="truncate">{milestone.name}</span>
        {showSourceIcon && <MilestoneSourceIcon milestone={milestone} />}
        <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </span>
    </Link>
  );
};
