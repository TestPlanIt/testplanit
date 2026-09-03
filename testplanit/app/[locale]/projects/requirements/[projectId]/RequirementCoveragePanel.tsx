"use client";
/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx). */

import { useVirtualizer } from "@tanstack/react-virtual";
import { HelpCircle, ListChecks } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { DateFormatter } from "@/components/DateFormatter";
import LoadingSpinner from "@/components/LoadingSpinner";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { CaseResultStatus } from "@/components/tables/CaseResultStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRequirementCoveringCases } from "~/hooks/useRequirementCoveringCases";
import type { RequirementExecutionScopeSelection } from "~/utils/requirementExecutionScope";

interface RequirementCoveragePanelProps {
  projectId: string;
  requirementId: number;
  /** The workspace's coverage execution scope — the drill-down lists with
   *  the same frame the rollup above it counted with. Absent = unscoped. */
  executionScope?: RequirementExecutionScopeSelection;
}

/**
 * The read-only counterpart to `LinkedRequirementCasesPanel`. That panel
 * lists only the test cases *directly* linked to this exact requirement
 * (`RepositoryCaseIssue` rows) and offers link/unlink on each one. This
 * panel instead lists the *subtree superset* `useRequirementCoveringCases`
 * returns -- every case covering this requirement OR any descendant beneath
 * it, decorated with `direct` so an inherited row (reached only through a
 * descendant) can be marked as such. The two sets are not interchangeable:
 * merging them naively would put an unlink control on an inherited row that
 * either silently does nothing (the row has no direct `RepositoryCaseIssue`
 * to remove) or, worse, unlinks the wrong requirement's link. This panel is
 * therefore strictly read-only -- no link, no unlink, no mutation of any
 * kind -- and `LinkedRequirementCasesPanel` keeps sole ownership of that
 * capability, unchanged, below it.
 */
