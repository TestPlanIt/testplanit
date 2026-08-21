"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { HighlightedMatch } from "@/components/HighlightedMatch";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Issue } from "~/zenstack/models";
import { ChevronRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeApi, Tree, TreeApi } from "react-arborist";
import { toast } from "sonner";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { RequirementProvenanceBadge } from "./RequirementProvenanceBadge";
import type { RequirementSelection } from "./RequirementsWorkspace";

/**
 * This tree's own node shape, forked from `TreeView.tsx`'s `ArboristNode`
 * (`app/[locale]/projects/repository/[projectId]/TreeView.tsx:56-70`).
 * `folderId` -> `issueId`; `order`/`directCaseCount`/`totalCaseCount` are
 * dropped (`Issue` carries none of these columns). `childrenLoaded` is
 * dropped entirely -- this tree loads every requirement for the project in
 * one query, so there is no lazy-load state to track at all.
 */
interface RequirementArboristNode {
  id: string;
  name: string;
  children?: RequirementArboristNode[];
  data?: {
    issueId: number;
    parentId: number | null;
    hasChildren: boolean;
    originalData: Issue;
  };
}

/** Floor for the tree's scroll viewport, and the space kept below it. Mirrors
 *  TreeView.tsx's identical constants -- react-arborist virtualizes against
 *  the height it is handed, so that has to be the visible height, never the
 *  summed height of every row. */
const MIN_TREE_VIEWPORT = 320;
const TREE_VIEWPORT_GUTTER = 96;

interface RequirementsTreeViewProps extends RequirementSelection {
  projectId: string;
}

/**
 * The load-all react-arborist requirement tree (HIER-02's "see and organize"
 * half, PROV-01's lock visibility). Forked from `TreeView.tsx` per
 * 25-CONTEXT.md's mandate -- see that file's own header comment for the
 * folder-tree precedent this deliberately reuses.
 *
 * Scope discipline: render and select only. Drag-and-drop reparenting is
 * 25-09's job (both `disableDrag`/`disableDrop` stay hard-`true` here, with
 * no `onMove` at all). Create/rename/delete are 25-11's job (no row action
 * menu). Coverage display is entirely Phase 26 (no badge/pip/drill-down
 * beyond the provenance/lock badge this plan already owns).
 */
