"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { FoundInTestingIssues } from "./FoundInTestingIssues";
import { MemberIssuesTable } from "./MemberIssuesTable";

const IN_SCOPE_COLLAPSED_KEY = "tpi.milestone.memberIssues.collapsed";
const FOUND_IN_TESTING_COLLAPSED_KEY = "tpi.milestone.foundInTesting.collapsed";

export interface IssuesCardHandle {
  /** Scrolls to the card and expands the "In scope" section. */
  expandInScope: () => void;
  /** Scrolls to the card and expands the "Found in testing" section. */
  expandFoundInTesting: () => void;
}

interface IssuesCardProps {
  milestoneId: number;
  projectId: number;
}

/**
 * Single "Issues" card for the milestone detail page, pairing two
 * independently collapsible sections that used to be separate, confusingly
 * same-named surfaces (D-16 vocabulary gap): "In scope" (MilestoneIssue
 * links, this-milestone-only, D-15) and "Found in testing" (defects
 * surfaced by test runs/sessions, descendant-inclusive). Each section owns
 * its own Collapsible + localStorage key; this component only supplies the
 * shared card chrome and the imperative scroll+expand entry points used by
 * MilestoneSummary's count chips.
 */
export const IssuesCard = forwardRef<IssuesCardHandle, IssuesCardProps>(
  function IssuesCard({ milestoneId, projectId }, ref) {
    const t = useTranslations("milestones.members");
    const cardRef = useRef<HTMLDivElement>(null);
    const [memberIssueIds, setMemberIssueIds] = useState<number[]>([]);
    // Bumped to force-expand a section (and re-persist the new open state)
    // when a summary chip is clicked while that section is collapsed.
    const [forceOpen, setForceOpen] = useState<{
      inScope: number;
      foundInTesting: number;
    }>({ inScope: 0, foundInTesting: 0 });

    // jsdom (unit tests) has no scrollIntoView implementation — guard so the
    // imperative handle stays callable in that environment instead of
    // throwing before the localStorage/expand side effects run.
    const scrollToCard = () => {
      cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    useImperativeHandle(ref, () => ({
      expandInScope: () => {
        try {
          window.localStorage.setItem(IN_SCOPE_COLLAPSED_KEY, "false");
        } catch {
          // Persistence is best-effort.
        }
        setForceOpen((prev) => ({ ...prev, inScope: prev.inScope + 1 }));
        scrollToCard();
      },
      expandFoundInTesting: () => {
        try {
          window.localStorage.setItem(FOUND_IN_TESTING_COLLAPSED_KEY, "false");
        } catch {
          // Persistence is best-effort.
        }
        setForceOpen((prev) => ({
          ...prev,
          foundInTesting: prev.foundInTesting + 1,
        }));
        scrollToCard();
      },
    }));

    return (
      <Card ref={cardRef} data-testid="issues-card">
        <div className="px-6 pt-6">
          <CardTitle>{t("cardTitle")}</CardTitle>
        </div>
        <div className="divide-y">
          <MemberIssuesTable
            key={`in-scope-${forceOpen.inScope}`}
            milestoneId={milestoneId}
            projectId={projectId}
            onMemberIssueIdsChange={setMemberIssueIds}
          />
          <FoundInTestingIssues
            key={`found-in-testing-${forceOpen.foundInTesting}`}
            milestoneId={milestoneId}
            memberIssueIds={memberIssueIds}
          />
        </div>
      </Card>
    );
  }
);
