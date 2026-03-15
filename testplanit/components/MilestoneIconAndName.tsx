import DynamicIcon from "@/components/DynamicIcon";
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
  };
  projectId?: number;
}

export const MilestoneIconAndName: React.FC<MilestoneIconAndNameProps> = ({
  milestone,
  projectId,
}) => {
  // Determine the appropriate link based on whether projectId is provided
  const href = projectId
    ? `/projects/milestones/${projectId}/${milestone.id}`
    : `/milestone/${milestone.id}`;

  return (
    <Link href={href} className="group max-w-full min-w-0 overflow-hidden">
      <span className="flex items-center gap-1 min-w-0">
        <DynamicIcon
          name={(milestone.milestoneType?.icon?.name as IconName) || "milestone"}
          className="w-6 h-6 shrink-0"
        />
        <span className="truncate">{milestone.name}</span>
        <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </span>
    </Link>
  );
};
