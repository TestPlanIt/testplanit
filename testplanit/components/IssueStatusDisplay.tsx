"use client";

import { Badge } from "@/components/ui/badge";
import { useIssueColors } from "~/hooks/useIssueColors";

interface IssueStatusDisplayProps {
  status: string | null | undefined;
  className?: string;
}

export function IssueStatusDisplay({
  status,
  className,
}: IssueStatusDisplayProps) {
  const { getStatusStyle } = useIssueColors();
  const style = getStatusStyle(status);

  if (!status) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${className ?? ""}`} style={style}>
      {status}
    </Badge>
  );
}
