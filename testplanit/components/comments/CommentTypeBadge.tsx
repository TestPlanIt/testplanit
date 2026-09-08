"use client";

import {
  Ban,
  CheckCircle2,
  MessageCircleWarning,
  MessageSquareWarning,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "~/components/ui/badge";
import type { ReviewStatus } from "~/zenstack/models";

export type CommentType = "GENERAL" | "REVIEW_REQUEST" | "REVIEW_DECISION";

export type ReviewRequestStatus = ReviewStatus;

export function getCommentAccentClasses(
  type: CommentType,
  reviewStatus?: ReviewRequestStatus | null
): string {
  if (type === "REVIEW_REQUEST") {
    return "border-s-4 border-s-primary";
  }
  if (type === "REVIEW_DECISION") {
    switch (reviewStatus) {
      case "APPROVED":
        return "border-s-4 border-s-emerald-500";
      case "CHANGES_REQUESTED":
        return "border-s-4 border-s-amber-500";
      case "REJECTED":
        return "border-s-4 border-s-destructive";
      default:
        return "border-s-4 border-s-muted-foreground";
    }
  }
  return "";
}

interface ReviewDecisionBadgeProps {
  /** Outcome of the review. Null/undefined (e.g. the linked ReviewRequest
   * was removed) falls back to a neutral generic "Decision" badge. */
  status?: ReviewRequestStatus | null;
  "data-testid"?: string;
}

/** Outcome badge for a decided review — the single source of the
 * per-status color, icon, and label so every surface reads the same. */
export function ReviewDecisionBadge({
  status,
  "data-testid": testId,
}: ReviewDecisionBadgeProps) {
  const t = useTranslations();

  const base = "gap-1";
  const {
    labelKey,
    icon: Icon,
    variant,
    className,
  }: {
    labelKey: string;
    icon: LucideIcon | null;
    variant?: "destructive";
    className: string;
  } = (() => {
    switch (status) {
      case "APPROVED":
        return {
          labelKey: "comments.type.reviewDecision.approved",
          icon: CheckCircle2,
          className: `${base} bg-success text-success-foreground border-success hover:bg-success/90`,
        };
      case "CHANGES_REQUESTED":
        return {
          labelKey: "comments.type.reviewDecision.changesRequested",
          icon: MessageCircleWarning,
          className: `${base} bg-warning text-white border-warning hover:bg-warning/90`,
        };
      case "REJECTED":
        return {
          labelKey: "comments.type.reviewDecision.rejected",
          icon: XCircle,
          variant: "destructive" as const,
          className: base,
        };
      case "CANCELLED":
        return {
          labelKey: "comments.type.reviewDecision.cancelled",
          icon: Ban,
          className: `${base} bg-muted-foreground text-background border-muted-foreground hover:bg-muted-foreground/90`,
        };
      default:
        return {
          labelKey: "comments.type.reviewDecision.generic",
          icon: null,
          className: base,
        };
    }
  })();

  return (
    <Badge
      variant={variant}
      data-testid={testId}
      data-status-surface
      data-review-status={status?.toLowerCase() ?? "generic"}
      className={className}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {t(labelKey)}
    </Badge>
  );
}

interface CommentTypeBadgeProps {
  type: CommentType;
  reviewStatus?: ReviewRequestStatus | null;
}

/** Badge shown above review-generated comments: "Review request" for the
 * request comment, the decision outcome for the decision comment. Renders
 * nothing for GENERAL comments. */
export function CommentTypeBadge({
  type,
  reviewStatus,
}: CommentTypeBadgeProps) {
  const t = useTranslations();

  if (type === "GENERAL") {
    return null;
  }

  if (type === "REVIEW_REQUEST") {
    return (
      <Badge
        data-testid="comment-type-badge-review_request"
        className="gap-1 bg-secondary text-secondary-foreground"
      >
        <MessageSquareWarning className="h-3 w-3 shrink-0" />
        {t("comments.type.reviewRequest")}
      </Badge>
    );
  }

  return (
    <ReviewDecisionBadge
      status={reviewStatus}
      data-testid="comment-type-badge-review_decision"
    />
  );
}
