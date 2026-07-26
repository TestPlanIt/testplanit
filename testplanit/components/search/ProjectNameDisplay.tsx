import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import React from "react";
import { Link } from "~/lib/navigation";
import { type ClassValue } from "~/utils";

interface ProjectNameDisplayProps {
  projectName: string;
  projectId: number;
  iconUrl?: string | null;
  className?: ClassValue;
  showLink?: boolean;
  /**
   * Truncate against the container instead of the default 200px cap. For table
   * cells, where the column width is the only correct bound. Off elsewhere: in
   * a flex row of search metadata the name has no width of its own and would
   * collapse to a few characters.
   */
  fitContainer?: boolean;
}

export const ProjectNameDisplay: React.FC<ProjectNameDisplayProps> = ({
  projectName,
  projectId,
  iconUrl,
  className = "text-sm",
  showLink = false,
  fitContainer = false,
}) => {
  const shrink = fitContainer ? "min-w-0 max-w-full" : "";

  const content = (
    <span className={`flex items-center gap-1 ${shrink}`}>
      <span className="shrink-0">
        <ProjectIcon iconUrl={iconUrl} width={16} height={16} />
      </span>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className={`text-start truncate inline-block ${
            fitContainer ? "min-w-0 max-w-full" : "max-w-[200px]"
          }`}
        >
          {projectName}
        </TooltipTrigger>
        <TooltipContent>
          <div>{projectName}</div>
        </TooltipContent>
      </Tooltip>
    </span>
  );

  if (showLink) {
    return (
      <Link
        className={`hover:underline inline-flex items-center ${shrink} ${className}`}
        href={`/projects/overview/${projectId}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <span className={`inline-flex items-center ${shrink} ${className}`}>
      {content}
    </span>
  );
};
