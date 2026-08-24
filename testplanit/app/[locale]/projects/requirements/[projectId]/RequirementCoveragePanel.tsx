"use client";

import { ListChecks } from "lucide-react";
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
import {
  coverageFor,
  useRequirementCoverage,
} from "~/hooks/useRequirementCoverage";
import { useRequirementCoveringCases } from "~/hooks/useRequirementCoveringCases";

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

  const { data, isLoading, isError, refetch } = useRequirementCoveringCases(
    Number(projectId),
    requirementId
  );

  // Free read -- the tree above this panel already fetches project-wide
  // coverage through this exact hook, whose stable
  // `["requirementCoverage", projectId]` query key plus `staleTime: 30000`
  // means this call shares that one cache entry rather than firing a
  // second request. This is the situation `useMilestoneSummary.ts:4-10`
  // documents `staleTime` for.
  const { data: coverageData } = useRequirementCoverage(Number(projectId));
  const breakdown = coverageFor(coverageData, requirementId);
  const crossProjectCaseCount = breakdown?.crossProjectCaseCount ?? 0;

  const rows = data?.cases ?? [];

  return (
    <Card shadow="none" data-testid="requirement-coverage">
      <CardHeader className="p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="w-5 h-5" />
            {t("panelTitle")}
          </CardTitle>
          {/* Keeps the two counts unblended, per the Milestones precedent
              (`OtherProjectCasesTotal`): nothing renders at <= 0, otherwise
              an outlined affordance, so the project-scoped rows above never
              read as though they already included another project's. */}
          {crossProjectCaseCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  data-testid="requirement-coverage-cross-project-count"
                >
                  {`+${crossProjectCaseCount}`}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("crossProjectCount", { count: crossProjectCaseCount })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <CardDescription>{t("panelDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-4">
            <LoadingSpinner />
          </div>
        ) : isError ? (
          // F6: a failed fetch must never be rendered as "no covering
          // cases" -- that is exactly the false claim
          // `RequirementCoverageBadge.tsx`'s own "not loaded yet (or
          // failed to load) renders nothing" rule exists to prevent for
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
                <TableHead>{t("columnResult")}</TableHead>
                <TableHead>{t("columnExecutedAt")}</TableHead>
                <TableHead>{t("columnProject")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // Cross-project is judged against the requirement's OWN
                // project, never the case's -- a case that lives in the
                // same project as the requirement never shows a badge,
                // matching `LinkedRequirementCasesPanel`'s own convention.
                const crossProject = row.projectId !== Number(projectId);
                return (
                  <TableRow
                    key={row.caseId}
                    data-testid={`requirement-covering-case-${row.caseId}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {/* The case's OWN project, never the requirement's
                            -- a cross-project case must link into its own
                            repository. */}
                        <TestCaseNameDisplay
                          testCase={{ id: row.caseId, name: row.caseName }}
                          projectId={row.projectId}
                          className="font-medium"
                        />
                        {!row.direct && (
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
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusDotDisplay
                        name={row.lastStatusName ?? t("notRunCell")}
                        color={row.lastStatusColor ?? undefined}
                      />
                    </TableCell>
                    <TableCell>
                      {row.lastExecutedAt ? (
                        <DateFormatter date={row.lastExecutedAt} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {crossProject && (
                        <ProjectNameDisplay
                          projectName={row.projectName}
                          projectId={row.projectId}
                          showLink
                          fitContainer
                          className="text-xs text-muted-foreground"
                        />
                      )}
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
