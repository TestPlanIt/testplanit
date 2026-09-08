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
      className={`text-pretty font-semibold ${size === "md" ? "text-lg" : "text-sm"} overflow-hidden`}
    >
      <Link
        className="flex items-center truncate group"
        href={`/projects/overview/${projectId}`}
      >
        <Tooltip>
          <TooltipTrigger type="button" className="text-start block truncate">
            <span className="truncate">{value}</span>
          </TooltipTrigger>
          <TooltipContent align="start">
            <div>{value}</div>
          </TooltipContent>
        </Tooltip>
        <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </Link>
      {note && (
        <div
          className={`${size === "md" ? "text-sm" : "text-xs"} text-foreground font-extralight truncate`}
        >
          {note}
        </div>
      )}
    </div>
  );
};
