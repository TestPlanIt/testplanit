"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import { RequirementBreadcrumb } from "@/components/requirements/RequirementBreadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isIssueBearingQueryKey } from "~/hooks/useIssueUpdateStream";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { invalidateRequirementCoverage } from "~/hooks/useRequirementCoverage";
import { useRequirementDescendantCount } from "~/hooks/useRequirementAncestors";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { Link, useRouter } from "~/lib/navigation";
import { schema } from "~/zenstack/schema";
import { DeleteRequirementModal } from "../DeleteRequirementModal";
import RequirementDetailPanel from "../RequirementDetailPanel";

/**
 * A single requirement on its own page — the standalone counterpart to the
 * workspace's detail panel, and the destination of the panel's "open full
 * page" link. Renders the SAME `RequirementDetailPanel` the panel does, so
 * this route is a wrapper rather than a second implementation (the pattern
 * `app/[locale]/projects/repository/[projectId]/[caseId]/page.tsx`
 * establishes for test cases).
 *
 * What this route must supply that the workspace otherwise owns:
 *
 * 1. The `requirementsEnabled` gate. Requirements is opt-in per project and
 *    the workspace gates on it three ways (loading / enabled / disabled)
 *    precisely because a bookmarked URL previously reached the feature on a
 *    project that had it switched off. A new URL-reachable route without the
 *    same gate would reintroduce exactly that. Fails CLOSED: while the flag
 *    query is in flight neither branch is known correct, so both stay hidden
 *    behind the spinner.
 * 2. Real not-found copy. Inside the workspace the panel can return null for
 *    an unknown id because the tree only ever selects a live one; a URL can
 *    address anything, so that branch becomes reachable here and a blank
 *    screen would be the wrong answer.
 *
 * Delete and the row menu's edit-mode request are deliberately absent: both
 * belong to the list (the delete dialog needs a descendant count only the
 * in-memory tree holds), and `RequirementDetailPanel` already treats both as
 * optional, hiding the Delete affordance when it has no route to that dialog.
 */
export default function RequirementDetailsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const requirementIdParam = params.requirementId as string;
  const t = useTranslations();

  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const parsed = Number(requirementIdParam);
  const requirementId = Number.isFinite(parsed) ? parsed : null;

  // Delete is gated on the SAME project-admin permission the workspace uses
  // to decide whether to hand the panel an `onRequestDelete` at all. The
  // panel deliberately never asks this question itself -- whichever surface
  // mounts it owns the answer, so that there is only ever one owner.
  const { isProjectAdmin: canAddEdit } = useProjectPermissions(
    Number(projectId)
  );

  // The confirmation dialog needs to say how many descendants go with the
  // root. In the workspace that number comes from the list's in-memory tree;
  // here it is rebuilt from the same rows with the same pure helpers.
  const { descendantCount, isLoading: isCountLoading } =
    useRequirementDescendantCount(Number(projectId), requirementId);

  const { data: project, isPending: isProjectFlagPending } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { requirementsEnabled: true },
    },
    { enabled: Boolean(projectId) && !isNaN(Number(projectId)) }
  );
  const requirementsEnabled = project?.requirementsEnabled === true;

  // Scoped read: `REQUIREMENT_SCOPE_WHERE` is what stops a defect id — or
  // another project's requirement id — from resolving through this route.
  const { data: requirement, isLoading } = useClientQueries(
    schema
  ).issue.useFindFirst(
    {
      where: {
        id: requirementId ?? -1,
        projectId: Number(projectId),
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      select: { id: true },
    },
    { enabled: requirementId != null && requirementsEnabled }
  );

  // `isDeleting` keeps the spinner up between a successful delete and the
  // route change landing. Without it the row is already gone, so the query
  // below resolves to null and the not-found card flashes on the way out --
  // telling the user their own delete "wasn't found" at the exact moment it
  // succeeded.
  if (isDeleting || isProjectFlagPending || (requirementsEnabled && isLoading)) {
    return (
      <div className="flex justify-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!requirementsEnabled) {
    return (
      <Card>
        <CardHeader data-testid="requirements-disabled-notice">
          <CardTitle>{t("requirements.disabled.title")}</CardTitle>
          <CardDescription>
            {t("requirements.disabled.description")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (requirementId == null || !requirement) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          {/* Carries no `?requirement=` -- the id that got here is exactly
              the one that does not resolve, so re-selecting it would land
              the tree back on nothing. */}
          <Button
            asChild
            variant="outline"
            size="icon"
            aria-label={t("common.aria.backToRequirements")}
            data-testid="requirement-details-back"
          >
            <Link href={`/projects/requirements/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <p
            className="text-sm text-muted-foreground"
            data-testid="requirement-not-found"
          >
            {t("requirements.detail.notFound")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main data-testid="requirement-details-page">
      <div className="mb-2">
        <RequirementBreadcrumb
          projectId={projectId}
          requirementId={requirementId}
          // Ancestors open back in the workspace with that ancestor
          // selected, rather than stranding the reader on another
          // single-requirement page with no tree.
          hrefForAncestor={(ancestorId) =>
            `/projects/requirements/${projectId}?requirement=${ancestorId}`
          }
        />
      </div>
      <RequirementDetailPanel
        projectId={projectId}
        requirementId={requirementId}
        // Returns to the tree with THIS requirement still selected, the same
        // way the test case page's back arrow returns to the repository with
        // its case selected. No folder equivalent is needed: the list expands
        // the selected requirement's ancestors on its own, so the id alone
        // restores the full context. The panel renders it inline with the
        // title -- see `backHref`.
        backHref={`/projects/requirements/${projectId}?requirement=${requirementId}`}
        // Delete works here, unlike in the first cut of this route. The
        // affordance is gated on BOTH the same project-admin permission the
        // workspace gates it on AND the descendant count having actually
        // loaded: a count still sitting at 0 would promise a delete takes
        // nothing with it, which for a parent requirement is a lie the
        // confirmation dialog exists to prevent.
        onRequestDelete={
          canAddEdit && !isCountLoading
            ? () => setDeleteOpen(true)
            : undefined
        }
      />
      {canAddEdit && (
        <DeleteRequirementModal
          projectId={projectId}
          requirementId={requirementId}
          descendantCount={descendantCount}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          // Nothing to reselect once this page's own subject is gone, so
          // this returns to the tree rather than clearing a selection the
          // way the workspace does. The coverage rollup is invalidated
          // first, mirroring the list's own handler: its 30s staleTime
          // would otherwise let the tree we are navigating to show counts
          // that still include the subtree just deleted.
          onDeleted={() => {
            setIsDeleting(true);
            // The tree we are about to navigate to reads its rows from the
            // Issue model's own cached queries, NOT from the coverage
            // rollup -- invalidating coverage alone left the deleted
            // requirement still rendered in the list. The list handles this
            // with its own `refetchRequirements()` handle, which this route
            // has no access to, so it invalidates by key instead.
            // `isIssueBearingQueryKey` is the established predicate: it
            // matches the issue-family models AND any query whose args
            // reference an issue relation, which is what a subtree delete
            // actually touches.
            void queryClient.invalidateQueries({
              predicate: (query) => isIssueBearingQueryKey(query.queryKey),
            });
            invalidateRequirementCoverage(queryClient, Number(projectId));
            router.replace(`/projects/requirements/${projectId}`);
          }}
        />
      )}
    </main>
  );
}
