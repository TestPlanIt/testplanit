"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Loader2, MessageSquareWarning } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { bulkRequestReview } from "~/app/actions/reviews";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { areaForEntityType } from "~/lib/utils/reviewAreas";
import type { IconName } from "~/types/globals";

import { AssigneeCombobox, type AssigneeOption } from "./AssigneeCombobox";
import type { ReviewableEntityType } from "./RequestReviewSheet";

/**
 * One row of the "what will be requested" breakdown: the gate, and how many
 * of the selected entities are waiting on it. Under strict-transitive gating
 * a selection sitting at different current states can need different gates,
 * so this is a list rather than a single target.
 */
export interface BulkGateBreakdownRow {
  gateId: number;
  gateName: string;
  gateIcon: string;
  gateColor: string;
  count: number;
}

export interface BulkRequestReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: ReviewableEntityType;
  projectId: number;
  /** Every entity the request should cover — the blocked subset, not the whole selection. */
  entityIds: number[];
  /** The state the bulk edit is trying to reach; the server resolves per-entity gates from it. */
  toStateId: number;
  targetStateName: string;
  breakdown: BulkGateBreakdownRow[];
  /** Entities already carrying a PENDING request; surfaced up-front as "will be skipped". */
  alreadyPendingCount?: number;
  /**
   * Runs after the assignee is chosen and before the requests are raised.
   * The bulk-edit modal uses this to write the non-gated field edits, so a
   * single confirmation does both halves of "save what you can, request the
   * rest". Returning false aborts without creating any requests.
   */
  onBeforeSubmit?: () => Promise<boolean>;
  /** Called after requests land (or after a no-op resolution) so the parent can close + refetch. */
  onSuccess: () => void;
}

/**
 * Assignee picker for a bulk review request.
 *
 * Deliberately narrower than {@link RequestReviewSheet}: there is no target
 * state Select (the bulk edit already chose one, and each entity's actual
 * gate is derived from it server-side) and no comment field. A single prose
 * blob copied onto forty comment threads reads as noise rather than context,
 * so every request carries the same localized auto-comment the single-entity
 * path falls back to — rendered per entity, naming that entity's own
 * transition.
 */
