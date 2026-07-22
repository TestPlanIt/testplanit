"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { useEffect } from "react";

import { createDeferredEventSource } from "~/hooks/deferredEventSource";
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
export function ReviewInboxButton() {
  const t = useTranslations();
  const { data: session, status } = useSession();
  const { enabled, isLoading: featureLoading } = useReviewFeatureEnabled();

  // Load the user's role memberships once per session — feeds the role-holder
  // branch of the count query's OR clause.
  const { data: userWithRoles } = useClientQueries(schema).user.useFindUnique(
    {
      where: { id: session?.user?.id ?? "" },
      select: {
        roleId: true,
        projectPermissions: {
          select: {
            roleId: true,
            accessType: true,
          },
        },
      },
    },
    { enabled: !!session?.user?.id }
  );

  // Flatten the user's role IDs across global + SPECIFIC_ROLE assignments.
  // Deduped via Set; null/undefined entries dropped.
  const currentUserRoleIds: number[] = (() => {
    if (!userWithRoles) return [];
    const ids = new Set<number>();
    const globalRoleId = (userWithRoles as { roleId?: number | null }).roleId;
    if (typeof globalRoleId === "number") ids.add(globalRoleId);
    const projectPerms =
      (
        userWithRoles as {
          projectPermissions?: Array<{
            roleId: number | null;
            accessType: string;
          }>;
        }
      ).projectPermissions ?? [];
    for (const perm of projectPerms) {
      if (
        perm.accessType === "SPECIFIC_ROLE" &&
        typeof perm.roleId === "number"
      ) {
        ids.add(perm.roleId);
      }
    }
    return Array.from(ids);
  })();

  const { data: count, refetch: refetchCount } = useClientQueries(
    schema
  ).reviewRequest.useCount(
    {
      where: {
        status: "PENDING",
        isDeleted: false,
        project: { reviewWorkflowEnabled: true },
        OR: [
          { assigneeUserId: session?.user?.id ?? "" },
          { assigneeRoleId: { in: currentUserRoleIds } },
        ],
      },
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
  useEffect(() => {
    if (!session?.user?.id || enabled !== true) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    const eventSource = createDeferredEventSource("/api/notifications/stream");
    eventSource.onmessage = () => {
      void refetchCount();
    };
    eventSource.onerror = (err) => {
      console.warn("[ReviewInboxButton] SSE transport error", err);
    };
    return () => {
      eventSource.close();
    };
  }, [session?.user?.id, enabled, refetchCount]);

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
