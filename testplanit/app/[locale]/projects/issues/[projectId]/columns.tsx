import { ColumnDef } from "@tanstack/react-table";
import { Issue } from "@prisma/client";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import DOMPurify from "dompurify";
import { DateFormatter } from "@/components/DateFormatter";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";

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

export interface ExtendedIssues extends Issue {
  integration?: {
    id: number;
    provider: string;
    name: string;
  } | null;
  repositoryCases: { id: number }[];
  sessions: { id: number }[];
  testRuns: { id: number }[];
  aggregatedTestRunIds: number[];
  projectIds: number[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

/**
 * Custom hook to get columns with proper color styling from database
 */
export function useIssueColumns({
  translations,
  isLoadingCounts = false,
}: {
  translations: {
    name: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    lastSyncedAt: string;
    testCases: string;
    sessions: string;
    testRuns: string;
    integration: string;
  };
  isLoadingCounts?: boolean;
}): ColumnDef<ExtendedIssues>[] {
  const columns: ColumnDef<ExtendedIssues>[] = [
    {
      id: "name",
      accessorKey: "name",
      accessorFn: (row) => row.name,
      header: translations.name,
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 400,
      minSize: 150,
      maxSize: 800,
      cell: ({ row, column }) => {
        return (
          <div
            data-row-id={row.original.id}
            style={{ maxWidth: column.getSize() }}
            className="overflow-hidden"
          >
            <IssuesDisplay
              id={row.original.id}
              name={row.original.name}
              externalId={row.original.externalId}
              externalUrl={row.original.externalUrl}
              title={row.original.title}
              status={row.original.externalStatus}
              projectIds={row.original.projectIds}
              size="small"
              data={row.original.data}
              integrationProvider={row.original.integration?.provider}
              integrationId={row.original.integration?.id}
              lastSyncedAt={row.original.lastSyncedAt}
              issueTypeName={row.original.issueTypeName}
              issueTypeIconUrl={row.original.issueTypeIconUrl}
            />
          </div>
        );
      },
    },
    {
      id: "title",
      accessorKey: "title",
      accessorFn: (row) => row.title,
      header: translations.title,
      enableSorting: true,
      enableResizing: true,
      size: 250,
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
                <h4 className="font-semibold text-sm">{translations.title}</h4>
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
      header: translations.description,
      enableSorting: false,
      enableResizing: true,
      size: 250,
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
                  {translations.description}
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
      header: translations.status,
      enableSorting: true,
      enableResizing: true,
      size: 120,
      minSize: 80,
      maxSize: 200,
      cell: ({ row }) => {
        const status = row.original.status;
        return <IssueStatusDisplay status={status} className="capitalize" />;
      },
    },
    {
      id: "priority",
      accessorKey: "priority",
      accessorFn: (row) => row.priority || "",
      header: translations.priority,
      enableSorting: true,
      enableResizing: true,
      size: 100,
      minSize: 80,
      maxSize: 200,
      cell: ({ row }) => {
        const priority = row.original.priority;
        return <IssuePriorityDisplay priority={priority} className="capitalize" />;
      },
    },
    {
      id: "lastSyncedAt",
      accessorKey: "lastSyncedAt",
      accessorFn: (row) => row.lastSyncedAt,
      header: translations.lastSyncedAt,
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
      accessorFn: (row) => row.repositoryCasesCount ?? 0,
      header: translations.testCases,
      enableSorting: true,
      enableResizing: true,
      sortingFn: "basic",
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
      accessorKey: "aggregatedTestRunIds",
      accessorFn: (row) => row.testRunsCount ?? 0,
      header: translations.testRuns,
      enableSorting: true,
      enableResizing: true,
      sortingFn: "basic",
      size: 75,
      minSize: 60,
      maxSize: 150,
      cell: ({ row }) => {
        const count = row.original.testRunsCount;
        return (
          <div className="text-center">
            <TestRunsListDisplay
              key={`tr-${row.original.id}`}
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
      accessorFn: (row) => row.sessionsCount ?? 0,
      header: translations.sessions,
      enableSorting: true,
      enableResizing: true,
      sortingFn: "basic",
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
  ];

  return columns;
}
