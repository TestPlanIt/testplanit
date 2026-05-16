"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Inbox } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import {
  useFindManyProjects,
  useFindManyReviewRequest,
  useFindUniqueUser,
} from "~/lib/hooks";
import { Link, useRouter } from "~/lib/navigation";

import { type ExtendedReviewRequest, useColumns } from "./columns";

type EntityTypeFilter = "all" | "CASE" | "RUN" | "SESSION";
type ProjectFilter = "all" | number;

/**
 * Top-level entry point. Mirrors `app/[locale]/admin/audit-logs/page.tsx`'s
 * structure (Guard → Content) but with no admin gate: per D-09 the inbox is
 * visible to every authenticated user.
 */
export default function ReviewsInboxPage() {
  return <ReviewsInboxGuard />;
}

/**
 * Auth guard: redirects unauthenticated users to `/` and short-circuits while
 * the session is loading. Once authenticated, hands off to the content shell.
 */
function ReviewsInboxGuard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") return null;
  if (!session) return null;

  return <ReviewsInboxContent userId={session.user.id} />;
}

/**
 * Routes a ReviewRequest row to the entity detail page where Plan 02-09's
 * ReviewActionPanel will auto-render for the eligible reviewer (D-11).
 *
 * Returns `null` when the entity type is unknown — defensive in case future
 * polymorphic surfaces are added to ReviewEntityType without the inbox being
 * updated in lockstep.
 */
function entityDetailHref(
  entityType: "CASE" | "RUN" | "SESSION",
  projectId: number,
  entityId: number,
): string | null {
  switch (entityType) {
    case "CASE":
      return `/projects/repository/${projectId}/${entityId}`;
    case "RUN":
      return `/projects/runs/${projectId}/${entityId}`;
    case "SESSION":
      return `/projects/sessions/${projectId}/${entityId}`;
    default:
      return null;
  }
}

/**
 * Inbox content shell — runs only when a session is in hand. Reads:
 *   1. The user's role memberships once (global roleId + every SPECIFIC_ROLE
 *      project assignment) to power the count's OR fan-in.
 *   2. The list of ReviewRequest rows where the viewing user is direct
 *      assignee OR holds the assigned role.
 *   3. The list of projects the user has access to, for the project filter
 *      dropdown's option list.
 *
 * Filters (entity-type + project) are local component state — they translate
 * into additional AND conditions on the query's `where` clause so the database
 * does the narrowing rather than the client.
 *
 * Per RESEARCH Pitfall 4 the listing fires `refetchOnWindowFocus: true` so a
 * reviewer returning from another tab sees fresh data.
 *
 * Per RESEARCH Open Question 5, soft-deleted entity rows are handled by Plan
 * 02-09's entity-detail page emitting a toast on click-through to a 404
 * (rather than per-row entity lookups in this listing, which would multiply
 * the cost N× for the inbox).
 */
