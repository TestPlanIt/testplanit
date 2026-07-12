"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { Bug } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMilestoneSummary } from "~/hooks/useMilestoneSummary";
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
  /**
   * Extra classes for the card shell — the milestone detail page passes its
   * completed-state tint so this card matches the outer milestone card.
   */
  className?: string;
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
  function IssuesCard({ milestoneId, projectId, className }, ref) {
    const tCommon = useTranslations("common");
    const cardRef = useRef<HTMLDivElement>(null);
    // Section wrappers (NOT the keyed children) so each chip scrolls to its
    // own accordion trigger — the wrappers survive the force-expand key bump
    // below, keeping the scroll target stable across the remount.
    const inScopeRef = useRef<HTMLDivElement>(null);
    const foundInTestingRef = useRef<HTMLDivElement>(null);
    const [memberIssueIds, setMemberIssueIds] = useState<number[]>([]);
    // Distinct issue total for the header — the union of "In scope" member
    // issues and "Found in testing" issues, deduped by id since a single issue
    // can appear in both sections. Reuses the shared milestone-summary query
    // the "Found in testing" section already fetches, so it costs no extra
    // request.
    const { data: summaryData } = useMilestoneSummary(milestoneId);
    const totalIssueCount = useMemo(() => {
      const ids = new Set<number>(memberIssueIds);
      for (const issue of summaryData?.issues ?? []) {
        ids.add(issue.id);
      }
      return ids.size;
    }, [memberIssueIds, summaryData]);
    // Bumped to force-expand a section (and re-persist the new open state)
    // when a summary chip is clicked while that section is collapsed.
    const [forceOpen, setForceOpen] = useState<{
      inScope: number;
      foundInTesting: number;
    }>({ inScope: 0, foundInTesting: 0 });

    // jsdom (unit tests) has no scrollIntoView implementation — guard so the
    // imperative handle stays callable in that environment instead of
    // throwing before the localStorage/expand side effects run.
    const scrollToSection = (target: HTMLDivElement | null) => {
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    useImperativeHandle(ref, () => ({
      expandInScope: () => {
        try {
          window.localStorage.setItem(IN_SCOPE_COLLAPSED_KEY, "false");
        } catch {
          // Persistence is best-effort.
        }
        setForceOpen((prev) => ({ ...prev, inScope: prev.inScope + 1 }));
        scrollToSection(inScopeRef.current);
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
        scrollToSection(foundInTestingRef.current);
      },
    }));

    return (
      <Card ref={cardRef} data-testid="issues-card" className={className}>
        <div className="px-6 pt-6">
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            {tCommon("labels.issues", { count: totalIssueCount })}
          </CardTitle>
        </div>
        <div className="divide-y">
          <div ref={inScopeRef} className="scroll-mt-16">
            <MemberIssuesTable
              key={`in-scope-${forceOpen.inScope}`}
              milestoneId={milestoneId}
              projectId={projectId}
              onMemberIssueIdsChange={setMemberIssueIds}
            />
          </div>
          <div ref={foundInTestingRef} className="scroll-mt-16">
            <FoundInTestingIssues
              key={`found-in-testing-${forceOpen.foundInTesting}`}
              milestoneId={milestoneId}
              memberIssueIds={memberIssueIds}
            />
          </div>
        </div>
      </Card>
    );
  }
);
