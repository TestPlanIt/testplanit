import React from "react";
import { Link } from "~/lib/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LinkIcon } from "lucide-react";

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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="text-left block truncate">
              <span className="truncate">{value}</span>
            </TooltipTrigger>
            <TooltipContent align="start">
              <div>{value}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </Link>
      {note && (
        <div className="text-sm text-foreground font-extralight">{note}</div>
      )}
    </div>
  );
};
