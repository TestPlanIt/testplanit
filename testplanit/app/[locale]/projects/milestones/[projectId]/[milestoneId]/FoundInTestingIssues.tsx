"use client";

import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2 } from "lucide-react";
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
              {t("foundInTesting")}
              {!isLoading && (
                <Badge variant="secondary" data-testid="found-in-testing-count">
                  {issues.length}
                </Badge>
              )}
              {isLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {tMilestones("summary.includesChildMilestones")}
          </p>
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
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="found-in-testing-list"
              >
                {issues.map((issue) => {
                  const isInScope = memberIssueIdSet.has(issue.id);
                  return (
                    <div
                      key={issue.id}
                      className="relative inline-flex"
                      data-testid="found-in-testing-row"
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
                        integrationId={
                          issue.integrationId || issue.integration?.id
                        }
                      />
                      {isInScope && (
                        <Badge
                          variant="outline"
                          className="ms-1 text-[10px] px-1 py-0 self-center text-muted-foreground"
                          data-testid="found-in-testing-in-scope-badge"
                        >
                          {t("inScopeCrossBadge")}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
