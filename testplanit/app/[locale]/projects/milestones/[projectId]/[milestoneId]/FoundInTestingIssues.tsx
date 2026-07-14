"use client";

import DOMPurify from "dompurify";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { Bug, ChevronDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { MilestoneIssue } from "~/lib/services/milestoneSummary";
import { useMilestoneSummary } from "~/hooks/useMilestoneSummary";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  COMPLETED_CARD_PINNED_HEADER_STYLE,
  COMPLETED_CARD_PINNED_STYLE,
} from "./MemberIssuesColumns";

const FOUND_IN_TESTING_COLLAPSED_KEY = "tpi.milestone.foundInTesting.collapsed";

/** Plain-text preview of an issue's (possibly HTML) description. */
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

interface FoundInTestingIssuesProps {
  milestoneId: number;
  // Member ("in scope") issueIds reported up by the sibling section — used
  // to compute the "In scope" cross-badge on overlapping rows.
  memberIssueIds: number[];
}

/**
 * "Found in testing" accordion section of the Issues card (D-16 vocabulary):
 * a read-only, descendant-inclusive rollup of issues linked to test runs,
 * sessions, and session results within this milestone's tree. Reuses the
 * SAME summary query MilestoneSummary fetches (`["milestoneSummary",
 * milestoneId]`) — no duplicate request. Distinct from the sibling
 * "In scope" section (MemberIssuesTable), which is this-milestone-only
 * `MilestoneIssue` links (D-15).
 */
export function FoundInTestingIssues({
  milestoneId,
  memberIssueIds,
}: FoundInTestingIssuesProps) {
  const t = useTranslations("milestones.members");
  const tMilestones = useTranslations("milestones");

  const { data: summaryData, isLoading } = useMilestoneSummary(milestoneId);
  const issues: MilestoneIssue[] = summaryData?.issues ?? [];

  // Completed milestones render in a tinted card; pinned columns must match it.
  const { data: milestoneRow } = useClientQueries(
    schema
  ).milestones.useFindFirst({
    where: { id: milestoneId },
    select: { isCompleted: true },
  });

  const memberIssueIdSet = useMemo(
    () => new Set(memberIssueIds),
    [memberIssueIds]
  );

  // Same table chrome as the sibling "In scope" section (MemberIssuesTable)
  // — read-only columns, local sort, no selection/actions.
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "key", direction: "asc" });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const sortedIssues = useMemo(() => {
    const rows = [...issues];
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortConfig.column === "inScope") {
        const av = memberIssueIdSet.has(a.id) ? 1 : 0;
        const bv = memberIssueIdSet.has(b.id) ? 1 : 0;
        return (av - bv) * dir;
      }
      const av =
        sortConfig.column === "status"
          ? (a.externalStatus ?? "")
          : (a.name ?? "");
      const bv =
        sortConfig.column === "status"
          ? (b.externalStatus ?? "")
          : (b.name ?? "");
      return av.localeCompare(bv) * dir;
    });
    return rows;
  }, [issues, sortConfig, memberIssueIdSet]);

  const columns = useMemo<ColumnDef<MilestoneIssue>[]>(
    () => [
      {
        id: "key",
        accessorFn: (row) => row.name ?? "",
        header: t("columnKey"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 300,
        minSize: 150,
        maxSize: 600,
        cell: ({ row, column }) => {
          const issue = row.original;
          return (
            <div
              style={{ maxWidth: column.getSize() }}
              className="overflow-hidden"
            >
              <IssuesDisplay
                id={issue.id}
                name={issue.name}
                externalId={issue.externalId}
                externalUrl={issue.externalUrl}
                title={issue.title}
                status={issue.externalStatus}
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
            </div>
          );
        },
      },
      {
        id: "description",
        accessorFn: (row) => stripHtmlTags(row.description),
        header: t("columnDescription"),
        enableSorting: false,
        enableResizing: true,
        size: 300,
        minSize: 150,
        maxSize: 600,
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
                  <h4 className="font-semibold text-sm">
                    {t("columnDescription")}
                  </h4>
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
        accessorFn: (row) => row.externalStatus ?? "",
        header: t("columnStatus"),
        enableSorting: true,
        enableResizing: true,
        size: 120,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => (
          <IssueStatusDisplay
            status={row.original.externalStatus ?? null}
            className="capitalize"
          />
        ),
      },
      {
        id: "inScope",
        accessorFn: (row) => (memberIssueIdSet.has(row.id) ? 1 : 0),
        header: t("inScopeCrossBadge"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        minSize: 80,
        maxSize: 160,
        cell: ({ row }) =>
          memberIssueIdSet.has(row.original.id) ? (
            <Badge
              variant="outline"
              className="text-muted-foreground"
              data-testid="found-in-testing-in-scope-badge"
            >
              {t("inScopeCrossBadge")}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
    ],
    [t, memberIssueIdSet]
  );

  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    try {
      setIsCollapsed(
        window.localStorage.getItem(FOUND_IN_TESTING_COLLAPSED_KEY) === "true"
      );
    } catch {
      // localStorage unavailable (private mode etc.) — stay expanded.
    }
  }, []);
  const handleCollapsedChange = (open: boolean) => {
    setIsCollapsed(!open);
    try {
      window.localStorage.setItem(
        FOUND_IN_TESTING_COLLAPSED_KEY,
        String(!open)
      );
    } catch {
      // Persistence is best-effort.
    }
  };

  return (
    <div data-testid="found-in-testing-section">
      <Collapsible open={!isCollapsed} onOpenChange={handleCollapsedChange}>
        <div className="flex flex-col space-y-1.5 px-6 py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold leading-none tracking-tight">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground"
                  aria-expanded={!isCollapsed}
                  aria-label={t("foundInTesting")}
                  data-testid="found-in-testing-collapse-toggle"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isCollapsed ? "-rotate-90" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
              <Bug className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex items-center gap-1.5">
                {!isLoading && (
                  <span data-testid="found-in-testing-count">
                    {issues.length}
                  </span>
                )}
                {t("foundInTesting")}
              </span>
              {!isLoading && (
                <p className="text-xs text-muted-foreground">
                  {tMilestones("summary.includesChildMilestones")}
                </p>
              )}
              {isLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
        </div>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-slide-down data-[state=closed]:animate-slide-up">
          <div className="px-6 pb-6">
            {!isLoading && issues.length === 0 ? (
              <div
                className="text-sm text-muted-foreground py-8 text-center"
                data-testid="found-in-testing-empty"
              >
                {t("foundInTestingEmpty")}
              </div>
            ) : (
              <VirtualizedDataTable
                columns={columns as any}
                data={sortedIssues as any}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                sortConfig={sortConfig}
                onSortChange={handleSortChange}
                enableColumnPinning
                pinnedColumnStyle={
                  milestoneRow?.isCompleted
                    ? COMPLETED_CARD_PINNED_STYLE
                    : undefined
                }
                pinnedHeaderStyle={
                  milestoneRow?.isCompleted
                    ? COMPLETED_CARD_PINNED_HEADER_STYLE
                    : undefined
                }
                hasMore={false}
                isLoading={isLoading}
                getRowId={(row: MilestoneIssue) => String(row.id)}
                estimateSize={56}
                resetKey={`${sortConfig.column}|${sortConfig.direction}`}
                testIdPrefix="found-in-testing-table"
                rowTestIdPrefix="found-in-testing-row"
              />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
