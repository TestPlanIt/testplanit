import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RepositoryCaseSource } from "~/zenstack/models";
import { ExternalLink, LinkIcon } from "lucide-react";
import React, { type ReactNode } from "react";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";

export type CaseDisplaySize = "small" | "medium" | "large" | "xl";

interface Case {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  automated?: boolean;
  isDeleted?: boolean;
  /** When true, the type icon gains a `{}` corner badge. Source: RepositoryCases.hasParameters. */
  hasParameters?: boolean;
  link?: string;
  linkTarget?: "_blank" | "_self";
  size?: CaseDisplaySize;
  className?: ClassValue;
  maxLines?: number;
  /** Optional custom rendering for the name (e.g. a word-level diff). */
  nameNode?: ReactNode;
}

export const CaseDisplay: React.FC<Case> = ({
  id,
  name,
  link,
  size = "medium",
  source,
  automated,
  isDeleted,
  hasParameters,
  linkTarget,
  className,
  maxLines,
  nameNode,
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
        automated,
        isDeleted,
        hasParameters,
      }}
      showIcon={true}
      className={cn(className, clampClass)}
      size={size}
      nameNode={nameNode}
    />
  );

  const isLargeOrXl = size === "large" || size === "xl";
  const iconSizeClass = size === "xl" ? "w-5 h-5" : "w-4 h-4";

  const content = link ? (
    <Link
      href={link}
      target={linkTarget}
      className={`flex items-center max-w-full w-full group`}
    >
      {nameDisplay}
      {linkTarget === "_blank" ? (
        <ExternalLink
          className={`${iconSizeClass} inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0`}
        />
      ) : isLargeOrXl ? (
        <LinkIcon
          className={`${iconSizeClass} inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0`}
        />
      ) : null}
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
    <Tooltip>
      <TooltipTrigger asChild>
        {/* min-w-0 so the trigger can shrink inside a flex parent — without it
            the name overflows its column and runs into whatever sits beside it. */}
        <div className="text-start min-w-0">{content}</div>
      </TooltipTrigger>
      <TooltipContent>
        <div>{name}</div>
      </TooltipContent>
    </Tooltip>
  ) : (
    content
  );
};
