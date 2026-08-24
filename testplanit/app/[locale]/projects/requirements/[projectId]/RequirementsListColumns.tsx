"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  ChevronRight,
  ClipboardPlus,
  MoreVertical,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import { useDrag } from "react-dnd";
// UAT gap 4 reversed Phase 26's decision to keep this column on its own
// standalone coverage badge -- the operator ruled the Coverage column must
// match Milestone details > Issues in display model, so this cell now
// mounts the same `CoverageChip` that table uses (26.2-10).
import { CoverageChip } from "@/[locale]/projects/milestones/[projectId]/[milestoneId]/CoverageChip";
import { HighlightedMatch } from "@/components/HighlightedMatch";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import { coverageFor } from "~/hooks/useRequirementCoverage";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";
import { ItemTypes } from "~/types/dndTypes";
import { cn } from "~/utils";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { RequirementProvenanceBadge } from "./RequirementProvenanceBadge";
import {
  requirementCoverageSortValue,
  requirementSourceSortValue,
  type RequirementRow,
} from "./requirementsListRows";

/**
 * The five columns the tree-table renders through (D-03a). Deliberately NOT
 * ported from `MemberIssuesColumns.tsx`: no `select` (no bulk action on
 * requirements), no `description` (belongs to the detail panel's Tiptap
 * `Issue.note`), no separate `cases` column (the coverage badge's own
 * `passed/linkedCaseCount` already carries that number).
 */
