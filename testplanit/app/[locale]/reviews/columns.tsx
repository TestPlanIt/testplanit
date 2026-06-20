import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Ban,
  CheckCircle2,
  MessageCircleWarning,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import { RelativeTimeTooltip } from "~/components/RelativeTimeTooltip";
import { ProjectNameDisplay } from "~/components/search/ProjectNameDisplay";
import { SessionNameDisplay } from "~/components/SessionNameDisplay";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { CaseDisplay } from "~/components/tables/CaseDisplay";
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
}

/**
 * Outcome-badge content for the Decided tab. Matches the badge treatment
 * used in `CommentItem` for `REVIEW_DECISION` so the two surfaces read
 * consistently.
 */
function DecisionStatusBadge({
  status,
  t,
}: {
  status: ReviewStatus | null;
  t: TranslateFn;
}) {
  // Filled-background badges so the outcome color is the primary visual
  // signal (success / warning / destructive / neutral), with white text +
  // icon for readable contrast across light + dark themes. Tokens
  // `success` and `warning` come from the project Tailwind config; only
  // `success` has a paired `success-foreground`, so the warning row falls
  // back to plain `text-white`.
  if (status === "APPROVED") {
    return (
      <Badge className="gap-1 bg-success text-success-foreground border-success hover:bg-success/90">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        {t("comments.type.reviewDecision.approved")}
      </Badge>
    );
  }
  if (status === "CHANGES_REQUESTED") {
    return (
      <Badge className="gap-1 bg-warning text-white border-warning hover:bg-warning/90">
        <MessageCircleWarning className="h-3 w-3 shrink-0" />
        {t("comments.type.reviewDecision.changesRequested")}
      </Badge>
    );
  }
  if (status === "REJECTED") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3 shrink-0" />
        {t("comments.type.reviewDecision.rejected")}
      </Badge>
    );
  }
  if (status === "CANCELLED") {
    return (
      <Badge className="gap-1 bg-muted-foreground text-background border-muted-foreground hover:bg-muted-foreground/90">
        <Ban className="h-3 w-3 shrink-0" />
        {t("comments.type.reviewDecision.cancelled")}
      </Badge>
    );
  }
  return <span className="text-muted-foreground">-</span>;
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
}: UseColumnsArgs): ColumnDef<InboxTableRow>[] => {
  return useMemo(() => {
    const baseColumns: ColumnDef<InboxTableRow>[] = [
      {
        id: "entity",
        accessorKey: "entityId",
        header: t("reviews.inbox.columnEntity"),
        enableSorting: true,
        size: 440,
        minSize: 320,
        cell: ({ row }) => {
          const entityType = row.original.entityType as
            | "CASE"
            | "RUN"
            | "SESSION";
          const projectId = row.original.projectId;
          const entityId = row.original.entityId;
          if (entityType === "CASE") {
            const c = caseById.get(entityId);
            if (!c) {
              return (
                <span className="font-mono text-xs text-muted-foreground">{`CASE #${entityId}`}</span>
              );
            }
            return (
              <CaseDisplay
                id={c.id}
                name={c.name}
                source={c.source}
                automated={c.automated}
                hasParameters={c.hasParameters}
                isDeleted={c.isDeleted}
                link={`/projects/repository/${projectId}/${c.id}`}
                size="medium"
                maxLines={2}
              />
            );
          }
          if (entityType === "RUN") {
            const r = testRunById.get(entityId);
            return (
              <TestRunNameDisplay
                testRun={r ?? { id: entityId }}
                projectId={projectId}
                showIcon
              />
            );
          }
          const s = sessionById.get(entityId);
          return (
            <SessionNameDisplay session={s ?? { id: entityId }} showIcon />
          );
        },
      },
      {
        id: "project",
        accessorKey: "projectId",
        header: t("reviews.inbox.columnProject"),
        enableSorting: true,
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
            />
          );
        },
      },
      {
        id: "requester",
        accessorKey: "requestedByUserId",
        header: t("reviews.inbox.columnRequester"),
        enableSorting: true,
        size: 220,
        cell: ({ row }) => {
          const requester = row.original.requestedBy;
          if (!requester) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground border border-muted-foreground/50 cursor-pointer hover:bg-secondary/80 transition-colors [&_*]:cursor-pointer [&_a]:no-underline">
              <UserNameCell userId={requester.id} shrinkLink />
            </span>
          );
        },
      },
      {
        id: "transitionFrom",
        accessorKey: "fromStateId",
        header: t("reviews.inbox.columnTransitionFrom"),
        enableSorting: true,
        size: 100,
        maxSize: 140,
        cell: ({ row }) => (
          // `data-transition-inner` is the sentinel the page-level wrapper
          // keys on to hide the vertical column-divider lines that flank
          // the arrow column.
          //
          // The `[&>span]:!shrink [&>span]:!min-w-0` overrides are how we
          // force WorkflowStateDisplay's outer `shrink-0` span to actually
          // shrink within the cell so the inner `truncate` on the name
          // span engages — without forking that shared component.
          <div
            data-transition-inner
            className="flex min-w-0 max-w-full overflow-hidden [&>span]:!shrink [&>span]:!min-w-0"
          >
            <WorkflowStateDisplay
              state={row.original.fromState as any}
              size="sm"
            />
          </div>
        ),
      },
      {
        id: "transitionArrow",
        // No header — purely visual separator between from/to columns.
        header: () => null,
        enableSorting: false,
        enableHiding: false,
        size: 40,
        maxSize: 40,
        cell: () => (
          <div data-transition-inner>
            <ArrowRight
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        ),
      },
      {
        id: "transitionTo",
        accessorKey: "toStateId",
        header: t("reviews.inbox.columnTransitionTo"),
        enableSorting: true,
        size: 100,
        maxSize: 140,
        cell: ({ row }) => (
          <div className="flex min-w-0 max-w-full overflow-hidden [&>span]:!shrink [&>span]:!min-w-0">
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

    const tailColumn: ColumnDef<InboxTableRow> =
      view === "pending"
        ? {
            id: "actions",
            header: t("reviews.inbox.columnActions"),
            enableSorting: false,
            enableHiding: false,
            size: 122,
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
            cell: ({ row }) => (
              <DecisionStatusBadge status={row.original.status} t={t} />
            ),
          };

    return [...baseColumns, timestampColumn, tailColumn];
  }, [t, view, actions, caseById, testRunById, sessionById]);
};
