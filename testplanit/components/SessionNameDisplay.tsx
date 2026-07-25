import { Compass, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";

interface SessionNameDisplayProps {
  session:
    | {
        id?: number | string;
        name?: string;
        isDeleted?: boolean;
      }
    | null
    | undefined;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: string;
}

export function SessionNameDisplay({
  session,
  showIcon = true,
  fallbackPrefix = "Session",
  className,
}: SessionNameDisplayProps) {
  const t = useTranslations("common.labels");

  if (!session) {
    return <span>{t("unknown")}</span>;
  }

  // Extract the values
  const name = session.name;
  const id = session.id;
  const isDeleted = session.isDeleted || false;

  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (isDeleted) {
      icon = <Trash2 className="h-4 w-4 shrink-0 mt-1" />;
    } else {
      icon = <Compass className="h-4 w-4 shrink-0 mt-1" />;
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  return (
    <span className="flex items-start gap-1 min-w-0">
      {icon}
      <span className={cn("min-w-0", className)}>{displayName}</span>
    </span>
  );
}
