"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { nudgeReviewRequest } from "~/app/actions/reviews";
import { NUDGE_COOLDOWN_MS } from "~/lib/services/reviewReminderConfig";

export interface NudgeReviewButtonProps {
  /** ID of the PENDING ReviewRequest to re-announce. */
  reviewRequestId: string;
  /**
   * Last time a reminder went out for this row — set by the scheduled scan
   * OR by a previous nudge. Drives the client-side cooldown; the server
   * enforces the same window authoritatively.
   */
  lastRemindedAt: Date | string | null;
  /** Invalidate the caller's caches so the refreshed cooldown lands. */
  onNudged?: () => void;
}

/**
 * "Send reminder" affordance for the requester's own rows in the reviews
 * inbox — cancel's counterpart, and the only other thing a requester can do
 * to a request they aren't allowed to decide.
 *
 * Fires immediately, no confirmation dialog: the outcome is one notification,
 * it's the requester's own request, and it's reversible by simply not doing it
 * again. Cancel takes a dialog because it destroys the reviewer's ability to
 * act; this doesn't.
 *
 * The real spam guard is the cooldown. `lastRemindedAt` is shared with the
 * scheduled reminder scan, so the button greys out for an hour after EITHER
 * fires and the tooltip says when that was — the reviewer can't be pinged
 * twice for the same request just because two surfaces exist. The server
 * re-checks the same window, so a stale row in the client cache costs a
 * rejected round trip, not a duplicate ping.
 */
export function NudgeReviewButton({
  reviewRequestId,
  lastRemindedAt,
  onNudged,
}: NudgeReviewButtonProps) {
  const t = useTranslations();
  const [isPending, startTransition] = useTransition();

  const remindedAt = lastRemindedAt ? new Date(lastRemindedAt) : null;
  const inCooldown =
    remindedAt !== null &&
    !Number.isNaN(remindedAt.getTime()) &&
    Date.now() - remindedAt.getTime() < NUDGE_COOLDOWN_MS;

  const label = inCooldown
    ? t("reviews.nudge.cooldownTooltip", {
        ago: formatDistanceToNow(remindedAt as Date, { addSuffix: true }),
      })
    : t("reviews.inbox.actionNudge");

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await nudgeReviewRequest(reviewRequestId);
        if (result.success) {
          toast.success(
            t("reviews.nudge.success", { count: result.recipientCount })
          );
          onNudged?.();
          return;
        }
        // Each failure tells the requester something different about what to
        // do next, so they don't collapse into one generic error toast.
        if (result.error === "TOO_SOON") {
          toast.error(t("reviews.nudge.tooSoon"));
          // The row's cached lastRemindedAt is behind the database — refresh
          // so the button settles into its disabled state.
          onNudged?.();
          return;
        }
        if (result.error === "NO_RECIPIENTS") {
          toast.error(t("reviews.nudge.noRecipients"));
          return;
        }
        if (result.error === "ALREADY_DECIDED") {
          toast.error(t("reviews.reviewer.alreadyDecidedError"));
          onNudged?.();
          return;
        }
        toast.error(t("reviews.nudge.error"));
      } catch {
        toast.error(t("reviews.nudge.error"));
      }
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The trigger keeps its own span so the tooltip still opens while the
            button is disabled — a disabled button fires no pointer events, and
            the cooldown explanation is exactly what the user needs then. */}
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isPending || inCooldown}
            onClick={(e) => {
              // DataTable rows can fire row-level navigation on click; keep
              // the inline action from bubbling into it.
              e.stopPropagation();
              handleClick();
            }}
            data-testid={`reviews-inbox-nudge-${reviewRequestId}`}
            aria-label={label}
          >
            <BellRing className="h-4 w-4 text-sky-500" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