export function BulkRequestReviewSheet({
  open,
  onOpenChange,
  entityType,
  projectId,
  entityIds,
  toStateId,
  targetStateName,
  breakdown,
  alreadyPendingCount = 0,
  onBeforeSubmit,
  onSuccess,
}: BulkRequestReviewSheetProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const [selectedAssignee, setSelectedAssignee] =
    useState<AssigneeOption | null>(null);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset on close so reopening never inherits a stale assignee from the
  // previous batch.
  useEffect(() => {
    if (!open) {
      setSelectedAssignee(null);
      setAssigneeError(null);
    }
  }, [open]);

  const requestCount = useMemo(
    () => breakdown.reduce((sum, row) => sum + row.count, 0),
    [breakdown]
  );

  const handleAssigneeChange = (value: AssigneeOption | null) => {
    setSelectedAssignee(value);
    setAssigneeError(null);
  };

  const handleSubmit = async () => {
    if (!selectedAssignee) {
      setAssigneeError(t("reviews.requester.assigneeRequired"));
      return;
    }

    const requestedByUserId = session?.user?.id;
    if (!requestedByUserId) {
      toast.error(t("common.errors.somethingWentWrong"));
      return;
    }

    // Mirrors RequestReviewSheet's WR-03 guard: the schema @@validate catches
    // self-assignment server-side, but surfaces it as a generic failure with
    // no hint about the cause.
    if (
      selectedAssignee.kind === "user" &&
      selectedAssignee.id === requestedByUserId
    ) {
      setAssigneeError(t("reviews.requester.cannotSelfAssign"));
      return;
    }

    setIsSubmitting(true);
    try {
      // Field edits first. If they fail the parent has already reported it,
      // and raising requests for edits that never landed would be worse than
      // raising none.
      if (onBeforeSubmit) {
        const proceed = await onBeforeSubmit();
        if (!proceed) return;
      }

      const result = await bulkRequestReview({
        projectId,
        entityType,
        entityIds,
        toStateId,
        assigneeUserId:
          selectedAssignee.kind === "user" ? selectedAssignee.id : null,
        assigneeRoleId:
          selectedAssignee.kind === "role" ? selectedAssignee.id : null,
      });

      if (!result.success) {
        if (result.error === "INELIGIBLE_ASSIGNEE") {
          setAssigneeError(t("reviews.requester.ineligibleAssigneeError"));
        } else if (result.error === "SELECTION_TOO_LARGE") {
          toast.error(t("reviews.bulkRequester.selectionTooLarge"));
        } else {
          toast.error(t("common.errors.somethingWentWrong"));
        }
        return;
      }

      // ZenStack keys generated queries under ["zenstack", "<Model>", …] —
      // the model name is the SECOND element. This prefix refreshes every
      // cached ReviewRequest query at once: the inbox badge, the repository
      // rows' gate status, and any open case's banner.
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "ReviewRequest"],
      });

      if (result.created === 0) {
        toast.success(
          onBeforeSubmit
            ? t("reviews.bulkRequester.editsAppliedNoRequests")
            : t("reviews.bulkRequester.nothingToRequest")
        );
      } else if (result.skippedPending.length > 0) {
        toast.success(
          t("reviews.bulkRequester.submitSuccessWithSkips", {
            created: result.created,
            skipped: result.skippedPending.length,
          })
        );
      } else {
        toast.success(
          t("reviews.bulkRequester.submitSuccess", { count: result.created })
        );
      }

      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error(t("common.errors.somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col sm:max-w-md"
        data-testid="bulk-request-review-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5" />
            {t("reviews.requester.openButton")}
          </SheetTitle>
          <SheetDescription>
            {t("reviews.bulkRequester.sheetDescription", {
              count: requestCount,
              targetStateName,
            })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="bulk-request-review-assignee"
            >
              {t("reviews.requester.assigneeLabel")}
            </label>
            <div id="bulk-request-review-assignee">
              <AssigneeCombobox
                projectId={projectId}
                value={selectedAssignee}
                onValueChange={handleAssigneeChange}
                disabled={isSubmitting}
                requireCanApproveOn={areaForEntityType(entityType)}
              />
            </div>
            {assigneeError && (
              <p
                className="text-sm font-medium text-destructive"
                data-testid="bulk-request-review-assignee-error"
              >
                {assigneeError}
              </p>
            )}
          </div>

          {/* Which gate each slice of the selection is waiting on. Cases at
              different current states resolve to different first gates, so
              this is the only place the user sees that a single action is
              raising requests against more than one state. */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("reviews.bulkRequester.breakdownLabel")}
            </p>
            <ul
              className="space-y-1"
              data-testid="bulk-request-review-breakdown"
            >
              {breakdown.map((row) => (
                <li
                  key={row.gateId}
                  className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-sm"
                  data-testid={`bulk-request-review-breakdown-${row.gateId}`}
                >
                  <WorkflowStateDisplay
                    state={{
                      name: row.gateName,
                      icon: { name: row.gateIcon as IconName },
                      color: { value: row.gateColor },
                      requiresReview: true,
                    }}
                    size="sm"
                  />
                  <span className="text-muted-foreground">
                    {t("reviews.bulkRequester.breakdownRow", {
                      count: row.count,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            {alreadyPendingCount > 0 && (
              <p
                className="flex items-start gap-2"
                data-testid="bulk-request-review-pending-note"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {t("reviews.bulkRequester.pendingSkipNote", {
                  count: alreadyPendingCount,
                })}
              </p>
            )}
            {onBeforeSubmit && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {t("reviews.bulkRequester.otherEditsNote")}
              </p>
            )}
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              {t("reviews.bulkRequester.autoCommentNote")}
            </p>
          </div>

          <div className="mt-auto flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || requestCount === 0}
              data-testid="bulk-request-review-submit"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("reviews.requester.openButton")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
