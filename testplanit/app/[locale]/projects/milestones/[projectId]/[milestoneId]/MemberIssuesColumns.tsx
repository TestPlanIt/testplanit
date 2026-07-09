import { Checkbox } from "@/components/ui/checkbox";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import DOMPurify from "dompurify";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type {
  Integration,
  Issue,
  MilestoneIssue as MilestoneIssueRow,
} from "~/zenstack/models";
import { buildSimpleUrlLink } from "~/lib/integrations/simpleUrl";
import {
  CoverageBreakdown,
  CoverageChip,
  coverageSortValue,
} from "./CoverageChip";

/**
 * Row shape for the Member Issues table: a `MilestoneIssue` link row plus its
 * related `Issue` and the per-issue coverage breakdown fetched from
 * `/api/milestones/[milestoneId]/members/coverage` (18-05).
 *
 * NOTE (Pitfall 2 / type collision): `lib/services/milestoneSummary.ts`
 * exports an unrelated `MilestoneIssue` DTO for the existing "linked defect"
 * list on this same page. The schema model type is aliased to
 * `MilestoneIssueRow` here so both can be imported side-by-side without a
 * naming conflict.
 */
export interface ExtendedMemberIssue extends MilestoneIssueRow {
  issue: Issue & { integration?: Integration | null };
  coverage?: CoverageBreakdown;
}

// Same helper the project Issues page keeps file-local for its
// description column: plain-text preview of possibly-HTML content.
function stripHtmlTags(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Same external-URL resolution the project Issues page uses: SIMPLE_URL
 * issues build their link from the integration's baseUrl; tracker issues
 * use the stored externalUrl.
 */
function resolveMemberIssueUrl(
  issue: ExtendedMemberIssue["issue"]
): string | null {
  if (issue.integration?.provider === "SIMPLE_URL") {
    const settings =
      issue.integration.settings &&
      typeof issue.integration.settings === "object"
        ? (issue.integration.settings as Record<string, unknown>)
        : null;
    const baseUrl =
      typeof settings?.baseUrl === "string" ? settings.baseUrl : undefined;
    return buildSimpleUrlLink(baseUrl, issue.externalId);
  }
  return issue.externalUrl ?? null;
}

export interface MemberIssuesColumnsTranslations {
  selectRow: string;
  key: string;
  description: string;
  status: string;
  coverage: string;
  source: string;
  sourceSynced: string;
  sourceManual: string;
}

interface UseMemberIssueColumnsArgs {
  translations: MemberIssuesColumnsTranslations;
  projectId: number;
  /** Row-actions slot — the unlink action is wired in 18-07. */
  renderRowActions?: (row: ExtendedMemberIssue) => React.ReactNode;
}

/**
 * Column defs for the Member Issues table (MLINK-04, D-07), mirroring
 * `useIssueColumns` from the project Issues page (columns.tsx).
 */
export function useMemberIssueColumns({
  translations,
  projectId,
  renderRowActions,
}: UseMemberIssueColumnsArgs): ColumnDef<ExtendedMemberIssue>[] {
  const {
    selectRow: tSelectRow,
    key: tKey,
    description: tDescription,
    status: tStatus,
    coverage: tCoverage,
    source: tSource,
    sourceSynced: tSourceSynced,
    sourceManual: tSourceManual,
  } = translations;

  return useMemo(() => {
    const columns: ColumnDef<ExtendedMemberIssue>[] = [
      {
        id: "select",
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 36,
        minSize: 36,
        maxSize: 36,
        header: ({ table }) => (
          <Checkbox
            data-testid="member-issues-select-all-rows"
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) =>
              table.toggleAllRowsSelected(value === true)
            }
            aria-label={tSelectRow}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            data-testid="member-issue-row-select"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label={tSelectRow}
          />
        ),
      },
      {
        id: "key",
        accessorKey: "issue.name",
        accessorFn: (row) => row.issue?.name ?? "",
        header: tKey,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 300,
        minSize: 150,
        maxSize: 600,
        cell: ({ row, column }) => {
          const issue = row.original.issue;
          if (!issue) return <span className="text-muted-foreground">-</span>;
          return (
            <div
              data-row-id={issue.id}
              style={{ maxWidth: column.getSize() }}
              className="overflow-hidden"
            >
              <IssuesDisplay
                id={issue.id}
                name={issue.name}
                externalId={issue.externalId}
                externalUrl={resolveMemberIssueUrl(issue)}
                title={issue.title}
                description={issue.description}
                status={issue.externalStatus}
                priority={issue.priority}
                lastSyncedAt={issue.lastSyncedAt}
                projectIds={[projectId]}
                size="small"
                data={issue.data}
                integrationProvider={issue.integration?.provider}
                integrationId={issue.integration?.id}
                issueTypeName={issue.issueTypeName}
                issueTypeIconUrl={issue.issueTypeIconUrl}
              />
            </div>
          );
        },
      },
      {
        id: "description",
        accessorKey: "issue.description",
        accessorFn: (row) => stripHtmlTags(row.issue?.description),
        header: tDescription,
        enableSorting: false,
        enableResizing: true,
        size: 300,
        minSize: 150,
        maxSize: 600,
        cell: ({ row, column }) => {
          const description = row.original.issue?.description;
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
                      className="text-sm [&_a]:text-primary [&_a]:underline [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:ms-4 [&_ol]:list-decimal [&_ol]:ms-4"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(description!, {
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
        accessorKey: "issue.externalStatus",
        accessorFn: (row) => row.issue?.externalStatus ?? row.issue?.status ?? "",
        header: tStatus,
        enableSorting: true,
        enableResizing: true,
        size: 120,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => {
          const issue = row.original.issue;
          // Live status chip (D-02): reads the stored externalStatus, which
          // rides the sync — no extra per-panel status refresh.
          const status = issue?.externalStatus ?? issue?.status ?? null;
          return <IssueStatusDisplay status={status} className="capitalize" />;
        },
      },
      {
        id: "coverage",
        accessorKey: "coverage",
        accessorFn: (row) => coverageSortValue(row.coverage),
        header: tCoverage,
        enableSorting: true,
        enableResizing: true,
        size: 260,
        minSize: 150,
        maxSize: 420,
        cell: ({ row }) => <CoverageChip breakdown={row.original.coverage} />,
      },
      {
        id: "source",
        accessorKey: "source",
        accessorFn: (row) => row.source ?? "",
        header: tSource,
        enableSorting: true,
        enableResizing: true,
        size: 100,
        minSize: 80,
        maxSize: 160,
        cell: ({ row }) => {
          const source = row.original.source;
          return (
            <Badge variant={source === "SYNCED" ? "secondary" : "outline"}>
              {source === "SYNCED" ? tSourceSynced : tSourceManual}
            </Badge>
          );
        },
      },
    ];

    if (renderRowActions) {
      columns.push({
        id: "actions",
        header: "",
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 60,
        minSize: 50,
        maxSize: 80,
        cell: ({ row }) => renderRowActions(row.original),
      });
    }

    return columns;
  }, [
    tSelectRow,
    tKey,
    tDescription,
    tStatus,
    tCoverage,
    tSource,
    tSourceSynced,
    tSourceManual,
    projectId,
    renderRowActions,
  ]);
}
