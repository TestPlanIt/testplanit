import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  ExternalLink,
  LinkIcon,
  ListChecks,
  SquareStack,
  Trash,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { type ReactNode } from "react";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import type { RepositoryCaseSource } from "~/zenstack/models";

export type CaseDisplaySize = "small" | "medium" | "large" | "xl";

const iconSizeClasses: Record<CaseDisplaySize, string> = {
  small: "h-3 w-3",
  medium: "h-4 w-4",
  large: "h-4 w-4",
  xl: "h-6 w-6",
};

/**
 * A case as it arrives from a query — either with its fields at the root or
 * wrapped in a `repositoryCase` relation, so a raw row can be handed over
 * without being unpacked first.
 */
export interface CaseDisplayCase {
  id?: number | string;
  name?: string;
  source?: RepositoryCaseSource | string;
  automated?: boolean;
  isDeleted?: boolean;
  hasParameters?: boolean;
  repositoryCase?: {
    id?: number | string;
    name?: string;
    source?: RepositoryCaseSource | string;
    automated?: boolean;
    isDeleted?: boolean;
    hasParameters?: boolean;
  } | null;
}

interface CaseDisplayProps extends CaseDisplayCase {
  /** A whole row, when the caller has one. Spelled-out props win over it. */
  testCase?: CaseDisplayCase | null;
  /** Explicit destination. */
  link?: string;
  /**
   * With an id and no explicit `link`, the name links to the case in this
   * project's repository.
   */
  projectId?: number | string;
  linkTarget?: "_blank" | "_self";
  showIcon?: boolean;
  /** Stands in for a missing name, as "{prefix} {id}". */
  fallbackPrefix?: string;
  size?: CaseDisplaySize;
  className?: ClassValue;
  maxLines?: number;
  /** Optional custom rendering for the name (e.g. a word-level diff). */
  nameNode?: ReactNode;
}

/**
 * A test case's name with its type icon, optionally linked.
 *
 * The single case-name component: it draws the manual / automated / deleted
 * icons, the parameterized badge, the clamp and its tooltip, and resolves the
 * destination from either a caller-supplied `link` or a `projectId`. Anything
 * showing a case name goes through here so the same case reads the same way on
 * every surface.
 */
export const CaseDisplay: React.FC<CaseDisplayProps> = ({
  testCase,
  id,
  name,
  source,
  automated,
  isDeleted,
  hasParameters,
  link,
  projectId,
  linkTarget,
  showIcon = true,
  fallbackPrefix = "Case",
  size = "medium",
  className,
  maxLines,
  nameNode,
}) => {
  const t = useTranslations("common.labels");
  const tParams = useTranslations("parameters");

  const row = testCase?.repositoryCase ?? testCase;
  const resolvedId = id ?? testCase?.id ?? row?.id;
  const resolvedName = name ?? testCase?.name ?? row?.name;
  const resolvedSource = source ?? testCase?.source ?? row?.source ?? "MANUAL";
  const resolvedAutomated =
    automated ?? testCase?.automated ?? row?.automated ?? false;
  const resolvedIsDeleted =
    isDeleted ?? testCase?.isDeleted ?? row?.isDeleted ?? false;
  const resolvedHasParameters =
    hasParameters ?? testCase?.hasParameters ?? row?.hasParameters ?? false;

  // The two components this one absorbed disagreed about the empty case, and
  // both answers are still in use: a caller spelling out fields renders
  // nothing without an id (a report row whose case is absent draws a blank
  // cell), while a caller handing over a row renders the "unknown" label (the
  // drill-down passes `id: … || 0`, and a placeholder is what that cell has
  // always shown). Which one applies is decided by how the caller asked.
  const passedRow = testCase !== undefined;
  if (!passedRow && !resolvedId) {
    return null;
  }
  if (passedRow && !testCase) {
    return <span>{t("unknown")}</span>;
  }

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

  // Soft-deleted wins over everything (the row is being represented as gone);
  // for live cases, the manual or automated type icon, with the stacked-squares
  // mark beside it when the case has parameterized steps. That mark is the same
  // one the Tiptap toolbar's InsertParameterToolbarButton uses, so the glyph is
  // already associated with "parameter".
  const iconSize = iconSizeClasses[size];
  let icon = null;
  if (showIcon) {
    if (resolvedIsDeleted) {
      icon = (
        <Trash
          className={cn("shrink-0 mt-0.5 text-muted-foreground", iconSize)}
        />
      );
    } else {
      const baseIcon =
        resolvedAutomated || isAutomatedCaseSource(resolvedSource) ? (
          <Bot className={cn("shrink-0", iconSize)} />
        ) : (
          <ListChecks className={cn("shrink-0", iconSize)} />
        );
      icon = (
        <span className="inline-flex items-center gap-1 shrink-0 mt-0.5">
          {baseIcon}
          {resolvedHasParameters && (
            <span
              title={tParams("hasParametersBadgeTooltip")}
              aria-label={tParams("hasParametersBadgeTooltip")}
              className="inline-flex shrink-0"
            >
              <SquareStack
                data-testid="has-parameters-badge"
                aria-hidden="true"
                className={cn("shrink-0 text-primary", iconSize)}
              />
            </span>
          )}
        </span>
      );
    }
  }

  const displayName =
    resolvedName ||
    (resolvedId ? `${fallbackPrefix} ${resolvedId}` : t("unknown"));

  const nameAndIcon = (
    <div className="flex items-start gap-1 min-w-0">
      {icon}
      <span
        className={cn(
          "min-w-0",
          resolvedIsDeleted && "text-muted-foreground line-through",
          className,
          clampClass
        )}
      >
        {nameNode ?? displayName}
      </span>
    </div>
  );

  const href =
    link ??
    (projectId && resolvedId
      ? `/projects/repository/${projectId}/${resolvedId}`
      : undefined);

  // A caller handing over a whole row gets the tighter shape: the destination
  // IS the wrapper, and there is no tooltip or hover affordance. A caller
  // spelling out fields gets the roomier one below, where the wrapper is a
  // full-width row that can also hold the hover icon. The two shapes come from
  // the two components merged here and are kept apart deliberately -- calling
  // sites are laid out around the box each one produces.
  if (passedRow) {
    return href ? (
      <Link
        href={href}
        className="flex items-start gap-1 min-w-0 overflow-hidden hover:underline"
      >
        {nameAndIcon}
      </Link>
    ) : (
      <span className="flex items-start gap-1 min-w-0 overflow-hidden">
        {nameAndIcon}
      </span>
    );
  }

  // `overflow-hidden` is load-bearing: without it a long name escapes its
  // column instead of truncating inside a flex parent.
  const nameDisplay = (
    <span className="flex items-start gap-1 min-w-0 overflow-hidden">
      {nameAndIcon}
    </span>
  );

  const isLargeOrXl = size === "large" || size === "xl";
  const iconSizeClass = size === "xl" ? "w-5 h-5" : "w-4 h-4";

  const content = href ? (
    <Link
      href={href}
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
