import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tag } from "lucide-react";
import { Link } from "~/lib/navigation";

interface Tags {
  id: string | number;
  name: string;
  link?: string;
  size?: "small" | "large";
}

export const TagsDisplay: React.FC<Tags> = ({
  id,
  name,
  link,
  size = "small",
}) => {
  if (!id || !name) {
    return null;
  }

  const tagClassName =
    size === "large" ? "w-5 h-5 shrink-0 mr-1" : "w-4 h-4 shrink-0 mr-1";
  const textClassName =
    size === "large"
      ? "overflow-hidden truncate max-w-xs text-base flex items-center"
      : "overflow-hidden truncate max-w-xl flex items-center";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="cursor-default">
          <div className="flex items-center max-w-full">
            <Badge key={id} className="mr-1 mb-1">
              {link ? (
                <Link href={link} className={textClassName}>
                  <Tag className={tagClassName} />
                  <span className="truncate">{name}</span>
                </Link>
              ) : (
                <div className="flex items-center mr-1">
                  <Tag className={tagClassName} />
                  <span className={textClassName}>{name}</span>
                </div>
              )}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div>{name}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
