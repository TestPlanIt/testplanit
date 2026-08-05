import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tag } from "lucide-react";
import React from "react";
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
    size === "large" ? "w-5 h-5 shrink-0 me-1" : "w-4 h-4 shrink-0 me-1";
  const textClassName =
    size === "large"
      ? "overflow-hidden truncate max-w-xs text-base flex items-center"
      : "overflow-hidden truncate max-w-xl flex items-center";

  const badge = (
    <div className="flex items-center max-w-full">
      <Badge key={id} className="me-1 mb-1">
        {link ? (
          <span className={textClassName}>
            <Tag className={tagClassName} />
            <span className="truncate">{name}</span>
          </span>
        ) : (
          <div className="flex items-center me-1">
            <Tag className={tagClassName} />
            <span className={textClassName}>{name}</span>
          </div>
        )}
      </Badge>
    </div>
  );

  return (
    <Tooltip>
      {/* 4.1.2 nested-interactive / 2.5.8 Target Size: a link inside the
          trigger button nested two controls and left the outer one barely
          clickable, so a linked tag makes the link itself the trigger. An
          unlinked tag is inert and still needs the button to stay focusable.
          `cursor-default` is kept either way so the cursor is unchanged. */}
      {link ? (
        <TooltipTrigger asChild>
          <Link href={link} className="cursor-default">
            {badge}
          </Link>
        </TooltipTrigger>
      ) : (
        <TooltipTrigger type="button" className="cursor-default">
          {badge}
        </TooltipTrigger>
      )}
      <TooltipContent>
        <div>{name}</div>
      </TooltipContent>
    </Tooltip>
  );
};
