import { DateFormatter } from "@/components/DateFormatter";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Issue } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import DOMPurify from "dompurify";
import { useMemo } from "react";
import { buildSimpleUrlLink } from "~/lib/integrations/simpleUrl";

function resolveIssueUrl(row: ExtendedIssues): string | null {
  if (row.integration?.provider === "SIMPLE_URL") {
    const settings =
      row.integration.settings && typeof row.integration.settings === "object"
        ? (row.integration.settings as Record<string, unknown>)
        : null;
    const baseUrl =
      typeof settings?.baseUrl === "string" ? settings.baseUrl : undefined;
    return buildSimpleUrlLink(baseUrl, row.externalId);
  }
  return row.externalUrl ?? null;
}

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
    settings?: unknown;
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
  hideSyncedFields = false,
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
  /** Hide columns that come from external API sync (description, status, priority, lastSyncedAt)
   *  when the project only has SIMPLE_URL integrations — those columns never have values. */
  hideSyncedFields?: boolean;
}): ColumnDef<ExtendedIssues>[] {
  // Destructure to primitive deps so useMemo only re-runs when strings change (locale switch),
  // not on every parent render that creates a new translations object.
  const {
    name: tName,
    title: tTitle,
    description: tDescription,
    status: tStatus,
    priority: tPriority,
    lastSyncedAt: tLastSyncedAt,
    testCases: tTestCases,
    sessions: tSessions,
    testRuns: tTestRuns,
  } = translations;

  return useMemo(() => {
    const columns: ColumnDef<ExtendedIssues>[] = [
      {
        id: "name",
        accessorKey: "name",
        accessorFn: (row) => row.name,
        header: tName,
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
                externalUrl={resolveIssueUrl(row.original)}
                title={row.original.title}
                description={row.original.description}
                status={row.original.externalStatus}
                priority={row.original.priority}
                lastSyncedAt={row.original.lastSyncedAt}
                projectIds={row.original.projectIds}
                size="small"
                data={row.original.data}
                integrationProvider={row.original.integration?.provider}
                integrationId={row.original.integration?.id}
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
        header: tTitle,
        enableSorting: true,
        enableResizing: true,
        size: 250,
        minSize: 150,
        maxSize: 500,
        cell: ({ row, column }) => {
          const title = row.original.title;
          const externalUrl = resolveIssueUrl(row.original);
          const hasHtml = title && /<[^>]+>/.test(title);
          const plainText = stripHtmlTags(title);

          if (!title) return <span className="text-muted-foreground">-</span>;

          // If the issue has an externalUrl and the title is plain text,
          // render the title as a link to the external system.
          if (externalUrl && !hasHtml) {
            return (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={plainText}
                className="line-clamp-2 overflow-hidden text-ellipsis text-sm hover:text-primary hover:underline block px-1 -mx-1 py-0.5"
                style={{ maxWidth: column.getSize() }}
                onClick={(e) => e.stopPropagation()}
              >
                {plainText}
              </a>
            );
          }

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
                  <h4 className="font-semibold text-sm">{tTitle}</h4>
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
        header: tDescription,
        enableSorting: false,
        enableResizing: true,
        size: 250,
        minSize: 150,
        maxSize: 500,
        cell: ({ row, column }) => {
          const description = row.original.description;
          const plainText = stripHtmlTags(description);

          if (!plainText)
            return <span className="text-muted-foreground">-</span>;

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
                  <h4 className="font-semibold text-sm">{tDescription}</h4>
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
        header: tStatus,
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
        header: tPriority,
        enableSorting: true,
        enableResizing: true,
        size: 100,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => {
          const priority = row.original.priority;
          return (
            <IssuePriorityDisplay priority={priority} className="capitalize" />
          );
        },
      },
      {
        id: "lastSyncedAt",
        accessorKey: "lastSyncedAt",
        accessorFn: (row) => row.lastSyncedAt,
        header: tLastSyncedAt,
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
        header: tTestCases,
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
                  caseIssues: {
                    some: {
                      issue: {
                        id: row.original.id,
                      },
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
        header: tTestRuns,
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
        header: tSessions,
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

    // Hide columns that are populated only via external API sync when the project
    // only has SIMPLE_URL integrations — those columns would always be empty.
    if (hideSyncedFields) {
      const syncedOnly = new Set([
        "description",
        "status",
        "priority",
        "lastSyncedAt",
      ]);
      return columns.filter((c) => !syncedOnly.has(c.id as string));
    }

    return columns;
  }, [
    tName,
    tTitle,
    tDescription,
    tStatus,
    tPriority,
    tLastSyncedAt,
    tTestCases,
    tSessions,
    tTestRuns,
    hideSyncedFields,
    isLoadingCounts,
  ]);
}
