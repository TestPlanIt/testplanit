import { DateFormatter } from "@/components/DateFormatter";
import { stripHtmlTags } from "~/utils/stripHtmlTags";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { MilestonesCountDisplay } from "@/components/tables/MilestonesCountDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Issue } from "~/zenstack/models";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { useMemo } from "react";
import DOMPurify from "dompurify";
import { Plug, SquarePen, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { SyncIssue } from "./SyncIssue";
import { CountsLoading } from "@/components/tables/CountsLoading";

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
  milestonesCount?: number;
}

/**
 * Custom hook to get columns with proper color styling from database
 */
export function useIssueColumns({
  tCommon,
  onEditIssue,
  onDeleteIssue,
}: {
  tCommon: ReturnType<typeof useTranslations<"common">>;
  onEditIssue?: (issue: ExtendedIssue) => void;
  onDeleteIssue?: (issue: ExtendedIssue) => void;
}): ColumnDef<ExtendedIssue>[] {
  return useMemo(
    () => [
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
                description={issue.description || undefined}
                status={issue.status || undefined}
                priority={issue.priority || undefined}
                lastSyncedAt={issue.lastSyncedAt || undefined}
                externalId={issue.externalId || undefined}
                externalUrl={issue.externalUrl || undefined}
                projectIds={projectIds}
                data={issue.externalData}
                integrationProvider={issue.integration?.provider}
                integrationId={issue.integrationId || undefined}
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
                  className="-mx-1 line-clamp-2 cursor-pointer overflow-hidden rounded px-1 py-0.5 text-sm text-ellipsis transition-colors hover:bg-accent/50"
                  style={{ maxWidth: column.getSize() }}
                  title={plainText}
                >
                  {plainText}
                </div>
              </PopoverTrigger>
              <PopoverContent className="max-h-[400px] w-[500px] overflow-auto">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
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
                    <p className="text-sm whitespace-pre-wrap">{plainText}</p>
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

          if (!plainText)
            return <span className="text-muted-foreground">-</span>;

          const hasHtml = description && /<[^>]+>/.test(description);

          return (
            <Popover>
              <PopoverTrigger asChild>
                <div
                  className="-mx-1 line-clamp-2 cursor-pointer overflow-hidden rounded px-1 py-0.5 text-sm text-ellipsis transition-colors hover:bg-accent/50"
                  style={{ maxWidth: column.getSize() }}
                  title={plainText}
                >
                  {plainText}
                </div>
              </PopoverTrigger>
              <PopoverContent className="max-h-[400px] w-[500px] overflow-auto">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    {tCommon("fields.description")}
                  </h4>
                  {hasHtml ? (
                    <div
                      className="text-sm [&_a]:text-primary [&_a]:underline [&_ol]:ms-4 [&_ol]:list-decimal [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:ms-4 [&_ul]:list-disc"
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
                    <p className="text-sm whitespace-pre-wrap">{plainText}</p>
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
        header: tCommon("actions.status"),
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
        header: tCommon("fields.priority"),
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
              className="block truncate overflow-hidden text-sm"
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
              <CountsLoading>
                {(isLoadingCounts) => (
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
                )}
              </CountsLoading>
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
              <CountsLoading>
                {(isLoadingCounts) => (
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
                )}
              </CountsLoading>
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
              <CountsLoading>
                {(isLoadingCounts) => (
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
                )}
              </CountsLoading>
            </div>
          );
        },
      },
      {
        id: "milestones",
        accessorKey: "milestones",
        accessorFn: (row) => row.milestonesCount ?? 0,
        header: tCommon("fields.milestones"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
        minSize: 60,
        maxSize: 150,
        cell: ({ row }) => {
          const count = row.original.milestonesCount;
          return (
            <div className="text-center">
              <CountsLoading>
                {(isLoadingCounts) => (
                  <MilestonesCountDisplay
                    count={count}
                    filter={{
                      milestoneIssues: {
                        some: {
                          issueId: row.original.id,
                        },
                      },
                      isDeleted: false,
                    }}
                    isLoading={isLoadingCounts}
                  />
                )}
              </CountsLoading>
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
              <CountsLoading>
                {(isLoadingCounts) => (
                  <ProjectListDisplay
                    projects={projects}
                    isLoading={isLoadingCounts}
                  />
                )}
              </CountsLoading>
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
          <div className="flex justify-end gap-1 bg-primary-foreground whitespace-nowrap">
            <SyncIssue key={`sync-${row.original.id}`} issue={row.original} />
            <Button
              variant="ghost"
              className="h-auto px-2 py-1"
              onClick={() => onEditIssue?.(row.original)}
              aria-label={tCommon("actions.edit")}
            >
              <SquarePen className="h-5 w-5" />
            </Button>
            <Button
              variant="destructive"
              className="h-auto px-2 py-1"
              onClick={() => onDeleteIssue?.(row.original)}
              aria-label={tCommon("actions.delete")}
            >
              <Trash className="h-5 w-5" />
            </Button>
          </div>
        ),
      },
    ],
    [tCommon, onEditIssue, onDeleteIssue]
  );
}
