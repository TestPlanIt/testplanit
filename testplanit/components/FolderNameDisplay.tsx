import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";

interface FolderNameDisplayProps {
  folder: {
    id?: number | string;
    name?: string;
  } | null | undefined;
  showIcon?: boolean;
  fallbackPrefix?: string;
}

export function FolderNameDisplay({ 
  folder, 
  showIcon = true,
  fallbackPrefix = "Folder"
}: FolderNameDisplayProps) {
  const t = useTranslations("common.labels");
  
  if (!folder) {
    return <span>{t("unknown")}</span>;
  }

  const displayName = folder.name || (folder.id ? `${fallbackPrefix} ${folder.id}` : t("unknown"));

  return (
    <span className="flex items-center gap-1">
      {showIcon && <Folder className="h-4 w-4" />}
      {displayName}
    </span>
  );
}