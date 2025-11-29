import { CirclePlay, Trash2, Combine } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import { Link } from "~/lib/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TestRunNameDisplayProps {
  testRun:
    | {
        id?: number | string;
        name?: string;
        isDeleted?: boolean;
        configurationGroupId?: number | null;
        configuration?: { id: number; name: string } | null;
      }
    | null
    | undefined;
  projectId?: number | string;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: string;
  linkSuffix?: string;
}

export function TestRunNameDisplay({
  testRun,
  projectId,
  showIcon = true,
  fallbackPrefix = "Test Run",
  className,
  linkSuffix = "",
}: TestRunNameDisplayProps) {
  const t = useTranslations("common.labels");

  if (!testRun) {
    return <span>{t("unknown")}</span>;
  }

  // Extract the values
  const name = testRun.name;
  const id = testRun.id;
  const isDeleted = testRun.isDeleted || false;
  const configurationGroupId = testRun.configurationGroupId;
  const configuration = testRun.configuration;

  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (isDeleted) {
      icon = <Trash2 className="h-4 w-4 shrink-0" />;
    } else {
      icon = <CirclePlay className="h-4 w-4 shrink-0" />;
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  // Configuration indicator for multi-config test runs
  const configIndicator = configurationGroupId ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-1 shrink-0">
            <Combine className="w-3 h-3 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-background/50">{t("multiConfiguration")}</p>
          {configuration && (
            <p className="flex text-xs text-background">
              <Combine className="w-3 h-3 shrink-0 mr-1" />
              {configuration.name}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null;

  const content = (
    <>
      {icon}
      <span className={cn("min-w-0", className)}>{displayName}</span>
      {configIndicator}
    </>
  );

  // If deleted, don't make it a link
  if (isDeleted) {
    return (
      <span className="flex items-center gap-1 min-w-0 text-muted-foreground">
        {content}
      </span>
    );
  }

  // If we have projectId and id, make it a link
  if (projectId && id) {
    return (
      <Link
        href={`/projects/runs/${projectId}/${id}${linkSuffix}`}
        className="flex items-center gap-1 min-w-0 hover:underline"
      >
        {content}
      </Link>
    );
  }

  return <span className="flex items-center gap-1 min-w-0">{content}</span>;
}
