"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MessageSquareWarning } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The shape of a pre-fetched ReviewRequest row consumed by this badge.
 * Only the fields needed for tooltip text are required; the parent
 * (Plan 02-09 list-view wiring) is responsible for the bulk fetch and
 * picks the appropriate `select` shape.
 */
export interface PendingReviewSummary {
  id: string;
  status:
    | "PENDING"
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REJECTED"
    | "CANCELLED";
  assigneeUserId?: string | null;
  assigneeRoleId?: number | null;
  assigneeUser?: { name?: string | null } | null;
  assigneeRole?: { name?: string | null } | null;
}

export interface PendingReviewBadgeProps {
  /**
   * Pre-fetched ReviewRequest for the row's entity (bulk-loaded at the
   * page level — see D-06 + RESEARCH §"Pitfall 6"). `undefined` means
   * "no PENDING review for this row" and is the common case.
   */
  pendingRequest: PendingReviewSummary | undefined | null;
}

/**
 * Strictly stateless presentational badge for PENDING reviews on list-view
 * cells. NEVER calls a data-fetching hook — the parent is responsible for
 * the bulk fetch (one find-many keyed by `entityId: { in: visibleIds }`)
 * to avoid the N+1 fan-out per RESEARCH §"Pitfall 6".
 */
export function PendingReviewBadge({
  pendingRequest,
}: PendingReviewBadgeProps) {
  const t = useTranslations();

  if (!pendingRequest) return null;
  if (pendingRequest.status !== "PENDING") return null;

  const assigneeName =
    pendingRequest.assigneeUser?.name ??
    pendingRequest.assigneeRole?.name ??
    "";

  const tooltipText = t("reviews.list.pendingTooltip", {
    assignee: assigneeName,
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="inline-flex h-5 w-5 items-center justify-center p-0 bg-warning text-white border-warning hover:bg-warning/90"
            data-testid="pending-review-badge"
            data-assignee={assigneeName}
            aria-label={tooltipText}
          >
            <MessageSquareWarning className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
