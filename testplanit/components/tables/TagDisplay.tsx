import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tag } from "lucide-react";
import React from "react";
import { Link } from "~/lib/navigation";

/** Longer than the app-wide 300ms: the tooltip only repeats the tag name, so
 *  it is worth reading solely when the name is truncated. */
const TAG_TOOLTIP_DELAY_MS = 800;

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

  return (
    <TooltipProvider
      delayDuration={TAG_TOOLTIP_DELAY_MS}
      // Radix otherwise reopens with no delay for a while after the first
      // tooltip, so sweeping across a row of tags fires them one after another.
      skipDelayDuration={0}
    >
      <Tooltip>
        <TooltipTrigger type="button" className="cursor-default">
          <div className="flex items-center max-w-full">
            <Badge
              key={id}
              className={
                link
                  ? "me-1 mb-1 hover:bg-primary/20 hover:text-primary"
                  : "me-1 mb-1"
              }
            >
              {link ? (
                // `hover:text-primary` on the anchor itself: the global
                // `body a:hover` rule greys link text, which is unreadable
                // against the badge.
                <Link
                  href={link}
                  className={`${textClassName} hover:text-primary`}
                >
                  <Tag className={tagClassName} />
                  <span className="truncate">{name}</span>
                </Link>
              ) : (
                <div className="flex items-center me-1">
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
