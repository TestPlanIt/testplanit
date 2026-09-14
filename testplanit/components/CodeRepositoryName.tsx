import { Badge } from "@/components/ui/badge";
import { GitBranch } from "lucide-react";
import { cn } from "~/utils";

interface CodeRepositoryNameProps {
  name: string;
  /** Shown after the name in monospace when given. */
  branch?: string | null;
  /** Shown as an outline badge after the name when given. */
  provider?: string | null;
  className?: string;
  iconClassName?: string;
  nameClassName?: string;
  "data-testid"?: string;
}

/**
 * The one way a code repository is named in the UI: the repository icon,
 * then the name, then (optionally) its provider and branch. Every list,
 * select, badge and title that shows a repository goes through here so the
 * icon and layout never drift between surfaces.
 */
export function CodeRepositoryName({
  name,
  branch,
  provider,
  className,
  iconClassName,
  nameClassName,
  "data-testid": testId,
}: CodeRepositoryNameProps) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      data-testid={testId}
    >
      <GitBranch
        aria-hidden="true"
        className={cn("h-4 w-4 shrink-0 text-muted-foreground", iconClassName)}
      />
      <span className={cn("truncate", nameClassName)}>{name}</span>
      {provider && (
        <Badge variant="outline" className="shrink-0 font-normal">
          {provider}
        </Badge>
      )}
      {branch && (
        <span className="truncate font-mono text-xs text-muted-foreground">
          {branch}
        </span>
      )}
    </span>
  );
}
