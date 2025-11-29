import { Drama } from "lucide-react";
import { useTranslations } from "next-intl";

interface RoleNameDisplayProps {
  role: {
    id?: number | string;
    name?: string;
  } | null | undefined;
  showIcon?: boolean;
  fallbackPrefix?: string;
}

export function RoleNameDisplay({ 
  role, 
  showIcon = true,
  fallbackPrefix = "Role"
}: RoleNameDisplayProps) {
  const t = useTranslations("common.labels");
  
  if (!role) {
    return <span>{t("unknown")}</span>;
  }

  const displayName = role.name || (role.id ? `${fallbackPrefix} ${role.id}` : t("unknown"));

  return (
    <span className="flex items-center gap-1">
      {showIcon && <Drama className="h-4 w-4" />}
      {displayName}
    </span>
  );
}