import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LinkIcon } from "lucide-react";
import { Link } from "~/lib/navigation";
import { RepositoryCaseSource } from "@prisma/client";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { cn, type ClassValue } from "~/utils";

export type CaseDisplaySize = "small" | "medium" | "large" | "xl";

interface Case {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  isDeleted?: boolean;
  link?: string;
  size?: CaseDisplaySize;
  className?: ClassValue;
  maxLines?: number;
}

export const CaseDisplay: React.FC<Case> = ({
  id,
  name,
  link,
  size = "medium",
  source,
  isDeleted,
  className,
  maxLines,
}) => {
  if (!id) return null;

  const clampClass = (() => {
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
  })();

  const nameDisplay = (
    <TestCaseNameDisplay
      testCase={{
        id,
        name,
        source,
        isDeleted,
      }}
      showIcon={true}
      className={cn(className, clampClass)}
      size={size}
    />
  );

  const isLargeOrXl = size === "large" || size === "xl";
  const iconSizeClass = size === "xl" ? "w-5 h-5" : "w-4 h-4";

  const content = link ? (
    <Link href={link} className={`flex items-start max-w-full w-full group`}>
      {nameDisplay}
      {isLargeOrXl && (
        <LinkIcon className={`${iconSizeClass} inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0`} />
      )}
    </Link>
  ) : (
    <div
      className={`flex ${isLargeOrXl ? "items-start" : "items-center"} max-w-full w-full`}
    >
      {nameDisplay}
    </div>
  );

  // Show tooltip when className includes line-clamp or when size is small/medium (original behavior)
  const classNameStr = cn(className);
  const hasClampedClass =
    clampClass === "truncate" ||
    clampClass?.includes("line-clamp") ||
    classNameStr.includes("line-clamp") ||
    classNameStr.includes("truncate");
  const shouldShowTooltip = hasClampedClass || !isLargeOrXl;

  return shouldShowTooltip ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="text-left">{content}</div>
        </TooltipTrigger>
        <TooltipContent>
          <div>{name}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    content
  );
};
