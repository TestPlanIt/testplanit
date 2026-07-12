"use client";

import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Badge } from "@/components/ui/badge";
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

const FOUND_IN_TESTING_COLLAPSED_KEY = "tpi.milestone.foundInTesting.collapsed";

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
              />
            </div>
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
