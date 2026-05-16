import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ReviewRequest } from "@prisma/client";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  FileCheck,
  ListChecks,
  Play,
  Compass,
} from "lucide-react";
import { useMemo } from "react";

/**
 * Local alias for `useTranslations()`-returned function. Typed as a plain
 * key-to-string function so this hook bypasses the next-intl
 * `NamespacedMessageKeys` union — its accumulated phase-2 size has
 * crossed the TS complexity ceiling (TS2590), and tight key-typing here
 * would either fail to compile or force every caller to pass `{}` as a
 * second arg. See `.planning/phases/02-review-workflow-ux-requester-reviewer/deferred-items.md`
 * for the documented mitigation.
 */
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Shape of a row in the /reviews inbox page. Mirrors the `include` shipped
 * to useFindManyReviewRequest plus the canonical ReviewRequest fields the
 * generated Prisma type exposes. The Plan keeps the type local to the page
 * (not exported to the public API surface) — the inbox is the only consumer.
 */
export interface ExtendedReviewRequest extends ReviewRequest {
  project: { id: number; name: string } | null;
  requestedBy: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  fromState: { id: number; name: string } | null;
  toState: { id: number; name: string } | null;
  assigneeUser: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  assigneeRole: { id: number; name: string } | null;
}

/**
 * Lucide icon per entity type. Reuses icons that already render in the app
 * (PendingReviewBadge uses FileCheck-family iconography, NotificationBell uses
 * Inbox, etc.). The icon-only column maps cleanly onto D-10's "Entity (name +
 * type icon)" spec.
 */
function EntityTypeIcon({
  entityType,
}: {
  entityType: "CASE" | "RUN" | "SESSION";
}) {
  if (entityType === "CASE") {
    return <FileCheck className="h-4 w-4" aria-hidden="true" />;
  }
  if (entityType === "RUN") {
    return <Play className="h-4 w-4" aria-hidden="true" />;
  }
  return <Compass className="h-4 w-4" aria-hidden="true" />;
}

export const useColumns = (
  t: TranslateFn,
): ColumnDef<ExtendedReviewRequest>[] => {
  return useMemo(
    () => [
      {
        id: "entity",
        accessorKey: "entityType",
        header: t("reviews.inbox.columnEntity"),
        enableSorting: true,
        size: 220,
        cell: ({ row }) => {
          const entityType = row.original.entityType as
            | "CASE"
            | "RUN"
            | "SESSION";
          const entityId = row.original.entityId;
          return (
            <div
              className="flex items-center gap-2"
              data-testid="reviews-inbox-row-entity"
            >
              <EntityTypeIcon entityType={entityType} />
              <span
                className="font-mono text-xs text-muted-foreground"
                data-testid="reviews-inbox-row-entity-type"
              >
                {entityType}
              </span>
              <span className="text-sm">{`#${entityId}`}</span>
            </div>
          );
        },
      },
      {
        id: "project",
        accessorKey: "project",
        header: t("reviews.inbox.columnProject"),
        enableSorting: true,
        size: 160,
        cell: ({ row }) => {
          const project = row.original.project;
          return project?.name ? (
            <span className="text-sm">{project.name}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        id: "requester",
        accessorKey: "requestedBy",
        header: t("reviews.inbox.columnRequester"),
        enableSorting: true,
        size: 180,
        cell: ({ row }) => {
          const requester = row.original.requestedBy;
          if (!requester) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <span className="text-sm font-medium">
              {requester.name ?? requester.id}
            </span>
          );
        },
      },
      {
        id: "transition",
        accessorKey: "toStateId",
        header: t("reviews.inbox.columnTransition"),
        enableSorting: true,
        size: 240,
        cell: ({ row }) => {
          const fromState = row.original.fromState;
          const toState = row.original.toState;
          return (
            <div className="flex items-center gap-2 text-sm">
              <span>{fromState?.name ?? "?"}</span>
              <ArrowRight
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <Badge variant="secondary" className="font-normal">
                <ListChecks className="h-3 w-3" aria-hidden="true" />
                {toState?.name ?? "?"}
              </Badge>
            </div>
          );
        },
      },
      {
        id: "requestedAt",
        accessorKey: "createdAt",
        header: t("reviews.inbox.columnRequestedAt"),
        enableSorting: true,
        size: 180,
        cell: ({ getValue }) => {
          const value = getValue() as Date | string | null;
          if (!value) {
            return <span className="text-muted-foreground">-</span>;
          }
          const date = new Date(value);
          const ago = formatDistanceToNow(date, { addSuffix: true });
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground">{ago}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{date.toISOString()}</p>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
    ],
    [t],
  );
};
