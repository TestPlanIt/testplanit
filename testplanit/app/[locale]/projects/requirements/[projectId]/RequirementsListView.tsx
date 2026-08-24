"use client";

import type { Row } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { ClipboardPlus, Search, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useDrop } from "react-dnd";
import { toast } from "sonner";
import { DataTable } from "@/components/tables/DataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  invalidateRequirementCoverage,
  useRequirementCoverage,
} from "~/hooks/useRequirementCoverage";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { ItemTypes } from "~/types/dndTypes";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";
import { CreateRequirementDialog } from "./CreateRequirementDialog";
import { DeleteRequirementModal } from "./DeleteRequirementModal";
import { useRequirementsListColumns } from "./RequirementsListColumns";
import type { RequirementSelection } from "./RequirementsWorkspace";
import {
  buildRequirementMaps,
  computeVisibleRequirementIds,
  countDescendants,
  flattenRequirementRows,
  type RequirementListSortConfig,
  type RequirementRow,
} from "./requirementsListRows";

/** The exact shape plan 03's per-row `useDrag` produces (the name cell in
 * `RequirementsListColumns.tsx`). Both drop targets below read
 * `item.requirementId`. */
interface RequirementDragItem {
  requirementId: number;
  name: string;
}

interface RequirementsListViewProps extends RequirementSelection {
  projectId: string;
}

/**
 * The tree-table rebuild of the requirements list (D-04a: a new file, not an
 * in-place rewrite of `RequirementsTreeView.tsx` -- see 26.2-PATTERNS.md and
 * 26.2-RESEARCH.md Open Question 3). Owns the requirement query, the
 * hierarchy/coverage/filter derivations (plan 02's pure module), the
 * toolbar, the four render states, and the `<DataTable virtualized>` call.
 * Every server contract (the query's `where`, the coverage query key, the
 * reparent route) is ported byte-identical from the file this replaces.
 */
