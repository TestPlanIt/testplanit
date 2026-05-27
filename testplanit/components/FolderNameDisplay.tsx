import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink, Folder, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";

interface FolderNameDisplayProps {
  folder:
    | {
        id?: number | string;
        name?: string;
      }
    | null
    | undefined;
  showIcon?: boolean;
  fallbackPrefix?: string;
  /**
   * Clamp the name to this many lines. `1` truncates to a single line; `2`–`6`
   * clamp to that many lines. When clamped, the full name is shown on hover.
   * Omit (or `0`) to render the full name with no clamping.
   */
  maxLines?: number;
  /** When set, the name links here (e.g. the repository with this folder selected). */
  link?: string;
  linkTarget?: "_blank" | "_self";
  className?: ClassValue;
}

export function FolderNameDisplay({
  folder,
  showIcon = true,
  fallbackPrefix = "Folder",
  maxLines,
  link,
  linkTarget,
  className,
}: FolderNameDisplayProps) {
  const t = useTranslations("common.labels");

  if (!folder) {
    return <span>{t("unknown")}</span>;
  }

  const displayName =
    folder.name ||
    (folder.id ? `${fallbackPrefix} ${folder.id}` : t("unknown"));

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

  const inner = (
    <>
      {showIcon && <Folder className="h-4 w-4 shrink-0" />}
      <span className={cn("min-w-0", clampClass, className)}>
        {displayName}
      </span>
    </>
  );

  const content = link ? (
    <Link
      href={link}
      target={linkTarget}
      className="group flex items-center gap-1 max-w-full hover:underline"
    >
      {inner}
      {linkTarget === "_blank" ? (
        <ExternalLink className="w-4 h-4 ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      ) : (
        <LinkIcon className="w-4 h-4 ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </Link>
  ) : (
    <span className="flex items-center gap-1 max-w-full">{inner}</span>
  );

  // No clamping requested: render the name as-is.
  if (!clampClass) {
    return content;
  }

  // Clamped: surface the full name on hover.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="text-left max-w-full">{content}</div>
      </TooltipTrigger>
      <TooltipContent>
        <div>{displayName}</div>
      </TooltipContent>
    </Tooltip>
  );
}