export interface RequirementsListColumnsTranslations {
  /** requirements.list.columnName */
  columnName: string;
  /** requirements.list.columnStatus */
  columnStatus: string;
  /** requirements.coverage.title -- an existing key, reused, no new key */
  columnCoverage: string;
  /** requirements.list.columnSource */
  columnSource: string;
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
  expandedByIssueId: Record<number, boolean>;
  editingRequirementId: number | null;
  onToggleExpand: (issueId: number) => void;
  onSelectRequirement: (issueId: number) => void;
  onRenameCommit: (issueId: number, nextName: string) => void;
  onRenameCancel: () => void;
  onAddChild: (requirement: RequirementRow) => void;
  onRequestRename: (requirement: RequirementRow) => void;
  onRequestDelete: (requirement: RequirementRow) => void;
  onDetached: () => void;
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
  expandedByIssueId,
  editingRequirementId,
  onToggleExpand,
  onSelectRequirement,
  onRenameCommit,
  onRenameCancel,
  onAddChild,
  onRequestRename,
  onRequestDelete,
  onDetached,
}: UseRequirementsListColumnsArgs): ColumnDef<RequirementRow>[] {
  const {
    columnName: tColumnName,
    columnStatus: tColumnStatus,
    columnCoverage: tColumnCoverage,
    columnSource: tColumnSource,
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
            isEditing={editingRequirementId === row.original.id}
            onToggleExpand={onToggleExpand}
            onSelectRequirement={onSelectRequirement}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
          />
        ),
      },
      {
        id: "status",
        // Byte-identical to MemberIssuesColumns.tsx's own status cell.
        accessorFn: (row) => row.externalStatus ?? row.status ?? "",
        header: tColumnStatus,
        enableSorting: true,
        size: 120,
        minSize: 80,
        maxSize: 200,
        cell: ({ row }) => (
          <IssueStatusDisplay
            status={row.original.externalStatus ?? row.original.status ?? null}
            className="capitalize"
          />
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
        id: "source",
        accessorFn: (row) => requirementSourceSortValue(row),
        header: tColumnSource,
        enableSorting: true,
        size: 170,
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
          <RequirementRowActionsMenu
            requirement={row.original}
            onAddChild={onAddChild}
            onRequestRename={onRequestRename}
            onRequestDelete={onRequestDelete}
          />
        ),
      });
    }

    return columns;
  }, [
    tColumnName,
    tColumnStatus,
    tColumnCoverage,
    tColumnSource,
    tActionsLabel,
    projectId,
    canAddEdit,
    isFiltering,
    normalizedFilter,
    coverage,
    expandedByIssueId,
    editingRequirementId,
    onToggleExpand,
    onSelectRequirement,
    onRenameCommit,
    onRenameCancel,
    onAddChild,
    onRequestRename,
    onRequestDelete,
    onDetached,
  ]);
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
  isEditing: boolean;
  onToggleExpand: (issueId: number) => void;
  onSelectRequirement: (issueId: number) => void;
  onRenameCommit: (issueId: number, nextName: string) => void;
  onRenameCancel: () => void;
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
  isEditing,
  onToggleExpand,
  onSelectRequirement,
  onRenameCommit,
  onRenameCancel,
}: RequirementNameCellProps) {
  const t = useTranslations();
  const label = formatIssueDisplayText(requirement);

  const [{ isDragging }, dragRef] = useDrag<
    RequirementDragItem,
    void,
    { isDragging: boolean }
  >(
    () => ({
      type: ItemTypes.REQUIREMENT,
      item: { requirementId: requirement.id, name: label },
      canDrag: () => canAddEdit && !isFiltering,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [requirement.id, label, canAddEdit, isFiltering]
  );

  return (
    <div
      ref={(el) => {
        dragRef(el);
      }}
      className={cn(
        "flex min-w-0 items-center gap-1 cursor-pointer",
        isDragging && "opacity-50"
      )}
      style={{ paddingInlineStart: requirement.depth * 24 }}
      onClick={() => onSelectRequirement(requirement.id)}
      data-testid={`requirement-name-cell-${requirement.id}`}
      title={
        !canAddEdit || isFiltering
          ? t("requirements.tree.dragDisabled")
          : undefined
      }
    >
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
      {isEditing ? (
        <RequirementRenameInput
          defaultValue={requirement.name}
          onCommit={(value) => onRenameCommit(requirement.id, value)}
          onCancel={onRenameCancel}
          testId={`requirement-rename-input-${requirement.id}`}
        />
      ) : (
        <>
          <IssueTypeIcon
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
        </>
      )}
    </div>
  );
}

interface RequirementRenameInputProps {
  defaultValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  testId: string;
}

/**
 * Ported from the earlier react-arborist tree component's own
 * `RequirementRenameInput`, decoupled from react-arborist's `NodeApi`.
 */
function RequirementRenameInput({
  defaultValue,
  onCommit,
  onCancel,
  testId,
}: RequirementRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Input
      ref={inputRef}
      defaultValue={defaultValue}
      className="ms-1 h-6 flex-1 text-sm"
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onCancel()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          onCancel();
        } else if (e.key === "Enter") {
          const value = e.currentTarget.value.trim();
          if (value) {
            onCommit(value);
          } else {
            onCancel();
          }
        }
      }}
      data-testid={testId}
    />
  );
}

interface RequirementRowActionsMenuProps {
  requirement: RequirementRow;
  onAddChild: (requirement: RequirementRow) => void;
  onRequestRename: (requirement: RequirementRow) => void;
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
  onRequestRename,
  onRequestDelete,
}: RequirementRowActionsMenuProps) {
  const t = useTranslations();
  const locked = isRequirementLocked(requirement);

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
        {locked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  disabled
                  data-testid={`requirement-action-rename-${requirement.id}`}
                >
                  <div className="flex items-center gap-2">
                    <SquarePenIcon className="h-4 w-4" />
                    {t("requirements.tree.rename")}
                  </div>
                </DropdownMenuItem>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("requirements.edit.lockedTooltip")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuItem
            onClick={() => onRequestRename(requirement)}
            data-testid={`requirement-action-rename-${requirement.id}`}
          >
            <div className="flex items-center gap-2">
              <SquarePenIcon className="h-4 w-4" />
              {t("requirements.tree.rename")}
            </div>
          </DropdownMenuItem>
        )}
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
