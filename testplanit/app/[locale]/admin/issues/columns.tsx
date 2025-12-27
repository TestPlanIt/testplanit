import { ColumnDef } from "@tanstack/react-table";
import { Issue } from "@prisma/client";
import { EditIssueModal } from "./EditIssue";
import { DeleteIssueModal } from "./DeleteIssue";
import { SyncIssue } from "./SyncIssue";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { useTranslations } from "next-intl";
import { Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import DOMPurify from "dompurify";
import { DateFormatter } from "@/components/DateFormatter";
import { useIssueColors } from "@/hooks/useIssueColors";

// Helper function to strip HTML tags and get plain text
function stripHtmlTags(html: string | null): string {
  if (!html) return "";
  // Remove HTML tags and decode HTML entities
  return html
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
    .replace(/&amp;/g, "&") // Replace &amp; with &
    .replace(/&lt;/g, "<") // Replace &lt; with <
    .replace(/&gt;/g, ">") // Replace &gt; with >
    .replace(/&quot;/g, '"') // Replace &quot; with "
    .replace(/&#39;/g, "'") // Replace &#39; with '
    .trim();
}

export interface ExtendedIssue extends Issue {
  repositoryCases: { id: number }[];
  sessions: { id: number }[];
  testRuns: { id: number }[];
  project?: { id: number; name: string; iconUrl: string | null } | null;
  integration?: { id: number; name: string; provider: string } | null;
  projects?: { id: number; name: string; iconUrl: string | null }[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

/**
 * Custom hook to get columns with proper color styling from database
 */
export function useIssueColumns({
  tCommon,
  isLoadingCounts = false,
}: {
  tCommon: ReturnType<typeof useTranslations<"common">>;
  isLoadingCounts?: boolean;
}): ColumnDef<ExtendedIssue>[] {
  const { getPriorityStyle, getStatusStyle } = useIssueColors();

  return [
    {
      id: "name",
      accessorKey: "name",
      accessorFn: (row) => row.name,
      header: tCommon("name"),
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 300,
      minSize: 150,
      maxSize: 500,
      cell: ({ row, column }) => {
        const issue = row.original;
        const projectIds = issue.projects?.map((p) => p.id) || [];

        return (
          <div
            style={{ maxWidth: column.getSize() }}
            className="overflow-hidden"
          >
            <IssuesDisplay
              id={issue.id}
              name={issue.name}
              title={issue.title}
              status={issue.status || undefined}
              externalId={issue.externalId || undefined}
              externalUrl={issue.externalUrl || undefined}
              projectIds={projectIds}
              data={issue.externalData}
              integrationProvider={issue.integration?.provider}
              integrationId={issue.integrationId || undefined}
              lastSyncedAt={issue.lastSyncedAt}
              issueTypeName={issue.issueTypeName}
              issueTypeIconUrl={issue.issueTypeIconUrl}
              size="small"
            />
          </div>
        );
      },
    },
    {
      id: "title",
      accessorKey: "title",
      accessorFn: (row) => row.title,
      header: tCommon("fields.title"),
      enableSorting: true,
      enableResizing: true,
      size: 300,
      minSize: 150,
      maxSize: 500,
      cell: ({ row, column }) => {
        const title = row.original.title;
        const hasHtml = title && /<[^>]+>/.test(title);
        const plainText = stripHtmlTags(title);

        if (!title) return <span className="text-muted-foreground">-</span>;

        return (
          <Popover>
            <PopoverTrigger asChild>
              <div
                className="line-clamp-2 overflow-hidden text-ellipsis text-sm cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors"
                style={{ maxWidth: column.getSize() }}
                title={plainText}
              >
                {plainText}
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] max-h-[400px] overflow-auto">
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">
                  {tCommon("fields.title")}
                </h4>
                {hasHtml ? (
                  <div
                    className="text-sm [&_a]:text-primary [&_a]:underline [&_p]:mb-2 [&_p:last-child]:mb-0"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(title, {
                        ALLOWED_TAGS: [
                          "p",
                          "br",
                          "a",
                          "strong",
                          "em",
                          "u",
                          "ul",
                          "ol",
                          "li",
                          "h1",
                          "h2",
                          "h3",
                          "h4",
                          "h5",
                          "h6",
                        ],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                      }),
                    }}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{title}</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: "description",
      accessorKey: "description",
      accessorFn: (row) => stripHtmlTags(row.description),
      header: tCommon("fields.description"),
      enableSorting: false,
      enableResizing: true,
      size: 300,
      minSize: 150,
      maxSize: 500,
      cell: ({ row, column }) => {
        const description = row.original.description;
        const plainText = stripHtmlTags(description);

        if (!plainText) return <span className="text-muted-foreground">-</span>;

        const hasHtml = description && /<[^>]+>/.test(description);

        return (
          <Popover>
            <PopoverTrigger asChild>
              <div
                className="line-clamp-2 overflow-hidden text-ellipsis text-sm cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors"
                style={{ maxWidth: column.getSize() }}
                title={plainText}
              >
                {plainText}
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] max-h-[400px] overflow-auto">
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">
                  {tCommon("fields.description")}
                </h4>
                {hasHtml ? (
                  <div
                    className="text-sm [&_a]:text-primary [&_a]:underline [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(description, {
                        ALLOWED_TAGS: [
                          "p",
                          "br",
                          "a",
                          "strong",
                          "em",
                          "u",
                          "ul",
                          "ol",
                          "li",
                          "h1",
                          "h2",
                          "h3",
                          "h4",
                          "h5",
                          "h6",
                          "blockquote",
                          "code",
                          "pre",
                        ],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                      }),
                    }}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{description}</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: "status",
      accessorKey: "status",
      accessorFn: (row) => row.status || "",
      header: tCommon("fields.status"),
      enableSorting: true,
      enableResizing: true,
      size: 120,
      minSize: 80,
      maxSize: 200,
      cell: ({ row }) => {
        const status = row.original.status;
        if (!status) return <span className="text-muted-foreground">-</span>;
        const statusStyle = getStatusStyle(status);
        return (
          <Badge variant="outline" className="capitalize" style={statusStyle}>
            {status}
          </Badge>
        );
      },
    },
    {
      id: "priority",
      accessorKey: "priority",
      accessorFn: (row) => row.priority || "",
      header: tCommon("fields.priority"),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      minSize: 80,
      maxSize: 200,
      cell: ({ row }) => {
        const priority = row.original.priority;
        if (!priority) return <span className="text-muted-foreground">-</span>;
        const priorityStyle = getPriorityStyle(priority);
        return (
          <Badge variant="outline" className="capitalize" style={priorityStyle}>
            {priority}
          </Badge>
        );
      },
    },
    {
      id: "lastSyncedAt",
      accessorKey: "lastSyncedAt",
      accessorFn: (row) => row.lastSyncedAt,
      header: tCommon("fields.lastSyncedAt"),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      minSize: 80,
      maxSize: 250,
      cell: ({ row, column }) => {
        const lastSyncedAt = row.original.lastSyncedAt;
        if (!lastSyncedAt)
          return <span className="text-muted-foreground">-</span>;
        return (
          <span
            className="text-sm truncate overflow-hidden block"
            style={{ maxWidth: column.getSize() }}
          >
            <DateFormatter date={lastSyncedAt} formatString="PPp" />
          </span>
        );
      },
    },
    {
      id: "cases",
      accessorKey: "repositoryCases",
      accessorFn: (row) => row.repositoryCases,
      header: tCommon("fields.testCases"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      minSize: 60,
      maxSize: 150,
      cell: ({ row }) => {
        const count = row.original.repositoryCasesCount;
        return (
          <div className="text-center">
            <CasesListDisplay
              count={count}
              filter={{
                issues: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "testRuns",
      accessorKey: "testRuns",
      accessorFn: (row) => row.testRuns,
      header: tCommon("fields.testRuns"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      minSize: 60,
      maxSize: 150,
      cell: ({ row }) => {
        const count = row.original.testRunsCount;
        return (
          <div className="text-center">
            <TestRunsListDisplay
              count={count}
              filter={{
                issues: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "sessions",
      accessorKey: "sessions",
      accessorFn: (row) => row.sessions,
      header: tCommon("fields.sessions"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      minSize: 60,
      maxSize: 150,
      cell: ({ row }) => {
        const count = row.original.sessionsCount;
        return (
          <div className="text-center">
            <SessionsListDisplay
              count={count}
              filter={{
                issues: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "projects",
      accessorKey: "projects",
      header: tCommon("fields.projects"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      minSize: 60,
      maxSize: 150,
      cell: ({ row }) => {
        const projects = row.original.projects || [];
        return (
          <div className="text-center">
            <ProjectListDisplay
              projects={projects}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "integration",
      accessorKey: "integration",
      accessorFn: (row) => row.integration?.name || "",
      header: tCommon("fields.integration"),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      minSize: 100,
      maxSize: 250,
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {row.original.integration?.name || "-"}
            </span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: tCommon("actions.actionsLabel"),
      enableResizing: true,
      enableSorting: false,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 150,
      minSize: 120,
      maxSize: 200,
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <SyncIssue key={`sync-${row.original.id}`} issue={row.original} />
          <EditIssueModal
            key={`edit-${row.original.id}`}
            issue={row.original}
          />
          <DeleteIssueModal
            key={`delete-${row.original.id}`}
            issue={row.original}
          />
        </div>
      ),
    },
  ];
}
