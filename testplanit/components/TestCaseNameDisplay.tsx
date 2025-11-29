import React from "react";
import { Trash2, Bot, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, type ClassValue } from "~/utils";
import { Link } from "~/lib/navigation";

interface TestCaseNameDisplayProps {
  testCase:
    | {
        id?: number | string;
        name?: string;
        repositoryCase?: {
          id?: number | string;
          name?: string;
          isDeleted?: boolean;
          source?: string;
        };
        isDeleted?: boolean;
        source?: string;
      }
    | null
    | undefined;
  projectId?: number | string;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: ClassValue;
}

export function TestCaseNameDisplay({
  testCase,
  projectId,
  showIcon = true,
  fallbackPrefix = "Case",
  className,
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

  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (isDeleted) {
      icon = <Trash2 className="shrink-0 mt-0.5" />;
    } else if (source === "JUNIT") {
      icon = <Bot className="shrink-0 mt-0.5" />;
    } else {
      icon = <ListChecks className="shrink-0 mt-0.5" />;
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  const content = (
    <>
      {icon}
      <span className={cn("min-w-0", className)}>{displayName}</span>
    </>
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
