"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { useEffect } from "react";

import { createDeferredEventSource } from "~/hooks/deferredEventSource";
import { pendingReviewsForViewerWhere } from "~/hooks/usePendingReviewRequests";
import { useReviewAssigneeRoleIds } from "~/hooks/useReviewAssigneeRoleIds";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { Link } from "~/lib/navigation";

/**
 * Global-header shortcut to the reviewer inbox at /reviews.
 *
 * Mirrors NotificationBell's trigger shape (ghost icon Button + absolute
 * destructive Badge for the count) but is a Link rather than a popover. The
 * inbox page itself is Plan 02-08's destination — this component owns only the
 * visibility + count surface.
 *
 * Visibility (D-09 / D-20):
 *   - Hidden when the system-level feature flag resolves to false (the
 *     button is system-level, so no projectId is passed to
 *     useReviewFeatureEnabled).
 *   - Hidden while the session is loading OR the viewer is unauthenticated.
 *   - Hidden when the viewer has no access to any project with the
 *     per-project Review Workflow toggle on. Access-policy-enforced count;
 *     viewers who can't act on any gated project don't see the icon.
 *
 * Count source (D-09):
 *   - PENDING ReviewRequests where the viewer is direct assignee OR holds
 *     the assigned role on ANY project. Role membership is derived from the
 *     user's global roleId + every SPECIFIC_ROLE UserProjectPermission row.
 */
export function ReviewInboxButton({
  variant = "icon",
}: {
  /** "icon" renders the standalone header button; "menu" renders as a row for
   * the collapsed header kebab. Both share the same visibility gating + count. */
  variant?: "icon" | "menu";
} = {}) {
  const t = useTranslations();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const { enabled, isLoading: featureLoading } = useReviewFeatureEnabled();

  // Role memberships (global + SPECIFIC_ROLE) — feeds the role-holder branch
  // of the count query's OR clause.
  const currentUserRoleIds = useReviewAssigneeRoleIds(session?.user?.id);

  const { data: count } = useClientQueries(schema).reviewRequest.useCount(
    {
      where: pendingReviewsForViewerWhere(
        session?.user?.id,
        currentUserRoleIds
      ),
    },
    { enabled: !!session?.user?.id && enabled === true }
  );

  // The Header mounts once and never unmounts across client-side navigation,
  // and the app's QueryClient defaults to refetchOnWindowFocus: false — so
  // without an external signal this count is fetched at app load and never
  // again, leaving the badge permanently stale. Requesting a review already
  // dispatches a REVIEW_REQUESTED notification to the assignee, so the
  // notification stream NotificationBell listens on doubles as the wake-up
  // for the badge. Reconnect emits {event:"sync"}, which refetches and
  // catches anything missed while disconnected.
  //
  // The handler invalidates the whole ReviewRequest cache rather than
  // refetching this one count: ZenStack keys generated queries under
  // ["zenstack", "<Model>", …], so the prefix also refreshes the home
  // dashboard's pending-review queue and any open entity's status banner. One
  // stream connection serves every review surface — each opening its own
  // EventSource would burn scarce HTTP/1.1 connection slots.
  useEffect(() => {
    if (!session?.user?.id || enabled !== true) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    const eventSource = createDeferredEventSource("/api/notifications/stream");
    eventSource.onmessage = () => {
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "ReviewRequest"],
      });
    };
    eventSource.onerror = (err) => {
      console.warn("[ReviewInboxButton] SSE transport error", err);
    };
    return () => {
      eventSource.close();
    };
  }, [session?.user?.id, enabled, queryClient]);

  // Count of access-visible projects with the per-project toggle on. The
  // enhanced auto-API enforces project access policies, so this naturally
  // reflects "projects this user can act in." Used to hide the icon entirely
  // when the viewer has no review-enabled project to act in.
  const { data: enabledProjectCount, isLoading: projectCountLoading } =
    useClientQueries(schema).projects.useCount(
      {
        where: {
          reviewWorkflowEnabled: true,
          isDeleted: false,
        },
      },
      { enabled: !!session?.user?.id && enabled === true }
    );

  // Visibility short-circuits — keep all hooks above to honor Rules of Hooks.
  if (status === "loading" || !session?.user?.id) return null;
  if (featureLoading || !enabled) return null;
  if (projectCountLoading) return null;
  if (typeof enabledProjectCount === "number" && enabledProjectCount === 0)
    return null;

  const numericCount = typeof count === "number" ? count : 0;

  if (variant === "menu") {
    return (
      <DropdownMenuItem asChild>
        <Link
          href="/reviews"
          data-testid="review-inbox-button"
          aria-label={t("reviews.inbox.iconAria", { count: numericCount })}
          className="flex cursor-pointer items-center no-underline"
        >
          <Inbox className="me-2 h-4 w-4" />
          <span>{t("common.pageTitles.reviews")}</span>
          {numericCount > 0 && (
            <Badge
              variant="destructive"
              className="ms-2 h-5 min-w-5 justify-center p-0 px-1 text-xs"
              data-testid="review-inbox-count-badge"
            >
              {numericCount > 9 ? "9+" : numericCount}
            </Badge>
          )}
        </Link>
      </DropdownMenuItem>
    );
  }

  return (
    <Link
      href="/reviews"
      data-testid="review-inbox-button"
      aria-label={t("reviews.inbox.iconAria", { count: numericCount })}
    >
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={t("reviews.inbox.iconAria", { count: numericCount })}
      >
        <Inbox className="h-5 w-5" />
        {numericCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -end-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            data-testid="review-inbox-count-badge"
          >
            {numericCount > 9 ? "9+" : numericCount}
          </Badge>
        )}
      </Button>
    </Link>
  );
}
