"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  ChevronRight,
  ClipboardPlus,
  GripVertical,
  ListChecks,
  MoreVertical,
  SquarePenIcon,
  Trash2Icon,
  ClipboardCheck,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useDrag } from "react-dnd";
// UAT gap 4 reversed Phase 26's decision to keep this column on its own
// standalone coverage badge -- the operator ruled the Coverage column must
// match Milestone details > Issues in display model, so this cell now
// mounts the same `CoverageChip` that table uses (26.2-10).
import { CoverageChip } from "@/[locale]/projects/milestones/[projectId]/[milestoneId]/CoverageChip";
import { DateFormatter } from "@/components/DateFormatter";
import { HighlightedMatch } from "@/components/HighlightedMatch";
import { IterationStatusLegendPopover } from "@/components/iterations/IterationStatusLegendPopover";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoveringCaseRow } from "~/app/api/projects/[projectId]/requirements/[issueId]/covering-cases/route";
import { coverageFor } from "~/hooks/useRequirementCoverage";
import { useRequirementCoveringCases } from "~/hooks/useRequirementCoveringCases";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";
import { ItemTypes } from "~/types/dndTypes";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";
import { cn } from "~/utils";
import {
  formatIssueDisplayText,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { RequirementProvenanceBadge } from "./RequirementProvenanceBadge";
import {
  requirementCoverageSortValue,
  requirementSourceSortValue,
  type RequirementRow,
} from "./requirementsListRows";

/**
 * The name cell's fixed leading geometry, in px, in render order. Declared
 * here rather than only as Tailwind classes because
 * `requirementNestingGuideOffset` below has to place a guide the ENGINE
 * paints (outside this cell, where the row's full height is reachable) at
 * exactly the x these slots produce. One declaration, two readers — a slot
 * that changes width moves the guide with it instead of silently leaving it
 * behind.
 *
 * Keep in step with the JSX: `px-3` on the engine's cell, then
 * `paddingInlineStart: depth * INDENT`, then the `h-4 w-4` drag handle, the
 * `h-5 w-5` chevron, and the `gap-1` between every child.
 */
const NAME_CELL = {
  /** The engine's own `px-3` on every cell. */
  cellPaddingInline: 12,
  indentPerDepth: 24,
  dragHandle: 16,
  chevron: 20,
  /** The wrapper's `gap-1`. */
  gap: 4,
} as const;

/**
 * Where the full-height nesting guide belongs for a row, or `null` for a
 * root. Handed to `<DataTable virtualized getRowNestingGuideOffset>`, which
 * paints it as a sibling of the cell's content wrapper — the only place it
 * can span the row's top and bottom borders, since that wrapper clips to the
 * height of its own text.
 *
 * Lands just past the indent, the drag-handle slot and the chevron slot --
 * in the gap column immediately after the chevron, one gap to the LEFT of
 * the 4px slot the cell reserves (operator UAT: "nudge the bar a little to
 * the left"). That reserved slot stays where it is, so nudging the rule
 * moves only the rule: the type icon and the name keep their x.
 */
export function requirementNestingGuideOffset(depth: number): number | null {
  if (depth <= 0) return null;
  return (
    NAME_CELL.cellPaddingInline +
    depth * NAME_CELL.indentPerDepth +
    NAME_CELL.dragHandle +
    NAME_CELL.gap +
    NAME_CELL.chevron
  );
}

/**
 * The eight columns the tree-table renders through (D-03a, extended by UAT
 * gaps 5/6, plus D-17's Priority column). Deliberately NOT ported from
 * `MemberIssuesColumns.tsx`: no `select` (no bulk action on requirements), no
 * `description` (belongs to the detail panel's Tiptap `Issue.note`). The
 * comparator's single `cases` column IS ported, but split into two --
 * `linkedCases` (this requirement only) and `coveringCases` (its whole
 * subtree) -- because a requirement's own coverage badge already blends both
 * scopes into one number and gap 5/6 asked for the direct-vs-inherited
 * distinction the badge can't show.
 */
export interface RequirementsListColumnsTranslations {
  /** requirements.list.columnName */
  columnName: string;
  /** requirements.list.columnStatus */
  columnStatus: string;
  /** requirements.coverage.title -- an existing key, reused, no new key */
  columnCoverage: string;
  /** requirements.linkedCases.title ("Linked Test Cases") -- an existing
   *  key, reused, no new key */
  columnLinkedCases: string;
  /** requirements.coverage.panelTitle ("Covering Test Cases") -- an
   *  existing key, reused, no new key */
  columnCoveringCases: string;
  /** requirements.list.columnSource */
  columnSource: string;
  /** common.fields.priority -- an existing key, reused, no new key (D-17,
   *  promoted carry-over from the 26.2-17 "Priority column + editable pair"
   *  deferral) */
  columnPriority: string;
  /** common.fields.createdAt -- an existing key, reused, no new key (gap
   *  closure 26.2-17) */
  columnCreatedAt: string;
  /** common.actions.actionsLabel -- existing, reused */
  actionsLabel: string;
}

interface UseRequirementsListColumnsArgs {
  translations: RequirementsListColumnsTranslations;
  projectId: number;
  canAddEdit: boolean;
  isFiltering: boolean;
  normalizedFilter: string;
  coverage: RequirementCoverageResponse | undefined;
  /**
   * `buildDescendantIdMap`'s output: every requirement id mapped to itself
   * plus its whole subtree. NO LONGER READ by this hook (gap closure
   * 26.2-15): the `coveringCases` column's expanded lists moved off this
   * REQUIREMENT-only descendant filter onto the covering-cases drill-down
   * (`useRequirementCoveringCases`), because the filter disagreed with the
   * rollup's own subtree walk whenever a covering case hung off a
   * NON-requirement descendant (ABT-47193's shape -- "+8" in the count,
   * "0 of 8" in the old filtered list). Still accepted (and still computed
   * and passed by `RequirementsListView.tsx`) purely so that call site needs
   * no change; left in place rather than threading a removal through
   * `requirementsListRows.ts`/`RequirementsListView.tsx`, which are outside
   * this gap closure's scope.
   */
  descendantIdsByRequirementId?: Map<number, number[]>;
  expandedByIssueId: Record<number, boolean>;
  onToggleExpand: (issueId: number) => void;
  onSelectRequirement: (issueId: number) => void;
  onAddChild: (requirement: RequirementRow) => void;
  /** Opens the requirement in the detail panel's edit mode. The list holds
   *  no inline editor of its own -- the panel is the single editing
   *  surface, so its own field gating (lock tooltips, note, attachments)
   *  applies uniformly no matter where an edit starts. */
  onRequestEdit: (requirement: RequirementRow) => void;
  onRequestDelete: (requirement: RequirementRow) => void;
  onDetached: () => void;
  /**
   * Plain DOM mutation, owned by `RequirementsListView.tsx` (it owns the
   * list container the affordance CSS keys off of). Called from the name
   * cell's `useDrag` lifecycle only -- NEVER a state setter, so calling
   * these can never trigger a re-render of the (virtualized) row set. See
   * `RequirementsListView.tsx`'s `markDragActive`/`clearDragActive` doc
   * comments for the full contract (gap closure 26.2-16, UAT gap 9 rebuild).
   */
  markDragActive: (draggedId: number) => void;
  clearDragActive: () => void;
}

/**
 * Column defs for the rebuilt requirements list (UI-SPEC §3), mirroring
 * `useMemberIssueColumns`'s shape. Hierarchy lives inside the `name` cell
 * (D-03b) -- no sub-row prop is ever passed to `DataTable`, so no column
 * here is an auto-injected expander well.
 */
export function useRequirementsListColumns({
  translations,
  projectId,
  canAddEdit,
  isFiltering,
  normalizedFilter,
  coverage,
  // `descendantIdsByRequirementId` is intentionally NOT destructured here --
  // see its own doc comment on `UseRequirementsListColumnsArgs` above.
  expandedByIssueId,
  onToggleExpand,
  onSelectRequirement,
  onAddChild,
  onRequestEdit,
  onRequestDelete,
  onDetached,
  markDragActive,
  clearDragActive,
}: UseRequirementsListColumnsArgs): ColumnDef<RequirementRow>[] {
  // "Created At" is an instant, so it renders date AND time in the viewer's
  // preferred formats (operator UAT) -- the same session-preference recipe
  // datasets-list.tsx uses; "PPp" is the no-preference datetime fallback the
  // Issues list already uses for lastSyncedAt.
  const { data: session } = useSession();
  const preferredDateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : "PPp";
  const preferredTimezone = session?.user?.preferences?.timezone || undefined;

  const {
    columnName: tColumnName,
    columnStatus: tColumnStatus,
    columnCoverage: tColumnCoverage,
    columnLinkedCases: tColumnLinkedCases,
    columnCoveringCases: tColumnCoveringCases,
    columnSource: tColumnSource,
    columnPriority: tColumnPriority,
    columnCreatedAt: tColumnCreatedAt,
    actionsLabel: tActionsLabel,
  } = translations;

  return useMemo(() => {
    const columns: ColumnDef<RequirementRow>[] = [
      {
        id: "name",
        accessorFn: (row) => formatIssueDisplayText(row),
        header: tColumnName,
        enableSorting: true,
        enableHiding: false,
        // This column carries the tree: the expand chevrons and the depth
        // indent. The nesting guide is painted from the row's own start, so
        // it stays first while every other column reorders freely.
        meta: { noReorder: true },
        size: 320,
        minSize: 240,
        maxSize: 640,
        cell: ({ row }) => (
          <RequirementNameCell
            requirement={row.original}
            canAddEdit={canAddEdit}
            isFiltering={isFiltering}
            normalizedFilter={normalizedFilter}
            isExpanded={expandedByIssueId[row.original.id] === true}
            onToggleExpand={onToggleExpand}
            onSelectRequirement={onSelectRequirement}
            markDragActive={markDragActive}
            clearDragActive={clearDragActive}
          />
        ),
      },
      {
        id: "status",
        // NOT byte-identical to MemberIssuesColumns.tsx's own status cell --
        // a requirement can be detached from its tracker and then edited
        // locally, a state MemberIssuesColumns has no concept of, so this
        // column reads through the lock-aware
        // `resolveRequirementDisplayStatus` (`utils/issueDisplayText.ts`)
        // instead of an unconditional externalStatus-first fallback.
        accessorFn: (row) => resolveRequirementDisplayStatus(row) ?? "",
        header: tColumnStatus,
        enableSorting: true,
        size: 120,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => (
          <IssueStatusDisplay
            status={resolveRequirementDisplayStatus(row.original)}
            className="capitalize"
          />
        ),
      },
      {
        id: "priority",
        // D-17 (promoted carry-over, 2026-08-25): the 26.2-17 "Priority
        // column + editable pair" deferral, explicitly promoted into Phase
        // 27 by Brad at plan time. Placed directly after Status (operator
        // direction 2026-08-25). Visible by default is the operator's
        // explicit REVERSAL of `createdAt`'s hidden-by-default choice below
        // -- the editable half of the pair is satisfied entirely by
        // `RequirementDetailPanel`'s existing priority field (already
        // shipped, already gated on `isRequirementLocked`); this cell is
        // read-only display only.
        accessorFn: (row) => row.priority ?? "",
        header: tColumnPriority,
        enableSorting: true,
        // Omitted `meta.isVisible` (unlike `createdAt` below) -- this
        // codebase's single-owner visibility convention treats an absent
        // `meta.isVisible` as visible, matching every other column in this
        // file except `createdAt`.
        // Status column's own footprint (both render a short-text Badge),
        // narrower than createdAt's 130px.
        size: 120,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => (
          <div
            className="whitespace-nowrap"
            data-testid={`requirement-priority-cell-${row.original.id}`}
          >
            <IssuePriorityDisplay priority={row.original.priority} />
          </div>
        ),
      },
      {
        id: "coverage",
        // KEPT as the accessor even though the cell now renders through
        // `CoverageChip`: it ranks by `RequirementCoverageBreakdown`'s own
        // four-rung precedence ladder (failed-anywhere-wins), strictly
        // richer than a sum of completed outcomes, and it agrees with the
        // chip's `"no-linked-cases"` gate by construction --
        // `status === "UNCOVERED"` is true exactly when
        // `linkedCaseCount === 0`. See requirementsListRows.ts's D-02a
        // comment.
        accessorFn: (row) =>
          requirementCoverageSortValue(coverageFor(coverage, row.id)),
        header: tColumnCoverage,
        // The legend rides in the header CELL as a SIBLING of the sort-menu
        // trigger (operator UAT) -- through the engine's meta.headerExtra
        // slot, never inside the `header` renderer: header content renders
        // INSIDE the trigger <button>, and the legend is itself a button.
        meta: {
          headerExtra: <IterationStatusLegendPopover projectId={projectId} />,
        },
        enableSorting: true,
        // Sizes match MemberIssuesColumns.tsx's own coverage column exactly
        // -- same display model, same footprint.
        size: 170,
        minSize: 150,
        maxSize: 420,
        cell: ({ row }) => {
          const breakdown = coverageFor(coverage, row.original.id);
          return (
            <div
              className="min-w-0"
              data-testid={`requirement-coverage-cell-${row.original.id}`}
            >
              {/* Coverage that has not loaded yet (or failed to load)
                  renders nothing -- ported from the badge this cell
                  replaces. `CoverageChip` itself treats an undefined
                  breakdown as Uncovered (correct for the milestone surface,
                  which always has a breakdown once its own query resolves),
                  but here `coverageFor` can legitimately return undefined
                  purely because the whole-project rollup hasn't arrived
                  yet, and painting every row Uncovered until then would be
                  the exact false claim F6 exists to prevent. */}
              {breakdown ? (
                <CoverageChip
                  breakdown={breakdown}
                  uncoveredWhen="no-linked-cases"
                />
              ) : null}
            </div>
          );
        },
      },
      {
        id: "coveringCases",
        // Sorts by linkedCaseCount, the whole-subtree counter -- this
        // requirement plus everything beneath it, mirroring the coverage
        // column's own "richer than a sum" precedent of ranking by the
        // rollup's own field rather than re-deriving one.
        accessorFn: (row) =>
          coverageFor(coverage, row.id)?.linkedCaseCount ?? 0,
        header: tColumnCoveringCases,
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 200,
        cell: ({ row }) => {
          const breakdown = coverageFor(coverage, row.original.id);
          const isLoadingCell = breakdown === undefined;
          const linkedCaseCount = breakdown?.linkedCaseCount ?? 0;
          const crossProjectCaseCount = breakdown?.crossProjectCaseCount ?? 0;
          return (
            <RequirementCoveringCasesCell
              rowId={row.original.id}
              projectId={projectId}
              inProjectCount={linkedCaseCount - crossProjectCaseCount}
              otherProjectCount={crossProjectCaseCount}
              isCountLoading={isLoadingCell}
            />
          );
        },
      },
      {
        id: "linkedCases",
        // Sorts by directCaseCount, the SAME counter the cell's in-project
        // badge renders -- cases attached to this requirement ITSELF, never
        // inherited from a descendant.
        accessorFn: (row) =>
          coverageFor(coverage, row.id)?.directCaseCount ?? 0,
        header: tColumnLinkedCases,
        enableSorting: true,
        // Comparator's own cases column footprint (MemberIssuesColumns.tsx),
        // exactly.
        size: 110,
        minSize: 80,
        maxSize: 160,
        cell: ({ row }) => {
          const breakdown = coverageFor(coverage, row.original.id);
          const isLoadingCell = breakdown === undefined;
          const directCaseCount = breakdown?.directCaseCount ?? 0;
          const directCrossProjectCaseCount =
            breakdown?.directCrossProjectCaseCount ?? 0;
          return (
            <RequirementCasesCell
              rowId={row.original.id}
              testIdPrefix="requirement-linked-cases"
              inProjectCount={directCaseCount - directCrossProjectCaseCount}
              otherProjectCount={directCrossProjectCaseCount}
              // isArchived: false is a DELIBERATE divergence from the
              // comparator: these counts come from the coverage rollup
              // (lib/services/requirementCoverage.ts), which already
              // excludes archived cases, while the comparator's caseCount
              // comes from /api/issues/counts, which does not. Without this
              // flag the badge and its expanded list could disagree.
              inProjectFilter={{
                caseIssues: { some: { issueId: row.original.id } },
                projectId,
                isArchived: false,
              }}
              otherProjectFilter={{
                caseIssues: { some: { issueId: row.original.id } },
                projectId: { not: projectId },
                isArchived: false,
              }}
              isLoading={isLoadingCell}
            />
          );
        },
      },
      {
        id: "source",
        accessorFn: (row) => requirementSourceSortValue(row),
        header: tColumnSource,
        enableSorting: true,
        // Narrowed from 170 to 140 (D-11c) to help buy back width for the
        // two new case-count columns under `enableColumnPinning` -- the
        // provenance badge this cell renders through fits comfortably at
        // this width.
        size: 140,
        minSize: 60,
        maxSize: 260,
        // No className passed in here either -- same reasoning as coverage.
        cell: ({ row }) => (
          <RequirementProvenanceBadge
            requirement={row.original}
            projectId={projectId}
            onDetached={onDetached}
          />
        ),
      },
      {
        id: "createdAt",
        // Gap closure 26.2-17 (operator-directed, 2026-08-25): Created/Updated
        // were meant to ship as a pair, but `Issue` has no `updatedAt` column
        // (only `createdAt`) -- adding one is a schema change the plan
        // explicitly ruled out, so only `createdAt` is implemented here. See
        // this plan's SUMMARY for the full note.
        accessorFn: (row) => row.createdAt,
        header: tColumnCreatedAt,
        enableSorting: true,
        // Hidden by default (single-owner visibility rule: `meta.isVisible`,
        // never a `toggleVisibility` call) -- the operator asked for this pair
        // OFF until explicitly turned on through the column-visibility menu.
        meta: { isVisible: false },
        size: 130,
        minSize: 100,
        maxSize: 200,
        cell: ({ row }) => (
          <div
            className="whitespace-nowrap text-sm"
            data-testid={`requirement-createdAt-cell-${row.original.id}`}
          >
            <DateFormatter
              date={row.original.createdAt}
              formatString={preferredDateTimeFormat}
              timezone={preferredTimezone}
            />
          </div>
        ),
      },
    ];

    // A viewer who cannot edit gets no dead actions column at all.
    if (canAddEdit) {
      columns.push({
        id: "actions",
        // Centered icon header, matching MemberIssuesColumns.tsx's own
        // Activity-icon actions header exactly.
        header: ({ column }) => (
          <div
            className="flex justify-center"
            style={{ width: Math.max(column.getSize() - 24, 0) }}
          >
            <Activity
              className="h-4 w-4 text-muted-foreground"
              aria-label={tActionsLabel}
            />
          </div>
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 64,
        minSize: 56,
        maxSize: 100,
        cell: ({ row }) => (
          // Centered like the header's own justify-center icon well --
          // without this the kebab hugs the cell's start edge (operator UAT).
          <div className="flex justify-center">
            <RequirementRowActionsMenu
              requirement={row.original}
              onAddChild={onAddChild}
              onRequestEdit={onRequestEdit}
              onRequestDelete={onRequestDelete}
            />
          </div>
        ),
      });
    }

    return columns;
  }, [
    tColumnName,
    tColumnStatus,
    tColumnCoverage,
    tColumnLinkedCases,
    tColumnCoveringCases,
    tColumnSource,
    tColumnPriority,
    tColumnCreatedAt,
    tActionsLabel,
    projectId,
    canAddEdit,
    isFiltering,
    normalizedFilter,
    coverage,
    expandedByIssueId,
    onToggleExpand,
    onSelectRequirement,
    onAddChild,
    onRequestEdit,
    onRequestDelete,
    onDetached,
    markDragActive,
    clearDragActive,
    preferredDateTimeFormat,
    preferredTimezone,
  ]);
}

interface RequirementCasesCellProps {
  rowId: number;
  /** Base test id, WITHOUT the row id -- e.g. `"requirement-linked-cases"`.
   *  The cell itself renders `${testIdPrefix}-${rowId}`, and the
   *  cross-project span renders `${testIdPrefix}-other-${rowId}`. */
  testIdPrefix: string;
  inProjectCount: number;
  otherProjectCount: number;
  inProjectFilter: RepositoryCasesWhereInput;
  otherProjectFilter: RepositoryCasesWhereInput;
  isLoading: boolean;
}

/**
 * The comparator's count-plus-expandable-list pair
 * (`MemberIssuesColumns.tsx` lines 100-131/387-423), transplanted into ONE
 * shared component so `linkedCases` and `coveringCases` cannot drift apart.
 * Both `CasesListDisplay` reads go through `/api/model/RepositoryCases`,
 * which ZenStack policy-scopes to the viewer's accessible projects -- the
 * filters below only ever ADD scope (`projectId`, `isArchived: false`),
 * never widen it (T-26.2G-11-01).
 */
function RequirementCasesCell({
  rowId,
  testIdPrefix,
  inProjectCount,
  otherProjectCount,
  inProjectFilter,
  otherProjectFilter,
  isLoading,
}: RequirementCasesCellProps) {
  const t = useTranslations("milestones.members");
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      data-testid={`${testIdPrefix}-${rowId}`}
    >
      <CasesListDisplay
        count={inProjectCount}
        filter={inProjectFilter}
        showProject
        isLoading={isLoading}
      />
      {/* Absent entirely at zero (never a "+0" badge) -- ported verbatim
          from `OtherProjectCasesTotal`'s own `count <= 0` gate. Also absent
          while loading: the real count isn't known yet, and showing "+0"
          during that window would be the exact false claim this column
          exists to avoid. */}
      {!isLoading && otherProjectCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-testid={`${testIdPrefix}-other-${rowId}`}>
              <CasesListDisplay
                count={otherProjectCount}
                filter={otherProjectFilter}
                showProject
                openInNewTab
                triggerPrefix="+"
                triggerVariant="outline"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("casesOtherProjects", { count: otherProjectCount })}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface RequirementCoveringCasesCellProps {
  rowId: number;
  projectId: number;
  inProjectCount: number;
  otherProjectCount: number;
  /** `coverageFor(coverage, rowId) === undefined` -- the rollup breakdown
   *  itself hasn't loaded yet. Unrelated to the drill-down fetch below. */
  isCountLoading: boolean;
}

/**
 * Gap closure 26.2-15 (UAT gap 11): the covering column's counts come from
 * the coverage rollup (`requirementCoverage.ts`'s recursive subtree walk,
 * which descends through non-requirement children too), but its expanded
 * lists used to come from a client-side ZenStack filter keyed on
 * `descendantIdsByRequirementId` -- a REQUIREMENT-only descendant set. The
 * two subtree definitions disagree whenever a covering case hangs off a
 * non-requirement descendant (ABT-47193's shape: crossProjectCaseCount: 8,
 * zero requirement descendants beyond itself -- the old filter rendered
 * "0 of 8"). This cell instead lazy-fetches the SAME per-requirement
 * covering-cases drill-down `RequirementCoveragePanel.tsx` (the detail
 * panel) already renders correctly, and splits its rows client-side by
 * `projectId` -- one subtree definition, shared by the count and the list.
 */
function RequirementCoveringCasesCell({
  rowId,
  projectId,
  inProjectCount,
  otherProjectCount,
  isCountLoading,
}: RequirementCoveringCasesCellProps) {
  const t = useTranslations("milestones.members");
  const tCoverage = useTranslations("requirements.coverage");

  // Lazy, and only once the cell has actually been opened -- mirrors
  // `useRequirementCoveringCases`'s own "enabled on both ids finite"
  // contract, gated one level further so a row merely being visible in the
  // virtualized table (unopened) never fires the request. `expanded` never
  // resets back to false once true: the cache underneath (`staleTime:
  // 30000`, invalidated explicitly by link/unlink/reparent/create/delete
  // per 26.1) is what keeps a re-opened popover cheap, not remounting.
  const [expanded, setExpanded] = useState(false);
  const handleOpenChange = useCallback((open: boolean) => {
    if (open) setExpanded(true);
  }, []);

  const {
    data,
    isLoading: isCasesLoading,
    isError,
  } = useRequirementCoveringCases(
    expanded ? projectId : undefined,
    expanded ? rowId : undefined
  );

  const cases = data?.cases;
  const inProjectRows = useMemo(
    () => (cases ?? []).filter((c) => c.projectId === projectId),
    [cases, projectId]
  );
  const otherProjectRows = useMemo(
    () => (cases ?? []).filter((c) => c.projectId !== projectId),
    [cases, projectId]
  );

  if (isCountLoading) {
    return (
      <div
        className="flex items-center justify-center gap-1.5"
        data-testid={`requirement-covering-cases-${rowId}`}
      >
        <Skeleton className="h-6 w-12" />
      </div>
    );
  }

  // F6 (never render an empty list as if it were the truth): a failed
  // drill-down fetch renders the ALREADY-TRUSTED rollup count as plain,
  // non-interactive text -- never a clickable trigger backed by an empty
  // list, which is the exact "0 of N" failure this cell exists to fix.
  const fetchFailed = expanded && isError;

  return (
    <div
      className="flex items-center justify-center gap-1.5"
      data-testid={`requirement-covering-cases-${rowId}`}
    >
      {inProjectCount > 0 &&
        (fetchFailed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground">
                {inProjectCount}
              </span>
            </TooltipTrigger>
            <TooltipContent>{tCoverage("loadFailed")}</TooltipContent>
          </Tooltip>
        ) : (
          <CoveringCasesPopover
            triggerTestId={`requirement-covering-cases-trigger-${rowId}`}
            rows={inProjectRows}
            count={inProjectCount}
            showProject
            isLoading={expanded && isCasesLoading}
            onOpenChange={handleOpenChange}
          />
        ))}
      {/* Absent entirely at zero (never a "+0" badge), mirroring
          `RequirementCasesCell`'s own rule -- sourced from the rollup's
          crossProjectCaseCount, never from the (lazy, possibly still
          unfetched) drill-down rows. */}
      {otherProjectCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span data-testid={`requirement-covering-cases-other-${rowId}`}>
              {fetchFailed ? (
                <span
                  className={cn(
                    badgeVariants({ variant: "outline" }),
                    "gap-1 whitespace-nowrap text-xs"
                  )}
                >
                  {`+${otherProjectCount}`}
                </span>
              ) : (
                <CoveringCasesPopover
                  triggerTestId={`requirement-covering-cases-other-trigger-${rowId}`}
                  rows={otherProjectRows}
                  count={otherProjectCount}
                  showProject
                  triggerPrefix="+"
                  triggerVariant="outline"
                  isLoading={expanded && isCasesLoading}
                  onOpenChange={handleOpenChange}
                />
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {fetchFailed
              ? tCoverage("loadFailed")
              : t("casesOtherProjects", { count: otherProjectCount })}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface CoveringCasesPopoverProps {
  triggerTestId: string;
  rows: RequirementCoveringCaseRow[];
  count: number;
  /** Every list shows each row's own `projectName` next to its case
   *  (operator decision 2026-08-25) -- both the in-project and the
   *  cross-project triggers pass this, mirroring `RequirementCasesCell`. */
  showProject?: boolean;
  triggerPrefix?: string;
  triggerVariant?: "default" | "outline";
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The trigger-badge-plus-dropdown-list shape `CasesListDisplay` renders,
 * mirrored for a list that is already fully in memory (the covering-cases
 * drill-down has no server-side search/pagination of its own) rather than
 * `AsyncCombobox`'s fetch-per-keystroke contract.
 */
function CoveringCasesPopover({
  triggerTestId,
  rows,
  count,
  showProject = false,
  triggerPrefix,
  triggerVariant = "default",
  isLoading,
  onOpenChange,
}: CoveringCasesPopoverProps) {
  const t = useTranslations("common");
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={triggerTestId}
          className={cn(
            badgeVariants({ variant: triggerVariant }),
            "gap-1 whitespace-nowrap text-xs"
          )}
        >
          <ListChecks className="h-4 w-4" />
          <span>{triggerPrefix ? `${triggerPrefix}${count}` : count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[320px] w-[360px] max-w-[480px] overflow-y-auto p-1"
      >
        {isLoading ? (
          <div
            className="flex justify-center p-3"
            data-testid="requirement-covering-cases-popover-loading"
          >
            <LoadingSpinner />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            {t("labels.noResults")}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.caseId}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted"
              data-testid={`requirement-covering-case-option-${row.caseId}`}
            >
              <TestCaseNameDisplay
                testCase={{ id: row.caseId, name: row.caseName }}
                projectId={row.projectId}
                className="text-sm"
              />
              {showProject && (
                <ProjectNameDisplay
                  projectName={row.projectName}
                  projectId={row.projectId}
                  className="shrink-0 text-xs text-muted-foreground"
                  fitContainer
                />
              )}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

interface RequirementDragItem {
  requirementId: number;
  name: string;
}

interface RequirementNameCellProps {
  requirement: RequirementRow;
  canAddEdit: boolean;
  isFiltering: boolean;
  normalizedFilter: string;
  isExpanded: boolean;
  onToggleExpand: (issueId: number) => void;
  onSelectRequirement: (issueId: number) => void;
  /** See `UseRequirementsListColumnsArgs`'s doc comment -- plain DOM
   *  mutation, never a state setter. */
  markDragActive: (draggedId: number) => void;
  clearDragActive: () => void;
}

/**
 * Hierarchy, drag source and click-to-select all live in this one cell
 * (D-03b/D-03e). Indent is an inline style, never a dynamically-built
 * Tailwind class -- the depth-scaled offset below mirrors the old tree's
 * own `indent={24}`. The drag source uses the browser's own default drag
 * image; this deliberately skips the empty-drag-preview convention some
 * other tables in this codebase use.
 */
function RequirementNameCell({
  requirement,
  canAddEdit,
  isFiltering,
  normalizedFilter,
  isExpanded,
  onToggleExpand,
  onSelectRequirement,
  markDragActive,
  clearDragActive,
}: RequirementNameCellProps) {
  const t = useTranslations();
  const label = formatIssueDisplayText(requirement);

  // Single source of truth for "can this row be dragged": the grip handle,
  // `canDrag`, and the tooltip below all derive from this exact expression
  // (T-26.2G-16-02), so the affordance can never outrun the gate. The
  // reparent route's schema-level @deny on a synced, non-detached
  // requirement's parentId (its own 403 backstop) is the actual authority
  // here -- this client-side narrowing only ever REMOVES an offer the
  // server would refuse anyway (gap closure 26.2-16, gap 9 rebuild + gap 14
  // follow-up).
  const canDragRow =
    canAddEdit && !isFiltering && !isRequirementLocked(requirement);

  const [{ isDragging }, dragRef] = useDrag<
    RequirementDragItem,
    void,
    { isDragging: boolean }
  >(
    () => ({
      type: ItemTypes.REQUIREMENT,
      // A function, not a static object: react-dnd calls this once at
      // dragstart, which is exactly where the DOM-attribute side effect
      // below must run (gap closure 26.2-16 -- no React state involved).
      item: () => {
        markDragActive(requirement.id);
        return { requirementId: requirement.id, name: label };
      },
      canDrag: () => canDragRow,
      // Fires on both drop and cancel (react-dnd's own contract) -- the
      // primary cleanup path.
      end: () => {
        clearDragActive();
      },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [requirement.id, label, canDragRow, markDragActive, clearDragActive]
  );

  return (
    <div
      ref={(el) => {
        dragRef(el);
      }}
      className={cn(
        // `relative` positions the nesting guide below. The guide spans this
        // wrapper's height rather than the whole row: the engine wraps every
        // cell's content in its own `flex-1 truncate` div, which sizes to the
        // content, so a full-bleed rule would need a second shared-component
        // change to earn ~20px of height it does not need.
        "relative flex min-w-0 items-center gap-1 cursor-pointer",
        isDragging && "opacity-30"
      )}
      style={{
        paddingInlineStart: requirement.depth * NAME_CELL.indentPerDepth,
      }}
      onClick={() => onSelectRequirement(requirement.id)}
      // Belt-and-braces (gap closure 26.2-16): a native `dragend` listener
      // alongside react-dnd's own `end()` above, so a drag whose `end()`
      // never fires (e.g. an unmount race) can never strand the attribute.
      // `clearDragActive` is idempotent -- see its own doc comment.
      onDragEnd={() => clearDragActive()}
      data-testid={`requirement-name-cell-${requirement.id}`}
      title={
        isRequirementLocked(requirement)
          ? t("requirements.list.dragLockedSynced")
          : !canAddEdit || isFiltering
            ? t("requirements.tree.dragDisabled")
            : undefined
      }
    >
      {canDragRow ? (
        <GripVertical
          className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
          aria-hidden="true"
          data-testid={`requirement-drag-handle-${requirement.id}`}
        />
      ) : (
        // Locked/non-draggable rows reserve the grip's exact slot so the
        // requirement icon and name start at the same x position on every
        // row -- a conditionally absent handle makes mixed synced/manual
        // lists ragged (operator UAT, gap 15a).
        <span
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
          data-testid={`requirement-drag-handle-spacer-${requirement.id}`}
        />
      )}
      {requirement.hasChildren ? (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand(requirement.id);
          }}
          aria-label={
            isExpanded
              ? t("requirements.list.collapseRow", { name: label })
              : t("requirements.list.expandRow", { name: label })
          }
          data-testid={`requirement-chevron-${requirement.id}`}
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 transition-transform",
              isExpanded && "rotate-90"
            )}
          />
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      {/* Reserves the guide's own column so the type icon never sits under
          it. The RULE itself is painted by the table engine
          (`getRowNestingGuideOffset`), not here: it has to reach the row's
          top and bottom borders, and every cell's content is wrapped in a
          `flex-1 truncate` div that clips to the text's own height. */}
      {requirement.depth > 0 && (
        <span
          aria-hidden="true"
          data-testid={`requirement-nesting-guide-slot-${requirement.id}`}
          className="w-1 shrink-0"
        />
      )}
      <IssueTypeIcon
        fallbackIcon={ClipboardCheck}
        issueTypeName={requirement.issueTypeName}
        iconUrl={requirement.issueTypeIconUrl}
        className="h-4 w-4 shrink-0"
      />
      {/* `flex-auto`, never `flex-1` -- this repo's recorded trap:
          `flex-1`'s zero basis disables every sibling's shrink weight. */}
      <span className="min-w-0 flex-auto truncate text-sm" title={label}>
        <HighlightedMatch
          text={label}
          query={normalizedFilter}
          testId="requirement-filter-match"
        />
      </span>
    </div>
  );
}

interface RequirementRowActionsMenuProps {
  requirement: RequirementRow;
  onAddChild: (requirement: RequirementRow) => void;
  onRequestEdit: (requirement: RequirementRow) => void;
  onRequestDelete: (requirement: RequirementRow) => void;
}

/**
 * Ported from the earlier react-arborist tree component's own row action
 * menu verbatim in structure and `data-testid`s. Drops the old `invisible
 * group-hover:visible` wrapper -- in a real column the kebab has its own
 * cell and should always be visible.
 */
function RequirementRowActionsMenu({
  requirement,
  onAddChild,
  onRequestEdit,
  onRequestDelete,
}: RequirementRowActionsMenuProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 p-0"
          aria-label={t("common.actions.actionsLabel")}
          data-testid={`requirement-actions-trigger-${requirement.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onClick={() => onAddChild(requirement)}
          data-testid={`requirement-action-add-child-${requirement.id}`}
        >
          <div className="flex items-center gap-2">
            <ClipboardPlus className="h-4 w-4" />
            {t("requirements.tree.addChild")}
          </div>
        </DropdownMenuItem>
        {/* Enabled on locked rows too, exactly like the detail panel's own
            Edit button: edit mode is still meaningful there (documentation
            and attachments stay editable; the locked scalars explain
            themselves with their own tooltips). */}
        <DropdownMenuItem
          onClick={() => onRequestEdit(requirement)}
          data-testid={`requirement-action-edit-${requirement.id}`}
        >
          <div className="flex items-center gap-2">
            <SquarePenIcon className="h-4 w-4" />
            {t("common.actions.edit")}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onRequestDelete(requirement)}
          className="text-destructive"
          data-testid={`requirement-action-delete-${requirement.id}`}
        >
          <div className="flex items-center gap-2">
            <Trash2Icon className="h-4 w-4" />
            {t("requirements.tree.delete")}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
