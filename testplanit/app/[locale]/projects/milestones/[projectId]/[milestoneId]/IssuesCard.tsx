"use client";

import { CollapsibleSection } from "~/components/CollapsibleSection";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Bug } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  type RefObject,
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
    // Section wrappers (NOT the keyed children) so each chip scrolls to its
    // own accordion trigger — the wrappers survive the force-expand key bump
    // below, keeping the scroll target stable across the remount.
    const inScopeRef = useRef<HTMLDivElement>(null);
    const foundInTestingRef = useRef<HTMLDivElement>(null);
    // "In scope" member issueIds are fetched HERE, not reported up from
    // MemberIssuesTable — a collapsed accordion unmounts its content, so the
    // header total must not depend on the table being mounted. ZenStack's
    // milestoneIssue mutation hooks (link/unlink) invalidate this query, so
    // it stays in sync with the table while the card is open.
    const { data: memberIssueRows } = useClientQueries(
      schema
    ).milestoneIssue.useFindMany({
      where: { milestoneId },
      select: { issueId: true },
    });
    const memberIssueIds = useMemo(
      () => (memberIssueRows ?? []).map((row) => row.issueId),
      [memberIssueRows]
    );
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
    // Bumped to force-open the OUTER Issues accordion — a collapsed accordion
    // unmounts its content, so a chip must reopen the card before its section
    // is reachable.
    const [issuesOpenSignal, setIssuesOpenSignal] = useState(0);

    // Defer the scroll: opening the accordion re-mounts its content on the next
    // render, so the section wrapper isn't in the DOM yet when the chip fires.
    // jsdom (unit tests) has no scrollIntoView — the optional chaining guards it.
    const scrollToSection = (target: RefObject<HTMLDivElement | null>) => {
      setTimeout(() => {
        target.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        });
      }, 120);
    };

    useImperativeHandle(ref, () => ({
      expandInScope: () => {
        try {
          window.localStorage.setItem(IN_SCOPE_COLLAPSED_KEY, "false");
        } catch {
          // Persistence is best-effort.
        }
        setIssuesOpenSignal((n) => n + 1);
        setForceOpen((prev) => ({ ...prev, inScope: prev.inScope + 1 }));
        scrollToSection(inScopeRef);
      },
      expandFoundInTesting: () => {
        try {
          window.localStorage.setItem(FOUND_IN_TESTING_COLLAPSED_KEY, "false");
        } catch {
          // Persistence is best-effort.
        }
        setIssuesOpenSignal((n) => n + 1);
        setForceOpen((prev) => ({
          ...prev,
          foundInTesting: prev.foundInTesting + 1,
        }));
        scrollToSection(foundInTestingRef);
      },
    }));

    return (
      <CollapsibleSection
        data-testid="issues-card"
        className={className}
        storageKey="tpi.milestone.issues.collapsed"
        icon={<Bug className="h-5 w-5" />}
        title={tCommon("labels.issues", { count: totalIssueCount })}
        contentClassName="p-0"
        openSignal={issuesOpenSignal}
      >
        <div className="divide-y">
          <div ref={inScopeRef} className="scroll-mt-16">
            <MemberIssuesTable
              key={`in-scope-${forceOpen.inScope}`}
              milestoneId={milestoneId}
              projectId={projectId}
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
      </CollapsibleSection>
    );
  }
);
