import { Button } from "@/components/ui/button";
import { ReviewDecisionBadge } from "@/components/comments/CommentTypeBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  RepositoryCaseSource,
  ReviewRequest,
  ReviewStatus,
} from "~/zenstack/models";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowRight,
  CheckCircle2,
  MessageCircleWarning,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import { RelativeTimeTooltip } from "~/components/RelativeTimeTooltip";
import { ProjectNameDisplay } from "~/components/search/ProjectNameDisplay";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { CaseDisplay } from "~/components/tables/CaseDisplay";
import { SessionTableDisplay } from "~/components/tables/SessionTableDisplay";
import type { CustomColumnMeta } from "~/components/tables/ColumnSelection";
import { UserNameCell } from "~/components/tables/UserNameCell";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import type { IconName } from "~/types/globals";

/**
 * Local alias for `useTranslations()`-returned function. Typed as a plain
 * key-to-string function so this hook bypasses the next-intl
 * `NamespacedMessageKeys` union — its accumulated phase-2 size has
 * crossed the TS complexity ceiling (TS2590).
 */
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Workflow-state shape `WorkflowStateDisplay` expects. The inbox fetches it
 * via the ReviewRequest include on `fromState` and `toState`.
 */
interface InboxWorkflowState {
  id: number;
  name: string;
  icon: { name: IconName } | null;
  color: { value: string } | null;
}

/**
 * Cached entity-name shapes — keyed by id so the column cells can resolve
 * polymorphic entity refs (CASE/RUN/SESSION) into the right display
 * component without forcing the ReviewRequest query to carry the union.
 */
export interface InboxCaseRow {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  automated?: boolean;
  hasParameters?: boolean;
  isDeleted?: boolean;
}

export interface InboxTestRunRow {
  id: number;
  name: string;
  isDeleted?: boolean;
  compositionLockedAt?: Date | string | null;
}

export interface InboxSessionRow {
  id: number;
  name: string;
  isDeleted?: boolean;
}

/**
 * Shape of a row in the /reviews inbox page. Mirrors the `include` shipped
 * to useFindManyReviewRequest plus the canonical ReviewRequest fields the
 * generated Prisma type exposes.
 */
export interface ExtendedReviewRequest extends ReviewRequest {
  project: { id: number; name: string; iconUrl: string | null } | null;
  requestedBy: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  fromState: InboxWorkflowState | null;
  toState: InboxWorkflowState | null;
  assigneeUser: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
  assigneeRole: { id: number; name: string } | null;
  decidedBy?: {
    id: string;
    name: string | null;
    image: string | null;
  } | null;
}

/**
 * `DataTable` requires every row to carry an `id` and `name`. The
 * ReviewRequest id is already a string; `name` is synthesized from the
 * row at the page level (e.g. "CASE #106177") so DataTable's internal
 * selectedItemsForDrag / scroll-to-row plumbing has a stable label.
 */
export type InboxTableRow = ExtendedReviewRequest & { name: string };

/**
 * Callbacks the inbox table wires into each row's inline action buttons.
 * The table owns the dialog state — these callbacks just record which row
 * the reviewer is acting on so the right dialog opens with the right id.
 */
export interface InboxActionHandlers {
  onApprove: (row: ExtendedReviewRequest) => void;
  onRequestChanges: (row: ExtendedReviewRequest) => void;
  onReject: (row: ExtendedReviewRequest) => void;
}

/**
 * Inbox tab mode. `pending` renders the queue the reviewer still needs to
 * act on (Actions column visible); `decided` renders the reviewer's
 * history (Status column with the outcome badge, Decided-at timestamp,
 * no Actions column).
 */
export type InboxView = "pending" | "decided";

interface UseColumnsArgs {
  t: TranslateFn;
  view: InboxView;
  /** Required when `view === 'pending'`. Ignored on the Decided tab. */
  actions?: InboxActionHandlers;
  caseById: Map<number, InboxCaseRow>;
  testRunById: Map<number, InboxTestRunRow>;
  sessionById: Map<number, InboxSessionRow>;
  /**
   * When set, a plain click on a CASE row's name opens the docked details
   * panel instead of navigating to the full case page. Modified and middle
   * clicks still follow the link, so "open in a new tab" keeps working.
   */
  onOpenCase?: (caseId: number, projectId: number) => void;
}

/**
 * Outcome-badge content for the Decided tab. Delegates the per-status
 * visuals to the shared `ReviewDecisionBadge`; undecided rows render a
 * plain dash.
 */
function DecisionStatusBadge({ status }: { status: ReviewStatus | null }) {
  if (
    status !== "APPROVED" &&
    status !== "CHANGES_REQUESTED" &&
    status !== "REJECTED" &&
    status !== "CANCELLED"
  ) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <ReviewDecisionBadge status={status} />;
}

