"use client";

import { ListChecks } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { DateFormatter } from "@/components/DateFormatter";
import LoadingSpinner from "@/components/LoadingSpinner";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
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
import { Link } from "~/lib/navigation";

interface RequirementCoveragePanelProps {
  projectId: string;
  requirementId: number;
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
}: RequirementCoveragePanelProps) {
  const t = useTranslations("requirements.coverage");

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
    requirementId
  );

  const rows = data?.cases ?? [];

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnCase")}</TableHead>
                {/* Reuses the badge's own `inherited` key rather than minting
                    a second key holding the same word. Kept adjacent to the
                    case name, where the flag used to sit, so the association
                    survives the move out of that cell. */}
                <TableHead className="w-[100px] text-center">
                  {t("inherited")}
                </TableHead>
                <TableHead>{t("columnResult")}</TableHead>
                {/* Date AND time now, so the column needs room for both --
                    paired with `whitespace-nowrap` on the cell below, which
                    keeps the value on one line instead of wrapping. */}
                <TableHead className="w-[180px]">
                  {t("columnExecutedAt")}
                </TableHead>
                <TableHead>{t("columnProject")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // Every row shows its case's OWN project (operator decision
                // 2026-08-25): a uniform Project column reads better than the
                // old cross-project-only badge, which left same-project cells
                // empty. Cross-project rows stay distinct because their links
                // lead out of this project.
                return (
                  <TableRow
                    key={row.caseId}
                    data-testid={`requirement-covering-case-${row.caseId}`}
                  >
                    <TableCell>
                      {/* The case's OWN project, never the requirement's
                          -- a cross-project case must link into its own
                          repository. */}
                      <TestCaseNameDisplay
                        testCase={{ id: row.caseId, name: row.caseName }}
                        projectId={row.projectId}
                        className="font-medium"
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
                      {row.lastTestRunId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={`/projects/runs/${row.projectId}/${row.lastTestRunId}?selectedCase=${row.caseId}`}
                              className="inline-flex hover:underline"
                              data-testid={`requirement-covering-case-run-link-${row.caseId}`}
                            >
                              <StatusDotDisplay
                                name={row.lastStatusName ?? t("notRunCell")}
                                color={row.lastStatusColor ?? undefined}
                              />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>{t("resultRunLink")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <StatusDotDisplay
                          name={row.lastStatusName ?? t("notRunCell")}
                          color={row.lastStatusColor ?? undefined}
                        />
                      )}
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
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default RequirementCoveragePanel;
