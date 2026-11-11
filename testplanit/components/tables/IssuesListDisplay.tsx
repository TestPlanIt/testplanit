import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bug } from "lucide-react";
import React from "react";
import { IssuesDisplay } from "./IssuesDisplay"; // Assuming IssuesDisplay is in the same folder or adjust path

// Define the expected structure for an issue object
interface Issue {
  id: number;
  name: string;
  externalId?: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  title?: string | null;
  description?: string | null;
  externalStatus?: string | null;
  priority?: string | null;
  lastSyncedAt?: string | Date | null;
  data?: any;
  integration?: {
    id: number;
    provider: string;
    name: string;
  } | null;
  integrationId?: number | null;
  projectIds: number[];
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
}

interface IssuesListProps {
  issues: Issue[] | null | undefined;
  size?: "small" | "default";
}

export const IssuesListDisplay: React.FC<IssuesListProps> = ({
  issues,
  size = "default",
}) => {
  if (!issues || issues.length === 0) {
    return null;
  }

  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <Badge
          className={
            size === "small"
              ? "cursor-pointer px-1.5 py-0 text-xs"
              : "cursor-pointer"
          }
        >
          <Bug
            className={
              size === "small"
                ? "me-0.5 h-3 w-3 shrink-0"
                : "me-1 h-4 w-4 shrink-0"
            }
          />
          {issues.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-md p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex max-w-full flex-wrap gap-1">
          {issues.map((issue) => {
            return (
              <IssuesDisplay
                key={issue.id}
                id={issue.id}
                name={issue.name}
                externalId={issue.externalId}
                externalUrl={issue.externalUrl}
                title={issue.title}
                description={issue.description}
                status={issue.externalStatus}
                priority={issue.priority}
                lastSyncedAt={issue.lastSyncedAt}
                projectIds={issue.projectIds}
                size="small"
                data={issue.data}
                integrationProvider={
                  issue.integration?.provider ||
                  (issue.integrationId ? "JIRA" : undefined)
                }
                integrationId={issue.integrationId || issue.integration?.id}
                issueTypeName={issue.issueTypeName}
                issueTypeIconUrl={issue.issueTypeIconUrl}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
