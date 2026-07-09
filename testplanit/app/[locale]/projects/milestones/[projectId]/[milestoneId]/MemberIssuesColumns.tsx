import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { Badge } from "@/components/ui/badge";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type {
  Integration,
  Issue,
  MilestoneIssue as MilestoneIssueRow,
} from "~/zenstack/models";
import { buildSimpleUrlLink } from "~/lib/integrations/simpleUrl";
import { CoverageBreakdown, CoverageChip } from "./CoverageChip";

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
  key: string;
  title: string;
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
    key: tKey,
    title: tTitle,
    status: tStatus,
    coverage: tCoverage,
    source: tSource,
    sourceSynced: tSourceSynced,
    sourceManual: tSourceManual,
  } = translations;

  return useMemo(() => {
    const columns: ColumnDef<ExtendedMemberIssue>[] = [
      {
        id: "key",
        accessorKey: "issue.name",
        accessorFn: (row) => row.issue?.name ?? "",
        header: tKey,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 160,
        minSize: 100,
        maxSize: 320,
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
        id: "title",
        accessorKey: "issue.title",
        accessorFn: (row) => row.issue?.title ?? "",
        header: tTitle,
        enableSorting: true,
        enableResizing: true,
        size: 300,
        minSize: 150,
        maxSize: 600,
        cell: ({ row, column }) => {
          const title = row.original.issue?.title;
          if (!title) return <span className="text-muted-foreground">-</span>;
          return (
            <div
              className="line-clamp-2 overflow-hidden text-ellipsis text-sm"
              style={{ maxWidth: column.getSize() }}
              title={title}
            >
              {title}
            </div>
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
        accessorFn: (row) => (row.coverage?.uncovered ? -1 : (row.coverage?.linkedCaseCount ?? 0)),
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
    tKey,
    tTitle,
    tStatus,
    tCoverage,
    tSource,
    tSourceSynced,
    tSourceManual,
    projectId,
    renderRowActions,
  ]);
}