export default function RequirementsTreeView({
  projectId,
  selectedRequirementId,
  onSelectRequirement,
}: RequirementsTreeViewProps) {
  const t = useTranslations();
  const treeRef = useRef<TreeApi<RequirementArboristNode>>(null);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const [treeViewportHeight, setTreeViewportHeight] =
    useState(MIN_TREE_VIEWPORT);
  const [initialOpenState, setInitialOpenState] = useState<
    Record<string, boolean> | undefined
  >(undefined);
  const [filterQuery, setFilterQuery] = useState("");

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedFilter.length > 0;

  // Load every requirement for the project in a single query. react-arborist
  // owns virtualization for render performance, so there is no lazy-load
  // endpoint to protect and expand/collapse never issues a follow-up
  // request. Evidence (25-CONTEXT.md): Phase 22's operator UAT classified 11
  // requirements out of 11,005 real Jira issues in one project -- requirement
  // counts stay a tiny fraction of issue volume even at Jira scale.
  const {
    data: allRequirements,
    isLoading: requirementsLoading,
    error: requirementsError,
  } = useClientQueries(schema).issue.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
        // Spread, never inline -- issueRoleScope.ts's own doc comment warns
        // this is not an access-control boundary, and this repo's structural
        // containment gate reviews every raw predicate that skips it.
        ...REQUIREMENT_SCOPE_WHERE,
      },
      // `Issue` has no `order` column the way `RepositoryFolders` does --
      // `name` is the field this tree actually renders, so it is the
      // stable, human-meaningful sort. Revisit deliberately if a later
      // phase wants a different tree order.
      orderBy: { name: "asc" },
    },
    { optimisticUpdate: true }
  );

  const [requirements, setRequirements] = useState<Issue[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  useEffect(() => {
    if (allRequirements) {
      setRequirements(allRequirements);
      if (isInitialLoading) {
        setIsInitialLoading(false);
      }
    }
  }, [allRequirements, isInitialLoading]);

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

  const requirementMap = useMemo(() => {
    const map = new Map<number, Issue>();
    requirements.forEach((requirement) => map.set(requirement.id, requirement));
    return map;
  }, [requirements]);

  const hasChildrenMap = useMemo(() => {
    const map = new Map<number, boolean>();
    requirements.forEach((requirement) => map.set(requirement.id, false));
    requirements.forEach((requirement) => {
      if (requirement.parentId !== null) {
        map.set(requirement.parentId, true);
      }
    });
    return map;
  }, [requirements]);

  // Grouped from a name-sorted list, so every group is already in name
  // order too -- unlike TreeView.tsx's `childrenMap`, no per-group re-sort
  // is needed here since `Issue` has no per-sibling `order` column to sort
  // by in the first place.
  const childrenMap = useMemo(() => {
    const map = new Map<number | null, Issue[]>();
    requirements.forEach((requirement) => {
      const parentKey = requirement.parentId ?? null;
      if (!map.has(parentKey)) {
        map.set(parentKey, []);
      }
      map.get(parentKey)!.push(requirement);
    });
    return map;
  }, [requirements]);

  const requirementMeta = useMemo(() => {
    const meta = new Map<number, NonNullable<RequirementArboristNode["data"]>>();
    requirements.forEach((requirement) => {
      meta.set(requirement.id, {
        issueId: requirement.id,
        parentId: requirement.parentId,
        hasChildren: hasChildrenMap.get(requirement.id) ?? false,
        originalData: requirement,
      });
    });
    return meta;
  }, [requirements, hasChildrenMap]);

  // Requirements whose own name matches the filter box.
  const filterMatchIds = useMemo(() => {
    if (!normalizedFilter) return null;
    const matches = new Set<number>();
    requirements.forEach((requirement) => {
      if (requirement.name.toLowerCase().includes(normalizedFilter)) {
        matches.add(requirement.id);
      }
    });
    return matches;
  }, [requirements, normalizedFilter]);

  // A match is only reachable with its ancestors present, and only
  // browsable with its descendants present, so both join it in the visible
  // set -- mirrors TreeView.tsx's `filterVisibleFolderIds`.
  const visibleRequirementIds = useMemo(() => {
    if (!filterMatchIds) return null;
    const visible = new Set<number>(filterMatchIds);

    filterMatchIds.forEach((issueId) => {
      let current = requirementMap.get(issueId)?.parentId ?? null;
      while (current !== null && !visible.has(current)) {
        visible.add(current);
        current = requirementMap.get(current)?.parentId ?? null;
      }
    });

    const queue = [...filterMatchIds];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of childrenMap.get(parentId) ?? []) {
        if (!visible.has(child.id)) {
          visible.add(child.id);
          queue.push(child.id);
        }
      }
    }

    return visible;
  }, [filterMatchIds, requirementMap, childrenMap]);

  const buildTree = useCallback(
    (parentId: number | null): RequirementArboristNode[] => {
      const children = childrenMap.get(parentId ?? null) || [];
      return children
        .filter(
          (child) =>
            !visibleRequirementIds || visibleRequirementIds.has(child.id)
        )
        .map((child) => {
          const meta = requirementMeta.get(child.id);
          const hasChildren = meta?.hasChildren ?? false;
          return {
            id: child.id.toString(),
            name: child.name,
            // Always hand react-arborist an array, never `undefined`: it
            // reads `undefined` children as "leaf node, cannot accept a
            // drop." Since everything is loaded up front there is no
            // lazy-load gate to check first -- 25-09 turns drag back on, so
            // a childless requirement still needs `[]` here to remain a
            // valid drop target once that lands.
            children: hasChildren ? buildTree(child.id) : [],
            data: meta ?? {
              issueId: child.id,
              parentId: child.parentId,
              hasChildren,
              originalData: child,
            },
          };
        });
    },
    [childrenMap, requirementMeta, visibleRequirementIds]
  );

  const treeData: RequirementArboristNode[] = useMemo(() => {
    if (requirements.length === 0) return [];
    return buildTree(null);
  }, [buildTree, requirements]);

  const handleSelect = useCallback(
    (nodes: NodeApi<RequirementArboristNode>[]) => {
      if (nodes.length === 0) return;
      const issueId = nodes[0].data?.data?.issueId;
      if (issueId) {
        onSelectRequirement(issueId);
      }
    },
    [onSelectRequirement]
  );

  // Auto-expand the ancestors of the currently selected requirement once, so
  // a selection made elsewhere is reachable without the caller needing to
  // know the tree's open state.
  useEffect(() => {
    if (selectedRequirementId && requirements.length > 0 && !initialOpenState) {
      const openNodes: Record<string, boolean> = {};
      const addAncestors = (issueId: number) => {
        const parentId = requirementMap.get(issueId)?.parentId ?? null;
        if (parentId) {
          openNodes[parentId.toString()] = true;
          addAncestors(parentId);
        }
      };
      addAncestors(selectedRequirementId);
      if (Object.keys(openNodes).length > 0) {
        setInitialOpenState(openNodes);
      }
    }
  }, [selectedRequirementId, requirements, initialOpenState, requirementMap]);

  // Reveal filter matches by opening every ancestor on their paths --
  // mirrors TreeView.tsx's identical effect. Deliberately skips that file's
  // "restore the pre-filter open state on clear" refinement: a node opened
  // to reveal a match simply staying open once the filter clears is an
  // acceptable, simpler trade for a tree this phase expects to stay small.
  useEffect(() => {
    if (!filterMatchIds || filterMatchIds.size === 0) return;

    const ancestorsToOpen = new Set<number>();
    filterMatchIds.forEach((issueId) => {
      let current = requirementMap.get(issueId)?.parentId ?? null;
      while (current !== null && !ancestorsToOpen.has(current)) {
        ancestorsToOpen.add(current);
        current = requirementMap.get(current)?.parentId ?? null;
      }
    });
    if (ancestorsToOpen.size === 0) return;

    const timeout = setTimeout(() => {
      ancestorsToOpen.forEach((issueId) => {
        treeRef.current?.get(issueId.toString())?.open();
      });
    }, 0);

    return () => clearTimeout(timeout);
  }, [filterMatchIds, requirementMap]);

  // Size the tree to the space it actually occupies on screen -- handing it
  // the summed height of every row would make react-window render every row
  // and defeat virtualization. Mirrors TreeView.tsx's identical effect.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const element = treeViewportRef.current;
      if (!element) return;
      const { top } = element.getBoundingClientRect();
      const available = Math.min(
        window.innerHeight - TREE_VIEWPORT_GUTTER,
        window.innerHeight - top - TREE_VIEWPORT_GUTTER
      );
      setTreeViewportHeight(Math.max(MIN_TREE_VIEWPORT, Math.round(available)));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  // A memoized node renderer: chevron, name, provenance badge. Nothing else
  // -- no row action menu (25-11's job), no coverage badge/pip (Phase 26).
  const Node = useCallback(
    ({
      node,
      style,
    }: {
      node: NodeApi<RequirementArboristNode>;
      style: React.CSSProperties;
      dragHandle?: (el: HTMLDivElement | null) => void;
    }) => {
      const isSelected = node.isSelected;
      const data = node.data?.data;
      const hasChildren = !!data?.hasChildren;

      return (
        <div
          style={style}
          className={`group flex items-center gap-1 rounded-md ${
            isSelected
              ? "bg-secondary text-secondary-foreground"
              : "bg-transparent"
          } hover:bg-secondary/80 hover:text-secondary-foreground cursor-pointer ps-2 pe-2 py-1`}
          onClick={() => {
            node.select();
            if (hasChildren) {
              node.toggle();
            }
          }}
          data-testid={`requirement-node-${data?.issueId}`}
        >
          {hasChildren ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                node.toggle();
              }}
              aria-label={t("common.aria.togglePanel")}
              data-testid={`requirement-chevron-${data?.issueId}`}
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${
                  node.isOpen ? "rotate-90" : ""
                }`}
              />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span
            className="ms-1 min-w-0 flex-1 truncate text-sm"
            title={node.data.name}
          >
            <HighlightedMatch
              text={node.data.name}
              query={normalizedFilter}
              testId="requirement-filter-match"
            />
          </span>
          {data?.originalData && (
            <RequirementProvenanceBadge
              requirement={data.originalData}
              projectId={Number(projectId)}
              className="shrink-0"
            />
          )}
        </div>
      );
    },
    [normalizedFilter, projectId, t]
  );

  if (showSpinner || allRequirements === undefined) {
    return <LoadingSpinner />;
  }

  if (requirements.length === 0) {
    return (
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
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-2 ms-1 me-2 shrink-0">
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
      <div ref={treeViewportRef} className="relative flex-1">
        <Tree
          ref={treeRef}
          data={treeData}
          openByDefault={false}
          initialOpenState={initialOpenState}
          width="100%"
          height={treeViewportHeight}
          indent={24}
          rowHeight={32}
          overscanCount={8}
          rowClassName="min-w-0!"
          selection={selectedRequirementId?.toString()}
          onSelect={handleSelect}
          // Drag-and-drop reparenting is 25-09's job. Both stay hard-`true`
          // here (no `onMove` at all) rather than left half-wired, so there
          // is nothing yet for a user to start dragging.
          disableDrag
          disableDrop
        >
          {Node}
        </Tree>
        {isFiltering && treeData.length === 0 && (
          <div
            className="px-2 py-4 text-center text-xs text-muted-foreground"
            data-testid="requirements-filter-no-matches"
          >
            {t("common.ui.search.noResultsFound")}
          </div>
        )}
      </div>
    </div>
  );
}
