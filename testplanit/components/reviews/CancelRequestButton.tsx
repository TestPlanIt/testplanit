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
import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelReviewRequest } from "~/app/actions/reviews";

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
 * calls the `cancelReviewRequest` server action which mirrors the decide
 * path (status flip + notification + webhook + audit). Soft-delete invariant
 * is preserved — this is a STATUS flip, not a row deletion.
 */
export function CancelRequestButton({
  reviewRequestId,
  canCancel,
}: CancelRequestButtonProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!canCancel) return null;

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        const result = await cancelReviewRequest(reviewRequestId);
        if (!result.success) {
          toast.error(t("reviews.cancel.error"));
          return;
        }
        void queryClient.invalidateQueries({
          queryKey: ["zenstack", "ReviewRequest"],
        });
        toast.success(t("reviews.cancel.success"));
        setOpen(false);
      } catch {
        toast.error(t("reviews.cancel.error"));
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="cancel-request-button"
        aria-label={t("common.cancel")}
        className={collapsibleActionClass()}
      >
        <ActionButtonContent icon={Ban} label={t("common.cancel")} />
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
              disabled={isPending}
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
