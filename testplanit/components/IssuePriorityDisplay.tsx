"use client";

import { Badge } from "@/components/ui/badge";
import { useIssueColors } from "~/hooks/useIssueColors";

interface IssuePriorityDisplayProps {
  priority: string | null | undefined;
  className?: string;
}

/**
 * Displays an issue priority with appropriate color styling
 * Uses the same color scheme as the Issues page
 */
export function IssuePriorityDisplay({
  priority,
  className,
}: IssuePriorityDisplayProps) {
  const { getPriorityStyle } = useIssueColors();
  const style = getPriorityStyle(priority);

  if (!priority) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${className ?? ""}`} style={style}>
      {priority}
    </Badge>
  );
}
