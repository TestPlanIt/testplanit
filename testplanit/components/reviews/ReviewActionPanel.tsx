"use client";

import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageCircleWarning, XCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useEffectiveRoleOnProject } from "~/hooks/useEffectiveRoleOnProject";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { useFindFirstReviewRequest } from "~/lib/hooks";

import {
  ApproveDialog,
  RejectDialog,
  RequestChangesDialog,
  type ReviewableEntityType,
} from "./ReviewDecisionDialogs";

export interface ReviewActionPanelProps {
  entityType: ReviewableEntityType;
  entityId: number;
  projectId: number;
}

/**
 * Reviewer-side decision surface. Renders a sticky cluster of three Buttons
 * (Approve / Request changes / Reject) when the auto-detect visibility
 * predicate matches (D-11 / D-12 / D-15 / D-16):
 *
 *   1. The review feature is enabled (system AND per-project).
 *   2. A PENDING ReviewRequest exists for (entityType, entityId).
 *   3. The viewing user is NOT the requester (requester sees banner-only).
 *   4. The viewing user is eligible: direct assignee, effective-role holder,
 *      or system ADMIN.
 *
 * Returns null in every other case so uninvolved members and the requester
 * see the read-only banner (Plan 02-05) without an action surface.
 *
 * Each Button opens its corresponding dialog from ReviewDecisionDialogs.
 * Successful (or 409-already-decided) decisions invalidate the
 * ReviewRequest query so the panel disappears immediately.
 *
 * Sticky positioning uses `top-2 z-20` so the panel stays beneath the
 * global header (z-50) while remaining visible while the reviewer scrolls
 * through a long entity body.
 */
export function ReviewActionPanel({
  entityType,
  entityId,
  projectId,
}: ReviewActionPanelProps) {
  const t = useTranslations("reviews.reviewer");
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { enabled: featureEnabled } = useReviewFeatureEnabled(projectId);
  const { roleId: effectiveRoleId } = useEffectiveRoleOnProject(projectId);

  const { data: pendingRequestRaw } = useFindFirstReviewRequest(
    {
      where: {
        entityType,
        entityId,
        status: "PENDING",
        isDeleted: false,
      },
      include: {
        fromState: true,
        toState: true,
        requestedBy: { select: { id: true, name: true } },
      },
    },
    {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      enabled: featureEnabled === true,
    } as Parameters<typeof useFindFirstReviewRequest>[1],
  );

  // Cast the ZenStack hook result to the include-aware shape this component
  // consumes. ZenStack's generated typings collapse the include arg to a
  // generic `{}` payload at the call site because the args object is
  // computed at runtime; the narrower shape below describes what we asked
  // for in the include block above.
  const pendingRequest = pendingRequestRaw as
    | {
        id: string;
        requestedByUserId: string;
        assigneeUserId: string | null;
        assigneeRoleId: number | null;
        toState: { id: number; name: string } | null;
        requestedBy: { id: string; name: string | null } | null;
      }
    | null
    | undefined;

  const [approveOpen, setApproveOpen] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  // Visibility predicate evaluated late so all hooks fire unconditionally
  // (Rules of Hooks).
  if (!featureEnabled) return null;
  if (!pendingRequest) return null;

  const viewerId = session?.user?.id;
  // Without a session we can't decide eligibility — better to hide than
  // surface action buttons the server will refuse.
  if (!viewerId) return null;

  // D-12 — requester sees banner-only.
  if (pendingRequest.requestedByUserId === viewerId) return null;

  const sessionUser = session?.user as
    | { id: string; access?: string }
    | undefined;

  const isDirectAssignee =
    pendingRequest.assigneeUserId != null &&
    pendingRequest.assigneeUserId === viewerId;
  const isRoleHolder =
    pendingRequest.assigneeRoleId != null &&
    effectiveRoleId != null &&
    pendingRequest.assigneeRoleId === effectiveRoleId;
  const isAdmin = sessionUser?.access === "ADMIN";

  if (!isDirectAssignee && !isRoleHolder && !isAdmin) return null;

  const targetStateName: string = pendingRequest.toState?.name ?? "";
  const requesterName: string = pendingRequest.requestedBy?.name ?? "";

  const handleDecisionSuccess = () => {
    // Drop the PENDING-request cache so the panel disappears and any banner
    // sibling on the entity page re-renders against the new state.
    // ZenStack-generated hooks key their queries by model name as the first
    // element of the queryKey array, so a partial-match invalidate by
    // queryKey: ["ReviewRequest"] hits every cached ReviewRequest query.
    void queryClient.invalidateQueries({ queryKey: ["ReviewRequest"] });
  };

  return (
    <>
      <div
        className="sticky top-2 z-20 bg-background border-b shadow-sm p-3 flex items-center justify-between gap-3"
        data-testid="review-action-panel"
      >
        <div className="flex items-center text-sm text-muted-foreground">
          {t("panelSummary", {
            requesterName: requesterName || "—",
            targetStateName: targetStateName || "—",
          })}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            type="button"
            variant="default"
            onClick={() => setApproveOpen(true)}
            data-testid="review-approve-button"
          >
            <div className="flex items-center">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              <div>{t("approve")}</div>
            </div>
          </Button>
          <Button
            type="button"
            onClick={() => setRequestChangesOpen(true)}
            data-testid="review-request-changes-button"
            className="bg-warning text-warning-foreground hover:bg-warning/90"
          >
            <div className="flex items-center">
              <MessageCircleWarning className="w-5 h-5 mr-2" />
              <div>{t("requestChanges")}</div>
            </div>
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setRejectOpen(true)}
            data-testid="review-reject-button"
          >
            <div className="flex items-center">
              <XCircle className="w-5 h-5 mr-2" />
              <div>{t("reject")}</div>
            </div>
          </Button>
        </div>
      </div>

      <ApproveDialog
        reviewRequestId={pendingRequest.id}
        open={approveOpen}
        onOpenChange={setApproveOpen}
        entityType={entityType}
        targetStateName={targetStateName}
        onSuccess={handleDecisionSuccess}
      />
      <RequestChangesDialog
        reviewRequestId={pendingRequest.id}
        open={requestChangesOpen}
        onOpenChange={setRequestChangesOpen}
        entityType={entityType}
        targetStateName={targetStateName}
        onSuccess={handleDecisionSuccess}
      />
      <RejectDialog
        reviewRequestId={pendingRequest.id}
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        entityType={entityType}
        targetStateName={targetStateName}
        onSuccess={handleDecisionSuccess}
      />
    </>
  );
}
