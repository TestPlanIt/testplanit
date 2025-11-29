import { useTranslations } from "next-intl";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";

interface IssueTypeNameDisplayProps {
  issueType: {
    id?: number | string;
    name?: string;
    iconUrl?: string;
  } | null | undefined;
  showIcon?: boolean;
  fallbackPrefix?: string;
}

export function IssueTypeNameDisplay({
  issueType,
  showIcon = true,
  fallbackPrefix = "Issue Type"
}: IssueTypeNameDisplayProps) {
  const t = useTranslations("common.labels");

  if (!issueType) {
    return <span>{t("unknown")}</span>;
  }

  const displayName = issueType.name || (issueType.id ? `${fallbackPrefix} ${issueType.id}` : t("unknown"));

  return (
    <span className="flex items-center gap-1">
      {showIcon && (
        <IssueTypeIcon
          issueTypeName={issueType.name}
          iconUrl={issueType.iconUrl}
          className="h-4 w-4"
        />
      )}
      {displayName}
    </span>
  );
}