export function RequirementCoveragePanel({
  projectId,
  requirementId,
  executionScope,
}: RequirementCoveragePanelProps) {
  const t = useTranslations("requirements.coverage");
  const tCommon = useTranslations("common");

  // "Executed At" is an instant, so it renders date AND time in the viewer's
  // preferred formats and zone -- the same session-preference recipe the
  // requirements list's own "Created At" column uses; "PPp" is the
  // no-preference datetime fallback.
  const { data: session } = useSession();
  const preferredDateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : "PPp";
  const preferredTimezone = session?.user?.preferences?.timezone || undefined;

  const { data, isLoading, isError, refetch } = useRequirementCoveringCases(
    Number(projectId),
    requirementId,
    executionScope
  );

  const rows = data?.cases ?? [];

  // Virtualized rows, the way the rest of the app handles a list with no
  // natural ceiling (`components/matrix/MatrixGrid.tsx` is the
  // container-scrolled precedent). A root requirement gathers every case in
  // its whole subtree, so this set reaches the thousands on a real project,
  // and rendering all of them in one pass is what froze this pane on
  // selection and again on every later re-render. Nothing is held back --
  // the scroll container owns the height, the virtualizer owns what is
  // mounted, and the panel still lists the entire covering set.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 45,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  // Spacer rows rather than absolute positioning: this keeps real <table>
  // semantics and the auto column widths the table already relies on,
  // instead of re-implementing both on positioned divs.
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <Card shadow="none" data-testid="requirement-coverage">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="w-5 h-5" />
          {/* Counts every row listed below, which is the whole covering set
              -- cases in other projects included, each naming its own
              project in the Project column. Nothing is summarized away, so
              no second count rides alongside this one. The key's own `=0`
              branch falls back to the bare title, which is what a
              still-loading, failed, or genuinely empty panel wants. */}
          {t("panelTitleWithCount", { count: rows.length })}
        </CardTitle>
        <CardDescription>{t("panelDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-4">
            <LoadingSpinner />
          </div>
        ) : isError ? (
          // F6: a failed fetch must never be rendered as "no covering
          // cases" -- that is exactly the false claim the requirements
          // list's coverage cell's own "not loaded yet (or failed to load)
          // renders nothing" rule exists to prevent for
          // the sibling coverage query. This branch keeps that same
          // instinct: visually and semantically distinct from
          // `panelEmpty` below, reusing the datasets-list.tsx error/retry
          // idiom (destructive message + an outline retry button wired to
          // the query's own `refetch`) rather than inventing a new one.
          <div
            className="flex flex-col items-center justify-center gap-3 py-8 text-center"
            data-testid="requirement-coverage-error"
          >
            <p className="text-sm text-destructive">{t("loadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          // Absence is the normal, expected result for a requirement with
          // no covering cases -- not an error, not "still loading." Never
          // rendered while `isLoading` or `isError` is true (the branches
          // above own those), so this can never be mistaken for a pending
          // or failed fetch.
          <div className="text-muted-foreground ms-4 -mt-2 mb-4 text-sm">
            {t("panelEmpty")}
          </div>
        ) : (
          // The virtualizer's viewport. Without a bounded, scrollable
          // ancestor it would measure zero and mount nothing.
          <div ref={scrollRef} className="max-h-[32rem] overflow-auto">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">{t("columnCase")}</TableHead>
                  {/* Reuses the badge's own `inherited` key rather than minting
                    a second key holding the same word. Kept adjacent to the
                    case name, where the flag used to sit, so the association
                    survives the move out of that cell. */}
                  <TableHead className="w-[100px] truncate text-center">
                    {t("inherited")}
                  </TableHead>
                  {/* This column and the repository list's Latest Results
                    answer two deliberately different questions
                    (lib/services/latestCaseResults.ts vs
                    latestTestResults.ts, each header says why): coverage
                    takes the most recent execution even when its status
                    carries no pass/fail, so a skipped run can never let an
                    older pass stand as coverage; the other surfaces walk
                    back to the newest result that did carry one. Same case,
                    two readings — this tooltip is the one place the UI
                    explains the difference. */}
                  <TableHead className="w-[140px]">
                    <span className="flex items-center gap-1">
                      <span className="truncate">{t("columnResult")}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            aria-label={tCommon("aria.help")}
                            className="inline-flex shrink-0"
                            data-testid="requirement-coverage-result-help"
                          >
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {t("columnResultTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                  {/* Date AND time now, so the column needs room for both --
                    paired with `whitespace-nowrap` on the cell below, which
                    keeps the value on one line instead of wrapping. */}
                  <TableHead className="w-[180px] truncate">
                    {t("columnExecutedAt")}
                  </TableHead>
                  <TableHead className="w-[140px] truncate">
                    {t("columnProject")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paddingTop > 0 && (
                  <tr aria-hidden style={{ height: paddingTop }} />
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  // Every row shows its case's OWN project (operator decision
                  // 2026-08-25): a uniform Project column reads better than the
                  // old cross-project-only badge, which left same-project cells
                  // empty. Cross-project rows stay distinct because their links
                  // lead out of this project.
                  return (
                    <TableRow
                      key={row.caseId}
                      // Measured, not estimated: a clamped name still leaves
                      // one- and two-line rows, so a fixed estimate makes the
                      // scrollbar lie and the list settle at the bottom.
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-testid={`requirement-covering-case-${row.caseId}`}
                    >
                      <TableCell>
                        {/* The case's OWN project, never the requirement's
                          -- a cross-project case must link into its own
                          repository. */}
                        <CaseDisplay
                          testCase={{ id: row.caseId, name: row.caseName }}
                          projectId={row.projectId}
                          className="font-medium line-clamp-2"
                        />
                      </TableCell>
                      <TableCell className="w-[120px] text-center">
                        {/* A direct row gets the same em dash the Executed At
                          column uses for "nothing to show here", rather than
                          a blank cell that reads as missing data or a
                          "Direct" badge competing with this one for
                          attention. */}
                        {row.direct ? (
                          "—"
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                data-testid={`requirement-covering-case-inherited-${row.caseId}`}
                              >
                                {t("inherited")}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("inheritedTooltip")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Links to the run this exact result was recorded
                          against, the same destination (and `selectedCase`
                          param) the repository list's own Latest Results
                          squares use. The run id rides along on the row from
                          the shared latest-result fragment, so the link can
                          never point at a different execution than the status
                          beside it. A never-executed case has no run to open,
                          and renders the bare status. */}
                        <CaseResultStatus
                          caseId={row.caseId}
                          statusName={row.lastStatusName}
                          statusColor={row.lastStatusColor}
                          testRunId={row.lastTestRunId}
                          projectId={row.projectId}
                          linkTestId={`requirement-covering-case-run-link-${row.caseId}`}
                        />
                      </TableCell>
                      <TableCell className="w-[180px] whitespace-nowrap">
                        {row.lastExecutedAt ? (
                          <DateFormatter
                            date={row.lastExecutedAt}
                            formatString={preferredDateTimeFormat}
                            timezone={preferredTimezone}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Auto-layout table: no column width bounds this
                          cell, so `fitContainer`'s `max-w-full` resolves
                          against content and a long project name widens the
                          table instead of truncating. The cap is that bound;
                          the full name stays reachable via the display's own
                          tooltip. */}
                        <div className="max-w-[180px]">
                          <ProjectNameDisplay
                            projectName={row.projectName}
                            projectId={row.projectId}
                            showLink
                            fitContainer
                            className="text-xs text-muted-foreground"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden style={{ height: paddingBottom }} />
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default RequirementCoveragePanel;
