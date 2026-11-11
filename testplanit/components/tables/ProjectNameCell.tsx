import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LinkIcon } from "lucide-react";
import React from "react";
import { Link } from "~/lib/navigation";

interface ProjectNameCellProps {
  value: string;
  projectId: number;
  note?: string | null;
  size?: "sm" | "md";
}

export const ProjectNameCell: React.FC<ProjectNameCellProps> = ({
  value,
  projectId,
  note,
  size = "md",
}) => {
  return (
    <div
      className={`font-semibold text-pretty ${size === "md" ? "text-lg" : "text-sm"} overflow-hidden`}
    >
      <Link
        className="group flex items-center truncate"
        href={`/projects/overview/${projectId}`}
      >
        <Tooltip>
          <TooltipTrigger type="button" className="block truncate text-start">
            <span className="truncate">{value}</span>
          </TooltipTrigger>
          <TooltipContent align="start">
            <div>{value}</div>
          </TooltipContent>
        </Tooltip>
        <LinkIcon className="ms-1 inline h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
      {note && (
        <div
          className={`${size === "md" ? "text-sm" : "text-xs"} truncate font-extralight text-foreground`}
        >
          {note}
        </div>
      )}
    </div>
  );
};
