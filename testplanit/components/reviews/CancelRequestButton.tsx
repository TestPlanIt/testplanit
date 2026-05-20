"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useUpdateReviewRequest } from "~/lib/hooks";

export interface CancelRequestButtonProps {
  /** ID of the PENDING ReviewRequest to cancel. */
  reviewRequestId: string;
  /**
   * Whether the viewer is allowed to cancel. Computed by the parent
   * (requester || admin). When false the component renders nothing — the
   * cancel affordance is gated in both UI and ZenStack policy per
   * RESEARCH §"Pitfall 5".
   */
  canCancel: boolean;
}

/**
 * Cancel-request affordance used inside `ReviewStatusBanner` (PENDING branch).
 *
 * Confirmation flows through a shadcn `AlertDialog` per
 * [[feedback_no_native_dialogs]] — NEVER `window.confirm`. Confirm action
 * calls `useUpdateReviewRequest` with `{ status: 'CANCELLED' }` — a status
 * mutation, not a row deletion (soft-delete-only invariant per
 * [[feedback_soft_delete]]).
 */
export function CancelRequestButton({
  reviewRequestId,
  canCancel,
}: CancelRequestButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateReviewRequest } = useUpdateReviewRequest();

  if (!canCancel) return null;

  const handleConfirm = async () => {
    try {
      await updateReviewRequest({
        where: { id: reviewRequestId },
        data: { status: "CANCELLED" },
      } as any);
      toast.success(t("reviews.cancel.success"));
      setOpen(false);
    } catch {
      toast.error(t("reviews.cancel.error"));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="cancel-request-button"
      >
        {t("common.cancel")}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="cancel-request-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reviews.cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reviews.cancel.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="cancel-request-confirm"
            >
              {t("reviews.cancel.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
