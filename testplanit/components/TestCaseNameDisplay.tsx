import { Bot, ListChecks, SquareStack, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";

export type TestCaseNameDisplaySize = "small" | "medium" | "large" | "xl";

interface TestCaseNameDisplayProps {
  testCase:
    | {
        id?: number | string;
        name?: string;
        repositoryCase?: {
          id?: number | string;
          name?: string;
          automated?: boolean;
          isDeleted?: boolean;
          source?: string;
          hasParameters?: boolean;
        };
        automated?: boolean;
        isDeleted?: boolean;
        source?: string;
        hasParameters?: boolean;
      }
    | null
    | undefined;
  projectId?: number | string;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: ClassValue;
  size?: TestCaseNameDisplaySize;
  /** Optional custom rendering for the name text (e.g. a word-level diff),
   *  used instead of the plain name string when provided. */
  nameNode?: ReactNode;
}

const iconSizeClasses: Record<TestCaseNameDisplaySize, string> = {
  small: "h-3 w-3",
  medium: "h-4 w-4",
  large: "h-4 w-4",
  xl: "h-6 w-6",
};

// Adjacent SquareStack glyph rendered next to the type icon for
// parameterized cases. Same shape the Tiptap toolbar's
// InsertParameterToolbarButton uses, so the stacked-squares mark is
// already associated with "parameter". Matched in size to the type
// icon and tinted with `text-primary` so it reads as a related
// indicator without competing for visual weight.

export function TestCaseNameDisplay({
  testCase,
  projectId,
  showIcon = true,
  fallbackPrefix = "Case",
  className,
  size = "medium",
  nameNode,
}: TestCaseNameDisplayProps) {
  const t = useTranslations("common.labels");
  const tParams = useTranslations("parameters");

  if (!testCase) {
    return <span>{t("unknown")}</span>;
  }

  // Extract the values - check both root level and repositoryCase
  const name = testCase.name || testCase.repositoryCase?.name;
  const id = testCase.id || testCase.repositoryCase?.id;
  const isDeleted =
    testCase.isDeleted || testCase.repositoryCase?.isDeleted || false;
  const source = testCase.source || testCase.repositoryCase?.source || "MANUAL";
  const automated =
    testCase.automated || testCase.repositoryCase?.automated || false;
  const hasParameters =
    testCase.hasParameters || testCase.repositoryCase?.hasParameters || false;

  // Determine which icon to show. Soft-deleted wins over everything
  // (the row is being represented as gone); for live cases, we render
  // either the manual or automated type icon and optionally overlay a
  // small Braces badge in the top-right corner when the case has
  // parameterized steps.
  let icon = null;
  const iconSize = iconSizeClasses[size];
  if (showIcon) {
    if (isDeleted) {
      icon = (
        <Trash2
          className={cn("shrink-0 mt-0.5 text-muted-foreground", iconSize)}
        />
      );
    } else {
      const baseIcon =
        automated || isAutomatedCaseSource(source) ? (
          <Bot className={cn("shrink-0", iconSize)} />
        ) : (
          <ListChecks className={cn("shrink-0", iconSize)} />
        );
      icon = (
        <span className="inline-flex items-center gap-1 shrink-0 mt-0.5">
          {baseIcon}
          {hasParameters && (
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

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  const content = (
    <div className="flex items-start gap-1 min-w-0">
      {icon}
      <span
        className={cn(
          "min-w-0",
          isDeleted && "text-muted-foreground line-through",
          className
        )}
      >
        {nameNode ?? displayName}
      </span>
    </div>
  );

  // If we have projectId and id, make it a link
  if (projectId && id) {
    return (
      <Link
        href={`/projects/repository/${projectId}/${id}`}
        className="flex items-start gap-1 min-w-0 overflow-hidden hover:underline"
      >
        {content}
      </Link>
    );
  }

  return (
    <span className="flex items-start gap-1 min-w-0 overflow-hidden">
      {content}
    </span>
  );
}