export default function RequirementsListView({
  projectId,
  selectedRequirementId,
  onSelectRequirement,
}: RequirementsListViewProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const [filterQuery, setFilterQuery] = useState("");
  const [showOnlyUncovered, setShowOnlyUncovered] = useState(false);
  // Default {} -- every requirement starts collapsed, matching today's
  // initial tree state.
  const [expandedByIssueId, setExpandedByIssueId] = useState<
    Record<number, boolean>
  >({});
  const [editingRequirementId, setEditingRequirementId] = useState<
    number | null
  >(null);
  const [createDialogState, setCreateDialogState] = useState<{
    open: boolean;
    parentId: number | null;
    parentName: string | null;
  }>({ open: false, parentId: null, parentName: null });
  const [deleteDialogState, setDeleteDialogState] = useState<{
    open: boolean;
    requirementId: number | null;
    descendantCount: number;
  }>({ open: false, requirementId: null, descendantCount: 0 });
  const [sortConfig, setSortConfig] = useState<RequirementListSortConfig>({
    column: "name",
    direction: "asc",
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  // The currently drag-hovered row (D-04g's lifecycle). The ref mirrors the
  // state so the list-level drop callback below can read the latest value
  // synchronously; the state drives the outline-ring render. Only event
  // handlers ever call `setDragOverRow` -- never render.
  const [dragOverRequirementId, setDragOverRequirementId] = useState<
    number | null
  >(null);
  const dragOverRequirementIdRef = useRef<number | null>(null);
  const setDragOverRow = useCallback((id: number | null) => {
    dragOverRequirementIdRef.current = id;
    setDragOverRequirementId(id);
  }, []);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedFilter.length > 0;

  // Reparent/delete/detach are all gated server-side on project-admin, not a
  // per-area edit permission -- this mirrors that field, the same one
  // `RequirementProvenanceBadge.tsx` uses for its own detach gate.
  const { isProjectAdmin: canAddEdit } = useProjectPermissions(
    Number(projectId)
  );

  // Load-all query, byte-identical to the file this replaces. The spread
  // (never an inlined scope predicate) is load-bearing: this file inherits
  // the prior component's entry in issueRoleScope's own containment test
  // allowlist.
  const {
    data: allRequirements,
    isLoading: requirementsLoading,
    error: requirementsError,
    refetch: refetchRequirements,
  } = useClientQueries(schema).issue.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      orderBy: { name: "asc" },
    },
    { optimisticUpdate: true }
  );

  const { data: coverage, isError: coverageError } = useRequirementCoverage(
    Number(projectId)
  );
  const uncoveredToggleUnavailable = !coverage || coverageError;

  // One project-scoped invalidation per mutation (create/rename/reparent-
  // success/delete), never per row. Matches the predicate-based query-key
  // stability this hook was already built with -- see the hook's own doc
  // comment for why a prefix match would collide with the covering-cases
  // query.
  const invalidateCoverage = useCallback(() => {
    invalidateRequirementCoverage(queryClient, Number(projectId));
  }, [queryClient, projectId]);

  const updateRequirement = useClientQueries(schema).issue.useUpdate();

  const [requirements, setRequirements] = useState<Issue[]>([]);

  useEffect(() => {
    if (allRequirements) {
      setRequirements(allRequirements);
    }
  }, [allRequirements]);

  useEffect(() => {
    if (requirementsError) {
      toast.error(t("requirements.tree.loadFailed"));
    }
  }, [requirementsError, t]);

  // Delay showing the spinner to avoid a flash on fast loads.
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (requirementsLoading) {
      const timer = setTimeout(() => setShowSpinner(true), 200);
      return () => clearTimeout(timer);
    }
    setShowSpinner(false);
  }, [requirementsLoading]);

  const { requirementMap, childrenMap } = useMemo(
    () => buildRequirementMaps(requirements),
    [requirements]
  );

  const visibleRequirementIds = useMemo(
    () =>
      computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter,
        showOnlyUncovered,
        coverage,
        coverageError,
      }),
    [
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter,
      showOnlyUncovered,
      coverage,
      coverageError,
    ]
  );

  const rows = useMemo(
    () =>
      flattenRequirementRows({
        childrenMap,
        visibleRequirementIds,
        expandedByIssueId,
        sortConfig,
        coverage,
      }),
    [
      childrenMap,
      visibleRequirementIds,
      expandedByIssueId,
      sortConfig,
      coverage,
    ]
  );

  // Auto-expand ancestors of the selected requirement so a selection made
  // elsewhere is always reachable. Runs every time the selection changes
  // (not just once), and is a union-merge -- it only ever adds `true`
  // entries, so a user's own manual collapse is never undone by this
  // effect. Bails to the previous state object identity when nothing needs
  // adding, so this can never loop (T-26.2-12).
  useEffect(() => {
    if (selectedRequirementId == null) return;
    setExpandedByIssueId((prev) => {
      let next: Record<number, boolean> | null = null;
      let current = requirementMap.get(selectedRequirementId)?.parentId ?? null;
      while (current !== null) {
        if (prev[current] !== true) {
          next = next ?? { ...prev };
          next[current] = true;
        }
        current = requirementMap.get(current)?.parentId ?? null;
      }
      return next ?? prev;
    });
  }, [selectedRequirementId, requirementMap]);

  // While a filter (search text or the uncovered toggle) is active, force
  // open every currently-visible parent -- otherwise a filtered-in
  // descendant would never appear in the flattened array, since a row only
  // renders when its own parent's `expandedByIssueId` entry is true. Also a
  // union-merge, same loop-safety as the effect above; a no-op (identity
  // preserved) once nothing is filtering (`visibleRequirementIds` is null).
  useEffect(() => {
    if (!visibleRequirementIds) return;
    setExpandedByIssueId((prev) => {
      let next: Record<number, boolean> | null = null;
      visibleRequirementIds.forEach((issueId) => {
        if (prev[issueId] === true) return;
        const hasChildren = (childrenMap.get(issueId) ?? []).length > 0;
        if (!hasChildren) return;
        next = next ?? { ...prev };
        next[issueId] = true;
      });
      return next ?? prev;
    });
  }, [visibleRequirementIds, childrenMap]);

  // Written by every selection made from inside this list, before
  // delegating to the `onSelectRequirement` prop -- lets `scrollToRowId`
  // below distinguish "the user clicked a row in this list" (no re-center
  // needed, they're already looking at it) from "the selection arrived from
  // elsewhere" (deep link, another surface -- scroll it into view). State,
  // not a ref, so this read is render-safe.
  const [lastSelectedFromList, setLastSelectedFromList] = useState<
    number | null
  >(null);
  const handleSelectRequirement = useCallback(
    (issueId: number) => {
      setLastSelectedFromList(issueId);
      onSelectRequirement(issueId);
    },
    [onSelectRequirement]
  );
  const scrollToRequirementId =
    selectedRequirementId === lastSelectedFromList
      ? null
      : selectedRequirementId;

  const handleSortChange = useCallback((column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  // Explicit-direction sort from the header column menu; `null` (Remove
  // sort) restores this list's default order.
  const handleSortColumn = useCallback(
    (column: string, direction: "asc" | "desc" | null) => {
      if (direction === null) {
        setSortConfig({ column: "name", direction: "asc" });
      } else {
        setSortConfig({ column, direction });
      }
    },
    []
  );

  // In-place rename, re-checking `isRequirementLocked` here too (defense in
  // depth alongside the row menu's own gate and the schema's field-level
  // deny rule) and no-opping on a blank or unchanged name rather than
  // writing.
  const handleRenameCommit = useCallback(
    async (issueId: number, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) {
        setEditingRequirementId(null);
        return;
      }
      const requirement = requirementMap.get(issueId);
      if (!requirement || isRequirementLocked(requirement)) {
        setEditingRequirementId(null);
        return;
      }
      if (trimmed === requirement.name) {
        setEditingRequirementId(null);
        return;
      }
      try {
        await updateRequirement.mutateAsync({
          where: { id: issueId },
          data: { name: trimmed, title: trimmed },
        });
        toast.success(t("requirements.edit.success"));
        void refetchRequirements();
      } catch (error) {
        console.error("Failed to rename requirement:", error);
        toast.error(t("requirements.edit.failed"));
      }
      setEditingRequirementId(null);
    },
    [requirementMap, updateRequirement, t, refetchRequirements]
  );

  const handleRenameCancel = useCallback(() => {
    setEditingRequirementId(null);
  }, []);

  const handleRequestRename = useCallback((requirement: RequirementRow) => {
    setEditingRequirementId(requirement.id);
  }, []);

  const handleToggleExpand = useCallback((issueId: number) => {
    setExpandedByIssueId((prev) => ({ ...prev, [issueId]: !prev[issueId] }));
  }, []);

  const handleAddChild = useCallback((requirement: RequirementRow) => {
    setCreateDialogState({
      open: true,
      parentId: requirement.id,
      parentName: formatIssueDisplayText(requirement),
    });
  }, []);

  // Computed once, at click time -- never recomputed reactively inside the
  // modal, so the number the user confirms against cannot drift mid-dialog.
  const handleRequestDelete = useCallback(
    (requirement: RequirementRow) => {
      setDeleteDialogState({
        open: true,
        requirementId: requirement.id,
        descendantCount: countDescendants(childrenMap, requirement.id),
      });
    },
    [childrenMap]
  );

  const handleDetached = useCallback(() => {
    void refetchRequirements();
  }, [refetchRequirements]);

  // The reparent gesture's server contract (D-04c: no optimistic accept --
  // the fetch is awaited before any UI state changes, no local array
  // reorder is attempted, and no client-side cycle pre-check exists; the
  // server's own guard stays the sole authority).
  const handleMove = useCallback(
    async ({
      draggedId,
      parentId,
    }: {
      draggedId: number;
      parentId: number | null;
    }) => {
      if (!canAddEdit || isFiltering || !allRequirements) return;
      if (draggedId === parentId) return;
      try {
        const res = await fetch(
          `/api/projects/${projectId}/requirements/${draggedId}/reparent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentId }),
          }
        );
        if (!res.ok) {
          let serverMessage = "";
          try {
            const errorBody = await res.json();
            if (typeof errorBody?.error === "string") {
              serverMessage = errorBody.error;
            }
          } catch {
            // No JSON body to read -- fall back to the generic rejection
            // message alone.
          }
          toast.error(
            `${t("requirements.tree.moveRejected")} ${serverMessage}`.trim()
          );
          // Snap the array back to persisted truth. Coverage is
          // deliberately NOT invalidated on this branch -- a rejected move
          // never touched the rollup.
          void refetchRequirements();
          return;
        }
        toast.success(t("requirements.tree.moveSuccess"));
        void refetchRequirements();
        invalidateCoverage();
      } catch (error) {
        console.error("Failed to reparent requirement:", error);
        toast.error(t("requirements.tree.moveFailed"));
      }
    },
    [
      canAddEdit,
      isFiltering,
      allRequirements,
      projectId,
      t,
      refetchRequirements,
      invalidateCoverage,
    ]
  );

  // The single list-level drop target (D-04b). The wrapper this attaches to
  // is taller than the row set whenever the list is short, so the hovered
  // id is the only reliable signal for "which row is actually being
  // targeted" -- a null id means the pointer is over blank space below the
  // last row, and the drop must bail rather than reparent against a stale
  // target (D-04g).
  const [{ isOverList }, listDropRef] = useDrop<
    RequirementDragItem,
    void,
    { isOverList: boolean }
  >(
    () => ({
      accept: ItemTypes.REQUIREMENT,
      canDrop: () => canAddEdit && !isFiltering,
      drop: (item, monitor) => {
        if (monitor.didDrop()) return;
        const targetId = dragOverRequirementIdRef.current;
        setDragOverRow(null);
        if (targetId == null || targetId === item.requirementId) return;
        void handleMove({ draggedId: item.requirementId, parentId: targetId });
      },
      collect: (monitor) => ({
        isOverList: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [canAddEdit, isFiltering, handleMove]
  );

  // Clears the ring when the pointer leaves the table entirely -- one of
  // the three events that clear the hovered id (D-04g); the other two are
  // the row's own leave handler in `getRowProps` and the drop itself above.
  useEffect(() => {
    if (!isOverList) setDragOverRow(null);
  }, [isOverList, setDragOverRow]);

  // Bottom-of-list root drop zone -- moves a requirement out to the root
  // level. Rendered as a sibling below the scroll wrapper, never inside it,
  // so the two drop targets never nest and the wrapper's own blank strip
  // stays a dead zone.
  const [{ isOverBottom }, bottomDropRef] = useDrop<
    RequirementDragItem,
    void,
    { isOverBottom: boolean }
  >(
    () => ({
      accept: ItemTypes.REQUIREMENT,
      canDrop: () => canAddEdit && !isFiltering,
      drop: (item) => {
        void handleMove({ draggedId: item.requirementId, parentId: null });
      },
      collect: (monitor) => ({
        isOverBottom: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [canAddEdit, isFiltering, handleMove]
  );

  // Per-row extension point (plan 01's `getRowProps`): inert DOM props
  // only, no hook call and no ref slot -- publishes "I am hovered" /
  // "I am no longer hovered" through native drag events so the single
  // `useDrop` above can read the current target synchronously.
  const getRowProps = useCallback(
    (row: Row<any>) => {
      const requirement = row.original as RequirementRow;
      if (!canAddEdit || isFiltering) return {};
      return {
        onDragEnter: () => setDragOverRow(requirement.id),
        onDragLeave: (event: DragEvent<HTMLDivElement>) => {
          // Swallows the `dragleave` the browser fires when the pointer
          // crosses from the row into one of the row's own cells.
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          // HTML5 fires `dragenter` on the new row before `dragleave` on
          // the old one -- compare against the ref (never the render-time
          // state, which may be a frame stale) so a fast A->B move doesn't
          // clear B's freshly-set id.
          if (dragOverRequirementIdRef.current === requirement.id) {
            setDragOverRow(null);
          }
        },
        className:
          dragOverRequirementId === requirement.id
            ? "outline outline-2 outline-primary -outline-offset-2"
            : undefined,
      };
    },
    [canAddEdit, isFiltering, dragOverRequirementId, setDragOverRow]
  );

  const columns = useRequirementsListColumns({
    translations: {
      columnName: t("requirements.list.columnName"),
      columnStatus: t("requirements.list.columnStatus"),
      columnCoverage: t("requirements.coverage.title"),
      columnSource: t("requirements.list.columnSource"),
      actionsLabel: t("common.actions.actionsLabel"),
    },
    projectId: Number(projectId),
    canAddEdit,
    isFiltering,
    normalizedFilter,
    coverage,
    expandedByIssueId,
    editingRequirementId,
    onToggleExpand: handleToggleExpand,
    onSelectRequirement: handleSelectRequirement,
    onRenameCommit: handleRenameCommit,
    onRenameCancel: handleRenameCancel,
    onAddChild: handleAddChild,
    onRequestRename: handleRequestRename,
    onRequestDelete: handleRequestDelete,
    onDetached: handleDetached,
  });

  // Render states, in this exact order (D-04d fixes a real bug: the prior
  // spinner guard alone spun forever on a genuine fetch failure, because the
  // seeded array never resolves past its initial state once the fetch has
  // errored -- the error branch below must be checked first, independently).
  if (requirementsError && !requirementsLoading) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
        data-testid="requirements-list-error"
      >
        <p className="text-sm text-destructive">
          {t("requirements.tree.loadFailed")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetchRequirements()}
        >
          {t("search.errors.tryAgain")}
        </Button>
      </div>
    );
  }

  if (showSpinner || (allRequirements === undefined && !requirementsError)) {
    return <LoadingSpinner />;
  }

  // Empty (zero requirements) and the table are the two remaining states,
  // rendered from the same return so the create/delete dialogs below mount
  // exactly once regardless of which one is showing -- their own `open`
  // state gates visibility either way.
  const isEmpty = requirements.length === 0;

  return (
    <>
      {isEmpty ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center"
          data-testid="requirements-tree-empty"
        >
          <p className="text-sm font-medium">
            {t("requirements.tree.emptyTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("requirements.tree.emptyDescription")}
          </p>
          {canAddEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="requirements-tree-empty-add-root"
              onClick={() =>
                setCreateDialogState({
                  open: true,
                  parentId: null,
                  parentName: null,
                })
              }
            >
              <ClipboardPlus className="h-4 w-4" />
              {t("requirements.tree.addRoot")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="mb-2 ms-1 me-2 flex shrink-0 items-center gap-1">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setFilterQuery("");
                  }
                }}
                placeholder={t("requirements.tree.searchPlaceholder")}
                aria-label={t("requirements.tree.searchPlaceholder")}
                className="h-7 ps-7 pe-7 text-xs"
                data-testid="requirements-filter-input"
              />
              {isFiltering && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute end-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
                  aria-label={t("common.aria.clearFilter")}
                  data-testid="requirements-filter-clear"
                  onClick={() => setFilterQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <Button
              type="button"
              variant={showOnlyUncovered ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={showOnlyUncovered}
              disabled={uncoveredToggleUnavailable}
              aria-label={
                uncoveredToggleUnavailable
                  ? t("requirements.coverage.showOnlyUncoveredUnavailable")
                  : t("requirements.coverage.showOnlyUncovered")
              }
              title={
                uncoveredToggleUnavailable
                  ? t("requirements.coverage.showOnlyUncoveredUnavailable")
                  : t("requirements.coverage.showOnlyUncovered")
              }
              className="mt-0.5 h-7 w-7 shrink-0"
              data-testid="requirements-uncovered-toggle"
              onClick={() => setShowOnlyUncovered((prev) => !prev)}
            >
              <TriangleAlert className="h-3.5 w-3.5" />
            </Button>
            {canAddEdit && (
              <Button
                type="button"
                variant="secondary"
                className="mt-0.5 group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2 shrink-0"
                title={t("requirements.tree.addRoot")}
                aria-label={t("requirements.tree.addRoot")}
                data-testid="requirements-tree-add-root"
                onClick={() =>
                  setCreateDialogState({
                    open: true,
                    parentId: null,
                    parentName: null,
                  })
                }
              >
                <ClipboardPlus className="w-4 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                  {t("requirements.tree.addRoot")}
                </span>
              </Button>
            )}
          </div>
          <div
            ref={(el) => {
              listDropRef(el);
            }}
            className="min-h-0 flex-1"
          >
            <DataTable
              virtualized
              columns={columns as any}
              data={rows}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              sortConfig={sortConfig}
              isLoading={requirementsLoading}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              hasMore={false}
              getRowId={(row) => String(row.id)}
              estimateSize={48}
              columnSizingStorageKey="requirements-list-columns"
              flexColumnId="name"
              enableColumnReorder={false}
              pinFirstLast={false}
              highlightRowId={selectedRequirementId}
              scrollToRowId={scrollToRequirementId}
              getRowProps={getRowProps}
              emptyMessage={t("common.ui.search.noResultsFound")}
              resetKey={`${normalizedFilter}|${showOnlyUncovered}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="requirements-list"
              rowTestIdPrefix="requirement-row"
            />
          </div>
          {canAddEdit && !isFiltering && (
            <div
              ref={(el) => {
                bottomDropRef(el);
              }}
              className="h-16 w-full relative shrink-0"
              data-testid="requirement-tree-end"
            >
              {isOverBottom && (
                <div className="absolute top-0 start-0 end-6 flex items-center z-10 pointer-events-none">
                  <div
                    className="rounded-full"
                    style={{
                      width: 4,
                      height: 4,
                      boxShadow: "0 0 0 3px #4B91E2",
                    }}
                  />
                  <div
                    className="flex-1 rounded-sm"
                    style={{ height: 2, background: "#4B91E2" }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <CreateRequirementDialog
        projectId={projectId}
        parentId={createDialogState.parentId}
        parentName={createDialogState.parentName}
        open={createDialogState.open}
        onOpenChange={(nextOpen) =>
          setCreateDialogState((prev) => ({ ...prev, open: nextOpen }))
        }
        onCreated={(id) => {
          void refetchRequirements();
          onSelectRequirement(id);
          invalidateCoverage();
        }}
      />
      {deleteDialogState.requirementId != null && (
        <DeleteRequirementModal
          projectId={projectId}
          requirementId={deleteDialogState.requirementId}
          descendantCount={deleteDialogState.descendantCount}
          open={deleteDialogState.open}
          onOpenChange={(nextOpen) =>
            setDeleteDialogState((prev) => ({ ...prev, open: nextOpen }))
          }
          onDeleted={(deletedIds) => {
            void refetchRequirements();
            invalidateCoverage();
            if (
              selectedRequirementId != null &&
              deletedIds.includes(selectedRequirementId)
            ) {
              onSelectRequirement(null);
            }
          }}
        />
      )}
    </>
  );
}
