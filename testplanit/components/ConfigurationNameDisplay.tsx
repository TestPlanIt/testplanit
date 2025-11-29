import { Combine } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ConfigurationNameDisplayProps {
  configuration?: {
    id?: number | string;
    name?: string;
  } | null;
  name?: string | null;
  showIcon?: boolean;
  fallbackPrefix?: string;
  fallback?: string;
  className?: string;
  iconClassName?: string;
  truncate?: boolean;
}

export function ConfigurationNameDisplay({
  configuration,
  name,
  showIcon = true,
  fallbackPrefix = "Configuration",
  fallback,
  className,
  iconClassName,
  truncate = false,
}: ConfigurationNameDisplayProps) {
  const t = useTranslations("common.labels");

  // Determine the display name from either the configuration object or direct name prop
  let displayName: string;

  if (name !== undefined) {
    displayName = name || fallback || t("none");
  } else if (configuration) {
    displayName =
      configuration.name ||
      (configuration.id
        ? `${fallbackPrefix} ${configuration.id}`
        : t("unknown"));
  } else {
    displayName = fallback || t("none");
  }

  const content = (
    <span
      className={cn(
        "flex items-center gap-1",
        truncate && "min-w-0",
        className
      )}
    >
      {showIcon && (
        <Combine className={cn("h-4 w-4 shrink-0 mt-0.5", iconClassName)} />
      )}
      <span className={cn(truncate && "truncate")}>{displayName}</span>
    </span>
  );

  if (truncate) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent>
            <p>{displayName}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return content;
}