/**
 * Row action button — small ghost-variant icon button with a tooltip.
 */
function ActionIconButton({
  label,
  testId,
  icon: Icon,
  onClick,
  iconClassName,
}: {
  label: string;
  testId: string;
  icon: typeof CheckCircle2;
  onClick: (e: React.MouseEvent) => void;
  iconClassName?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            // DataTable rows can fire `onTestCaseClick` on row click. Stop
            // here so inline decision actions never bubble into row-level
            // navigation.
            e.stopPropagation();
            onClick(e);
          }}
          data-testid={testId}
          aria-label={label}
        >
          <Icon className={iconClassName ?? "h-4 w-4"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const useColumns = ({
  t,
  view,
  actions,
  caseById,
  testRunById,
  sessionById,
  onOpenCase,
}: UseColumnsArgs): ColumnDef<InboxTableRow>[] => {
  return useMemo(() => {
    const baseColumns: ColumnDef<InboxTableRow>[] = [
      {
        id: "entity",
        accessorKey: "entityId",
        header: t("reviews.inbox.columnEntity"),
        enableSorting: true,
        size: 440,
        minSize: 100,
        meta: { isPinned: "left" } satisfies CustomColumnMeta,
        cell: ({ row }) => {
          const entityType = row.original.entityType as
            "CASE" | "RUN" | "SESSION";
          const projectId = row.original.projectId;
          const entityId = row.original.entityId;
          if (entityType === "CASE") {
            const c = caseById.get(entityId);
            if (!c) {
              return (
                <span className="font-mono text-xs text-muted-foreground">{`CASE #${entityId}`}</span>
              );
            }
            const display = (
              <CaseDisplay
                id={c.id}
                name={c.name}
                source={c.source}
                automated={c.automated}
                hasParameters={c.hasParameters}
                isDeleted={c.isDeleted}
                link={
                  c.isDeleted
                    ? undefined
                    : `/projects/repository/${projectId}/${c.id}`
                }
                size="medium"
                maxLines={1}
              />
            );
            if (!onOpenCase || c.isDeleted) return display;
            // Capture phase so this runs before the `next-intl` Link's own
            // click handler — stopping propagation there is what keeps the
            // reviewer on the inbox and opens the docked panel instead.
            // Modified / non-primary clicks fall through untouched so the
            // full case page still opens in a new tab.
            return (
              <div
                className="min-w-0"
                onClickCapture={(e) => {
                  if (
                    e.metaKey ||
                    e.ctrlKey ||
                    e.shiftKey ||
                    e.altKey ||
                    e.button !== 0
                  ) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenCase(c.id, projectId);
                }}
              >
                {display}
              </div>
            );
          }
          if (entityType === "RUN") {
            const r = testRunById.get(entityId);
            return (
              <TestRunNameDisplay
                testRun={r ?? { id: entityId }}
                projectId={projectId}
                showIcon
                className="truncate"
              />
            );
          }
          const s = sessionById.get(entityId);
          return (
            <SessionTableDisplay
              id={entityId}
              name={s?.name ?? `Session ${entityId}`}
              link={`/projects/sessions/${projectId}/${entityId}`}
              maxLines={1}
            />
          );
        },
      },
      {
        id: "project",
        accessorKey: "projectId",
        header: t("reviews.inbox.columnProject"),
        enableSorting: true,
        minSize: 110,
        size: 220,
        cell: ({ row }) => {
          const project = row.original.project;
          if (!project) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <ProjectNameDisplay
              projectName={project.name}
              projectId={project.id}
              iconUrl={project.iconUrl}
              showLink
              fitContainer
            />
          );
        },
      },
      {
        id: "requester",
        accessorKey: "requestedByUserId",
        header: t("reviews.inbox.columnRequester"),
        enableSorting: true,
        minSize: 125,
        size: 220,
        cell: ({ row }) => {
          const requester = row.original.requestedBy;
          if (!requester) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-muted-foreground/50 bg-secondary px-1 py-0 text-xs text-secondary-foreground transition-colors hover:bg-secondary/80 cursor-pointer [&_*]:cursor-pointer [&_a]:no-underline">
              <UserNameCell userId={requester.id} shrinkLink />
            </span>
          );
        },
      },
      {
        id: "transition",
        // Sorts by destination — the state a reviewer is being asked to
        // approve into is the one worth grouping the queue by.
        accessorKey: "toStateId",
        header: t("reviews.inbox.columnTransition"),
        enableSorting: true,
        minSize: 180,
        size: 260,
        cell: ({ row }) => (
          // `[&>span]:!shrink [&>span]:!min-w-0` forces WorkflowStateDisplay's
          // outer `shrink-0` span to shrink so its inner `truncate` engages,
          // without forking that shared component.
          <div className="flex min-w-0 max-w-full items-center gap-1 overflow-hidden [&>span]:!shrink [&>span]:!min-w-0">
            <WorkflowStateDisplay
              state={row.original.fromState as any}
              size="sm"
            />
            <ArrowRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <WorkflowStateDisplay
              state={row.original.toState as any}
              size="sm"
            />
          </div>
        ),
      },
    ];

    // Pending tab → relative `Requested at` + Actions column.
    // Decided tab → relative `Decided at` + outcome Status badge.
    const timestampColumn: ColumnDef<InboxTableRow> =
      view === "pending"
        ? {
            id: "requestedAt",
            accessorKey: "createdAt",
            header: t("reviews.inbox.columnRequestedAt"),
            enableSorting: true,
            size: 160,
            minSize: 150,

            cell: ({ getValue }) => {
              const value = getValue() as Date | string | null;
              if (!value) {
                return <span className="text-muted-foreground">-</span>;
              }
              // Truncate with ellipsis instead of wrapping when the
              // column is narrow — RelativeTimeTooltip's tooltip still
              // surfaces the absolute timestamp on hover, so the
              // ellipsis doesn't hide any actionable info.
              return (
                <div className="text-sm text-muted-foreground truncate">
                  <RelativeTimeTooltip
                    date={value}
                    className="truncate block"
                  />
                </div>
              );
            },
          }
        : {
            id: "decidedAt",
            accessorKey: "decidedAt",
            header: t("reviews.inbox.columnDecidedAt"),
            enableSorting: true,
            size: 160,
            minSize: 150,
            cell: ({ getValue }) => {
              const value = getValue() as Date | string | null;
              if (!value) {
                return <span className="text-muted-foreground">-</span>;
              }
              return (
                <div className="text-sm text-muted-foreground truncate">
                  <RelativeTimeTooltip
                    date={value}
                    className="truncate block"
                  />
                </div>
              );
            },
          };

    // Decided tab only — the tab now lists decisions on reviews the viewer
    // requested alongside their own decisions, so the row has to say who
    // actually decided it.
    const decidedByColumn: ColumnDef<InboxTableRow> = {
      id: "decidedBy",
      accessorKey: "decidedByUserId",
      header: t("reviews.inbox.columnDecidedBy"),
      enableSorting: true,
      minSize: 125,
      size: 220,
      cell: ({ row }) => {
        const decidedBy = row.original.decidedBy;
        if (!decidedBy) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-muted-foreground/50 bg-secondary px-1 py-0 text-xs text-secondary-foreground transition-colors hover:bg-secondary/80 cursor-pointer [&_*]:cursor-pointer [&_a]:no-underline">
            <UserNameCell userId={decidedBy.id} shrinkLink />
          </span>
        );
      },
    };

    const tailColumn: ColumnDef<InboxTableRow> =
      view === "pending"
        ? {
            id: "actions",
            header: t("reviews.inbox.columnActions"),
            enableSorting: false,
            enableHiding: false,
            size: 122,
            meta: { isPinned: "right" } satisfies CustomColumnMeta,
            cell: ({ row }) => (
              <div
                className="flex items-center gap-1"
                data-testid="reviews-inbox-row-actions"
              >
                <ActionIconButton
                  label={t("reviews.inbox.actionApprove")}
                  testId={`reviews-inbox-approve-${row.original.id}`}
                  icon={CheckCircle2}
                  onClick={() => actions?.onApprove(row.original)}
                  iconClassName="h-4 w-4 text-emerald-500"
                />
                <ActionIconButton
                  label={t("reviews.inbox.actionRequestChanges")}
                  testId={`reviews-inbox-request-changes-${row.original.id}`}
                  icon={MessageCircleWarning}
                  onClick={() => actions?.onRequestChanges(row.original)}
                  iconClassName="h-4 w-4 text-amber-500"
                />
                <ActionIconButton
                  label={t("reviews.inbox.actionReject")}
                  testId={`reviews-inbox-reject-${row.original.id}`}
                  icon={XCircle}
                  onClick={() => actions?.onReject(row.original)}
                  iconClassName="h-4 w-4 text-destructive"
                />
              </div>
            ),
          }
        : {
            id: "status",
            accessorKey: "status",
            header: t("reviews.inbox.columnStatus"),
            enableSorting: true,
            size: 180,
            meta: { isPinned: "right" } satisfies CustomColumnMeta,
            cell: ({ row }) => (
              <DecisionStatusBadge status={row.original.status} />
            ),
          };

    return view === "decided"
      ? [...baseColumns, decidedByColumn, timestampColumn, tailColumn]
      : [...baseColumns, timestampColumn, tailColumn];
  }, [t, view, actions, caseById, testRunById, sessionById, onOpenCase]);
};