function ReviewsInboxContent({ userId }: { userId: string }) {
  // Cast `useTranslations()` to a plain key-to-string function so the
  // accumulated phase-2 message-keys union (which has crossed the TS
  // complexity ceiling — TS2590 / TS2554) doesn't force every call site to
  // pass `{}` as a second argument. See
  // `.planning/phases/02-review-workflow-ux-requester-reviewer/deferred-items.md`
  // for the documented mitigation.
  const t = useTranslations() as (
    key: string,
    params?: Record<string, unknown>,
  ) => string;
  const { enabled: featureEnabled, isLoading: featureLoading } =
    useReviewFeatureEnabled();

  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityTypeFilter>(
    "all",
  );
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  // Flatten the user's role IDs across global + SPECIFIC_ROLE assignments
  // (mirrors the ReviewInboxButton pattern from Plan 02-07).
  const { data: userWithRoles } = useFindUniqueUser(
    {
      where: { id: userId },
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
    { enabled: !!userId },
  );

  const currentUserRoleIds: number[] = useMemo(() => {
    if (!userWithRoles) return [];
    const ids = new Set<number>();
    const globalRoleId = (userWithRoles as { roleId?: number | null }).roleId;
    if (typeof globalRoleId === "number") ids.add(globalRoleId);
    const projectPerms =
      (userWithRoles as {
        projectPermissions?: Array<{
          roleId: number | null;
          accessType: string;
        }>;
      }).projectPermissions ?? [];
    for (const perm of projectPerms) {
      if (
        perm.accessType === "SPECIFIC_ROLE" &&
        typeof perm.roleId === "number"
      ) {
        ids.add(perm.roleId);
      }
    }
    return Array.from(ids);
  }, [userWithRoles]);

  // Project options for the project filter dropdown.
  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Build the where clause. The base PENDING + isDeleted + assignee OR
  // clause is always present (REVIEWER-01); the filters add narrowing AND
  // conditions on top.
  const whereClause = useMemo(() => {
    const conditions: any[] = [
      { status: "PENDING" },
      { isDeleted: false },
      {
        OR: [
          { assigneeUserId: userId },
          { assigneeRoleId: { in: currentUserRoleIds } },
        ],
      },
    ];
    if (entityTypeFilter !== "all") {
      conditions.push({ entityType: entityTypeFilter });
    }
    if (projectFilter !== "all") {
      conditions.push({ projectId: projectFilter });
    }
    return { AND: conditions };
  }, [userId, currentUserRoleIds, entityTypeFilter, projectFilter]);

  const { data: rows } = useFindManyReviewRequest(
    {
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, image: true } },
        fromState: { select: { id: true, name: true } },
        toState: { select: { id: true, name: true } },
        assigneeUser: { select: { id: true, name: true, image: true } },
        assigneeRole: { select: { id: true, name: true } },
      },
    },
    {
      refetchOnWindowFocus: true,
    },
  );

  const columns = useColumns(t);

  const featureDisabled = featureLoading ? false : featureEnabled === false;
  const displayRows: ExtendedReviewRequest[] = featureDisabled
    ? []
    : ((rows as ExtendedReviewRequest[] | undefined) ?? []);

  return (
    <main data-testid="reviews-inbox-page">
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div className="flex items-center gap-3">
              <Inbox className="h-8 w-8" aria-hidden="true" />
              <CardTitle data-testid="reviews-inbox-page-title">
                {t("reviews.inbox.pageTitle")}
              </CardTitle>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-2">
            {t("reviews.inbox.pageDescription")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Filters row */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-[200px]">
                <Label
                  htmlFor="reviews-inbox-entity-type-filter"
                  className="text-xs text-muted-foreground"
                >
                  {t("reviews.inbox.filterEntityType")}
                </Label>
                <select
                  id="reviews-inbox-entity-type-filter"
                  data-testid="reviews-inbox-entity-type-filter"
                  value={entityTypeFilter}
                  onChange={(e) =>
                    setEntityTypeFilter(e.target.value as EntityTypeFilter)
                  }
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="all">
                    {t("reviews.inbox.filterAllEntityTypes")}
                  </option>
                  <option value="CASE">
                    {t("reviews.inbox.filterEntityTypeCase")}
                  </option>
                  <option value="RUN">
                    {t("reviews.inbox.filterEntityTypeRun")}
                  </option>
                  <option value="SESSION">
                    {t("reviews.inbox.filterEntityTypeSession")}
                  </option>
                </select>
              </div>

              <div className="w-[240px]">
                <Label
                  htmlFor="reviews-inbox-project-filter"
                  className="text-xs text-muted-foreground"
                >
                  {t("reviews.inbox.filterProject")}
                </Label>
                <select
                  id="reviews-inbox-project-filter"
                  data-testid="reviews-inbox-project-filter"
                  value={
                    projectFilter === "all" ? "all" : String(projectFilter)
                  }
                  onChange={(e) => {
                    const next = e.target.value;
                    setProjectFilter(
                      next === "all" ? "all" : Number.parseInt(next, 10),
                    );
                  }}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="all">
                    {t("reviews.inbox.filterAllProjects")}
                  </option>
                  {(projects ?? []).map(
                    (p: { id: number; name: string }) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            {/* Feature-disabled empty state (D-20 silent disable). */}
            {featureDisabled && (
              <div
                data-testid="reviews-inbox-feature-disabled"
                className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              >
                {t("reviews.inbox.featureDisabled")}
              </div>
            )}

            {/* Empty state when no rows match (and feature is enabled). */}
            {!featureDisabled && displayRows.length === 0 && (
              <div
                data-testid="reviews-inbox-empty"
                className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
              >
                {t("reviews.inbox.empty")}
              </div>
            )}

            {/* Table — header row from useColumns(), rows are Link-wrapped
                for keyboard nav + middle-click open-in-new-tab (per the
                D-10 spec's "each row deep-links to the entity detail page"
                + RESEARCH guidance to prefer Link over a useRouter onClick
                handler). */}
            {!featureDisabled && displayRows.length > 0 && (
              <div className="rounded-md border" role="table">
                <div
                  role="row"
                  className="grid grid-cols-[2fr,1.5fr,1.5fr,2fr,1.5fr] gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground"
                >
                  {columns.map((col) => (
                    <div key={col.id ?? String(col.header)} role="columnheader">
                      {typeof col.header === "string" ? col.header : null}
                    </div>
                  ))}
                </div>
                {displayRows.map((row) => {
                  const entityType = row.entityType as
                    | "CASE"
                    | "RUN"
                    | "SESSION";
                  const href = entityDetailHref(
                    entityType,
                    row.projectId,
                    row.entityId,
                  );
                  if (!href) {
                    return null;
                  }
                  return (
                    <Link
                      key={row.id}
                      href={href}
                      data-testid="reviews-inbox-row"
                      data-entity-type={entityType}
                      data-entity-id={row.entityId}
                      data-project-id={row.projectId}
                      role="row"
                      className="grid grid-cols-[2fr,1.5fr,1.5fr,2fr,1.5fr] gap-2 border-b px-4 py-3 text-sm hover:bg-muted/50 last:border-b-0 cursor-pointer"
                    >
                      {/* Entity */}
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-xs text-muted-foreground"
                          data-testid="reviews-inbox-row-entity-type"
                        >
                          {entityType}
                        </span>
                        <span>{`#${row.entityId}`}</span>
                      </div>
                      {/* Project */}
                      <div>{row.project?.name ?? "-"}</div>
                      {/* Requester */}
                      <div>
                        {row.requestedBy?.name ??
                          row.requestedBy?.id ??
                          "-"}
                      </div>
                      {/* Transition */}
                      <div className="text-muted-foreground">
                        {`${row.fromState?.name ?? "?"} → `}
                        <span className="text-foreground">
                          {row.toState?.name ?? "?"}
                        </span>
                      </div>
                      {/* Requested at — keep simple text for the cell so
                          jsdom doesn't trip on date-fns formatting being
                          stripped from the global Tooltip mock. */}
                      <div className="text-muted-foreground">
                        {new Date(row.createdAt).toISOString().slice(0, 10)}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
