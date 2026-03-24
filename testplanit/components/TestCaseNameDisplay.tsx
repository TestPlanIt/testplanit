import { Bot, ListChecks, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
        };
        automated?: boolean;
        isDeleted?: boolean;
        source?: string;
      }
    | null
    | undefined;
  projectId?: number | string;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: ClassValue;
  size?: TestCaseNameDisplaySize;
}

const iconSizeClasses: Record<TestCaseNameDisplaySize, string> = {
  small: "h-3 w-3",
  medium: "h-4 w-4",
  large: "h-4 w-4",
  xl: "h-6 w-6",
};

export function TestCaseNameDisplay({
  testCase,
  projectId,
  showIcon = true,
  fallbackPrefix = "Case",
  className,
  size = "medium",
}: TestCaseNameDisplayProps) {
  const t = useTranslations("common.labels");

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

  // Determine which icon to show
  let icon = null;
  const iconSize = iconSizeClasses[size];
  if (showIcon) {
    if (isDeleted) {
      icon = (
        <Trash2
          className={cn("shrink-0 mt-0.5 text-muted-foreground", iconSize)}
        />
      );
    } else if (automated || isAutomatedCaseSource(source)) {
      icon = <Bot className={cn("shrink-0 mt-0.5", iconSize)} />;
    } else {
      icon = <ListChecks className={cn("shrink-0 mt-0.5", iconSize)} />;
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  const content = (
    <div className="flex items-start gap-1">
      {icon}
      <span
        className={cn(
          "min-w-0",
          isDeleted && "text-muted-foreground line-through",
          className
        )}
      >
        {displayName}
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
