import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IssuesDisplay } from "./IssuesDisplay"; // Assuming IssuesDisplay is in the same folder or adjust path
import { Bug } from "lucide-react";

// Define the expected structure for an issue object
interface Issue {
  id: number;
  name: string;
  externalId?: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  title?: string | null;
  externalStatus?: string | null;
  data?: any;
  integration?: {
    id: number;
    provider: string;
    name: string;
  } | null;
  integrationId?: number | null;
  projectIds: number[];
  lastSyncedAt?: Date | null;
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
}

interface IssuesListProps {
  issues: Issue[] | null | undefined;
}

export const IssuesListDisplay: React.FC<IssuesListProps> = ({
  issues,
  // projectId,
  // baseUrl,
}) => {
  if (!issues || issues.length === 0) {
    return null;
  }

  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <Badge className="cursor-pointer">
          <Bug className="w-4 h-4 mr-1 shrink-0" />
          {issues.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-md p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex flex-wrap gap-1 max-w-full">
          {issues.map((issue) => {
            return (
              <IssuesDisplay
                key={issue.id}
                id={issue.id}
                name={issue.name}
                externalId={issue.externalId}
                externalUrl={issue.externalUrl}
                title={issue.title}
                status={issue.externalStatus}
                projectIds={issue.projectIds}
                size="small"
                data={issue.data}
                integrationProvider={issue.integration?.provider || (issue.integrationId ? "JIRA" : undefined)}
                integrationId={issue.integrationId || issue.integration?.id}
                lastSyncedAt={issue.lastSyncedAt}
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
