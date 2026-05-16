"use client";

import { Button } from "@/components/ui/button";
import { MessageSquareWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";

import type { AssigneeOption } from "./AssigneeCombobox";
import {
  RequestReviewSheet,
  type ReachableGatedState,
  type ReviewableEntityType,
} from "./RequestReviewSheet";

export interface PendingReviewSummary {
  id: string;
  status: "PENDING";
}

export interface RequestReviewButtonProps {
  entityType: ReviewableEntityType;
  entityId: number;
  projectId: number;
  currentStateId: number;
  reachableGatedStates: ReachableGatedState[];
  /**
   * The latest PENDING ReviewRequest for this entity, if one exists. Bulk-
   * fetched at the entity-page level and passed in as a prop to avoid the
   * N+1 fan-out from RESEARCH §"Pitfall 6". `undefined` means "no PENDING
   * request found".
   */
  pendingRequest?: PendingReviewSummary | null;
  /** Optional D-08 pre-fill payload for "Request review again". */
  initialValues?: {
    assignee?: AssigneeOption;
    targetStateId?: number;
  };
}

export function RequestReviewButton({
  entityType,
  entityId,
  projectId,
  currentStateId,
  reachableGatedStates,
  pendingRequest,
  initialValues,
}: RequestReviewButtonProps) {
  const t = useTranslations();
  const { enabled, isLoading } = useReviewFeatureEnabled(projectId);
  const [sheetOpen, setSheetOpen] = useState(false);

  // D-02 visibility predicate — all three must hold:
  //   (1) feature flag is fully resolved AND enabled,
  //   (2) no PENDING ReviewRequest exists for this entity (one-per-entity
  //       invariant — surface the action panel, not a duplicate-request CTA),
  //   (3) at least one reachable workflow state requires review.
  if (isLoading || !enabled) return null;
  if (pendingRequest) return null;
  if (reachableGatedStates.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setSheetOpen(true)}
        data-testid="request-review-button"
      >
        <div className="flex items-center">
          <MessageSquareWarning className="w-5 h-5 mr-2" />
          <div>{t("reviews.requester.openButton")}</div>
        </div>
      </Button>
      <RequestReviewSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        entityType={entityType}
        entityId={entityId}
        projectId={projectId}
        currentStateId={currentStateId}
        reachableGatedStates={reachableGatedStates}
        initialValues={initialValues}
      />
    </>
  );
}
