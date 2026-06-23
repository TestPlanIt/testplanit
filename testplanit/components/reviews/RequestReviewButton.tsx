"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
   * The latest PENDING ReviewRequest for this entity, if one exists.
   *
   * On list/table pages where many `RequestReviewButton` rows render at
   * once, the parent SHOULD bulk-fetch and pass this in as a prop to avoid
   * the N+1 fan-out from RESEARCH §"Pitfall 6".
   *
   * On single-entity pages (case/run/session detail), pass `undefined` and
   * the component falls back to its own `useClientQueries(schema).reviewRequest.useFindFirst` query
   * — TanStack Query dedupes against the same key the
   * `ReviewStatusBanner` uses, so the trigger auto-hides the moment a
   * PENDING request lands (and the banner appears) without any prop
   * threading.
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

  // Hook fallback when the parent didn't bulk-supply `pendingRequest` (i.e.
  // single-entity pages — see prop docstring). The `enabled` flag gates the
  // query on (a) feature flag resolved + on, and (b) the parent not having
  // already supplied the data; without it we'd duplicate the fetch the list
  // pages worked hard to avoid.
  const shouldAutoFetchPending =
    enabled === true && pendingRequest === undefined;
  const { data: autoFetchedPending } = useClientQueries(schema).reviewRequest.useFindFirst(
    {
      where: {
        entityType,
        entityId,
        status: "PENDING",
        isDeleted: false,
      },
      select: { id: true, status: true },
    } as any,
    {
      enabled: shouldAutoFetchPending,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    } as any
  );
  const effectivePending =
    pendingRequest !== undefined ? pendingRequest : autoFetchedPending;

  // D-02 visibility predicate — all three must hold:
  //   (1) feature flag is fully resolved AND enabled,
  //   (2) no PENDING ReviewRequest exists for this entity (one-per-entity
  //       invariant — surface the action panel, not a duplicate-request CTA),
  //   (3) at least one reachable workflow state requires review.
  if (isLoading || !enabled) return null;
  if (effectivePending) return null;
  if (reachableGatedStates.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setSheetOpen(true)}
        data-testid="request-review-button"
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
      >
        <MessageSquareWarning className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {t("reviews.requester.openButton")}
        </span>
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
