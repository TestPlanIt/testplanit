import React from "react";
import { Link } from "~/lib/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectIcon } from "@/components/ProjectIcon";
import { type ClassValue } from "~/utils";

interface ProjectNameDisplayProps {
  projectName: string;
  projectId: number;
  iconUrl?: string | null;
  className?: ClassValue;
  showLink?: boolean;
}

export const ProjectNameDisplay: React.FC<ProjectNameDisplayProps> = ({
  projectName,
  projectId,
  iconUrl,
  className = "text-sm",
  showLink = false,
}) => {
  const content = (
    <span className="flex items-center gap-1">
      <ProjectIcon iconUrl={iconUrl} width={16} height={16} />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger className="text-left truncate max-w-[200px] inline-block">
            {projectName}
          </TooltipTrigger>
          <TooltipContent>
            <div>{projectName}</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );

  if (showLink) {
    return (
      <Link
        className={`hover:underline inline-flex items-center ${className}`}
        href={`/projects/overview/${projectId}`}
      >
        {content}
      </Link>
    );
  }

  return <span className={`inline-flex items-center ${className}`}>{content}</span>;
};