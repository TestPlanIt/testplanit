import React from "react";
import { Link } from "~/lib/navigation";
import DynamicIcon from "@/components/DynamicIcon";
import { LinkIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "~/utils";

interface SessionDisplayProps {
  id: number;
  name: string;
  link: string;
  large?: boolean;
  maxLines?: number;
  className?: string;
  isCompleted?: boolean;
}

const clampClassForLines = (maxLines?: number) => {
  if (!maxLines || maxLines <= 0) return undefined;
  if (maxLines === 1) return "truncate";
  switch (maxLines) {
    case 2:
      return "line-clamp-2";
    case 3:
      return "line-clamp-3";
    case 4:
      return "line-clamp-4";
    case 5:
      return "line-clamp-5";
    case 6:
      return "line-clamp-6";
    default:
      return "line-clamp-6";
  }
};

export const SessionTableDisplay: React.FC<SessionDisplayProps> = ({
  id,
  name,
  link,
  large,
  maxLines,
  className,
  isCompleted,
}) => {
  if (!id) return null;

  const clampClass = clampClassForLines(maxLines);
  const textClass = cn(
    "text-left",
    clampClass ?? (!large ? "truncate" : undefined),
    className
  );

  const hasClampedClass =
    clampClass === "truncate" ||
    clampClass?.includes("line-clamp") ||
    className?.includes("line-clamp") ||
    className?.includes("truncate");

  const shouldShowTooltip = hasClampedClass || !large;

  const content = (
    <Link
      href={link}
      className={cn(
        "flex items-start gap-1 hover:text-primary group min-w-0 overflow-hidden",
        isCompleted ? "text-muted-foreground/80" : undefined
      )}
    >
      <DynamicIcon name="compass" className="h-4 w-4 shrink-0 mt-0.5" />
      <span className={cn("flex-1 min-w-0", textClass)}>{name}</span>
      {large && (
        <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </Link>
  );

  if (!shouldShowTooltip) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <span>{name}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
