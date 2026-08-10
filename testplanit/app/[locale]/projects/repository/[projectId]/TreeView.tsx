import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { commitUrlSearch } from "~/lib/urlState";
import { HighlightedMatch } from "@/components/HighlightedMatch";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RepositoryFolders } from "~/zenstack/models";
import {
  ArrowRightLeft,
  ChevronRight,
  CopyPlus,
  Folder,
  FolderOpen,
  Loader2,
  MoreVertical,
  Search,
  SquarePenIcon,
  Trash2Icon,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeApi, Tree, TreeApi } from "react-arborist";
import { useDragLayer, useDrop } from "react-dnd";
import { toast } from "sonner";
import { useCopyMoveJob } from "~/components/copy-move/useCopyMoveJob";
import { isMacPlatform, useDragModifier } from "~/hooks/useDragModifier";
import { ItemTypes } from "~/types/dndTypes";
import { DeleteFolderModal } from "./DeleteFolderModal";
import { EditFolderModal } from "./EditFolder";

interface ArboristNode {
  id: string;
  name: string;
  children?: ArboristNode[];
  data?: {
    folderId: number;
    parentId: number | null;
    order: number;
    directCaseCount: number;
    totalCaseCount: number;
    hasChildren: boolean;
    childrenLoaded: boolean;
    originalData: RepositoryFolders;
  };
}

export interface FolderNode {
  id: number;
  parent: number | string;
  text: string;
  droppable: boolean;
  hasChildren: boolean;
  data?: any;
  directCaseCount: number;
  totalCaseCount: number;
}

/** Below this many folders the tree is short enough to scan, so the filter
 *  input stays hidden and the panel keeps a single control. */
export const FOLDER_FILTER_MIN_COUNT = 15;

/** Floor for the tree's scroll viewport, and the space kept below it for the
 *  root drop zone. react-arborist virtualizes against the height it is handed,
 *  so it has to be the visible height and never the height of all rows. */
const MIN_TREE_VIEWPORT = 320;
const TREE_VIEWPORT_GUTTER = 96;

/** Far longer than the app-wide tooltip delay: the chevron is a click target
 *  first, and working down through subfolders must not summon a hint over the
 *  next row. Only someone who stops on the chevron gets it. */
const CHEVRON_HINT_DELAY_MS = 2500;

/**
 * Expand/collapse control for a folder row.
 *
 * Alt-clicking it reaches the whole subtree instead of the one folder, which is
 * invisible until someone happens to try it, so the hover hint names both the
 * plain click and the modifier — the disclosure the case list's select-all
 * checkbox gives its Shift behaviour.
 *
 * On a root folder the modifier reaches every folder in the tree rather than
 * just this row's descendants, so the wording follows that split.
 */
export const FolderChevron = React.memo(function FolderChevron({
  folderId,
  isOpen,
  isRootFolder,
  hasChildren,
  onClick,
}: {
  folderId?: number;
  isOpen: boolean;
  isRootFolder: boolean;
  hasChildren: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const t = useTranslations("repository.treeView");
  const [isHovering, setIsHovering] = useState(false);
  const [altHeld, setAltHeld] = useState(false);

  // Subscribed only while the pointer is on this chevron, so one row listens at
  // a time rather than every row the tree has rendered.
  useEffect(() => {
    if (!isHovering) {
      setAltHeld(false);
      return;
    }

    const sync = (event: KeyboardEvent) => setAltHeld(event.altKey);
    const clear = () => setAltHeld(false);

    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    // Alt-Tabbing away releases the key without a keyup reaching the page.
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, [isHovering]);

  const chevron = (
    <Button
      variant="ghost"
      size="sm"
      className={`p-0 h-6 w-6 ${hasChildren ? "" : "invisible"}`}
      aria-label={
        hasChildren
          ? isOpen
            ? t("collapseFolder")
            : t("expandFolder")
          : undefined
      }
      data-testid={
        folderId === undefined ? undefined : `folder-chevron-${folderId}`
      }
      // The pointer arriving with the key already down never fires a keydown.
      onMouseEnter={(event) => {
        setAltHeld(event.altKey);
        setIsHovering(true);
      }}
      onMouseLeave={() => setIsHovering(false)}
      onClick={onClick}
    >
      <ChevronRight
        className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
      />
    </Button>
  );

  // A childless folder keeps the chevron only as spacing, so there is nothing
  // to describe.
  if (!hasChildren) {
    return chevron;
  }

  const action = altHeld
    ? isRootFolder
      ? isOpen
        ? t("collapseAll")
        : t("expandAll")
      : isOpen
        ? t("collapseSubfolders")
        : t("expandSubfolders")
    : isOpen
      ? t("collapseFolder")
      : t("expandFolder");

  const isMac = isMacPlatform();
  const hint = isRootFolder
    ? isMac
      ? t("altHintAllMac")
      : t("altHintAllWin")
    : isMac
      ? t("altHintMac")
      : t("altHintWin");

  return (
    <TooltipProvider
      delayDuration={CHEVRON_HINT_DELAY_MS}
      // Radix otherwise reopens with no delay at all for a while after the
      // first hint, which is exactly the click-through case.
      skipDelayDuration={0}
      disableHoverableContent
    >
      <Tooltip>
        <TooltipTrigger asChild>{chevron}</TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={8}
          className="max-w-xs"
          style={{ zIndex: 9999 }}
        >
          <p className="text-xs">{action}</p>
          {!altHeld && (
            <p className="text-xs text-primary-foreground/65 mt-1">{hint}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

const TreeView: React.FC<{
  onSelectFolder: (folderId: number | null) => void;
  onHierarchyChange: (hierarchy: FolderNode[]) => void;
  selectedFolderId: number | null;
  filteredFolders?: number[];
  canAddEdit: boolean;
  runId?: number;
  folderStatsData?: Array<{
    folderId: number;
    directCaseCount: number;
    totalCaseCount: number;
  }>;
  onRefetchFolders?: (refetch: () => Promise<unknown>) => void;
  onRefetchStats?: () => void;
  /** Ref to an element to scope DnD events to (prevents "Cannot have two HTML5 backends" error in portals) */
  dndRootElement?: HTMLElement | null;
  onCopyMoveFolder?: (folderId: number, folderName: string) => void;
}> = ({
  onSelectFolder,
  onHierarchyChange,
  selectedFolderId,
  filteredFolders,
  canAddEdit,
  runId: _runId,
  folderStatsData,
  onRefetchFolders,
  onRefetchStats,
  dndRootElement,
  onCopyMoveFolder,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const t = useTranslations();
  const treeRef = useRef<TreeApi<ArboristNode>>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevSelectedFolderIdRef = useRef<number | null>(null);
  const [, setHierarchyData] = useState<FolderNode[]>([]);
  const [initialOpenState, setInitialOpenState] = useState<
    Record<string, boolean> | undefined
  >(undefined);
  const [editModalState, setEditModalState] = useState<{
    open: boolean;
    folderId: number | null;
  }>({ open: false, folderId: null });
  const [deleteModalState, setDeleteModalState] = useState<{
    open: boolean;
    node: FolderNode | null;
  }>({ open: false, node: null });

  // State to store all folders
  const [folders, setFolders] = useState<RepositoryFolders[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const [filterQuery, setFilterQuery] = useState("");
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const isFiltering = normalizedFilter.length > 0;
  const showFilterInput = folders.length > FOLDER_FILTER_MIN_COUNT;
  // Which folders were open before the current filter session started, so
  // clearing the filter leaves the tree how the user had it.
  const preFilterOpenIdsRef = useRef<Set<string> | null>(null);

  // Called from the input's change handler rather than an effect: at that point
  // the tree still holds the unfiltered nodes, so their open state is readable.
  const captureOpenStateBeforeFiltering = () => {
    if (isFiltering || preFilterOpenIdsRef.current !== null) return;
    const openIds = new Set<string>();
    treeRef.current?.visibleNodes.forEach((node) => {
      if (node.isOpen) openIds.add(node.id);
    });
    preFilterOpenIdsRef.current = openIds;
  };

  // Build a map of which folders have children (computed from main folders data)
  // This ensures hasChildren is always in sync with the folder list
  const hasChildrenMap = useMemo(() => {
    const map = new Map<number, boolean>();
    if (folders) {
      // Initialize all folders as having no children
      folders.forEach((f) => map.set(f.id, false));
      // Mark folders that have children
      folders.forEach((f) => {
        if (f.parentId !== null) {
          map.set(f.parentId, true);
        }
      });
    }
    return map;
  }, [folders]);

  // Load ALL folders at once (full data)
  // This is more efficient than lazy loading because:
  // 1. Folder metadata is small (no test cases)
  // 2. Avoids ZenStack access control issues on lazy load endpoint
  // 3. Enables instant expand/collapse without network requests
  const {
    data: allFolders,
    isLoading: foldersLoading,
    error: _error,
    refetch: refetchFolders,
  } = useClientQueries(schema).repositoryFolders.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      orderBy: { order: "asc" },
    },
    {
      optimisticUpdate: true,
    }
  );

  // Initialize folders with all folders and update on refetch
  useEffect(() => {
    if (allFolders) {
      setFolders(allFolders);
      if (isInitialLoading) {
        setIsInitialLoading(false);
      }
    }
  }, [allFolders, isInitialLoading]);

  // Expose refetch function to parent
  useEffect(() => {
    if (onRefetchFolders) {
      onRefetchFolders(refetchFolders);
    }
  }, [onRefetchFolders, refetchFolders]);

  // folderStatsData is now passed as a prop from parent component
  // No-op function for refetchCases since stats are managed by parent
  const refetchCases = useCallback(() => {
    // Stats are refetched by parent component
  }, []);

  const [loadedFolderIds, setLoadedFolderIds] = useState<Set<number>>(
    () => new Set()
  );
  const [showSpinner, setShowSpinner] = useState(false);
  const treeViewportRef = useRef<HTMLDivElement>(null);
  const [treeViewportHeight, setTreeViewportHeight] =
    useState(MIN_TREE_VIEWPORT);
  const [isExpandingAll, setIsExpandingAll] = useState(false);
  const [pendingExpandIds, setPendingExpandIds] = useState<number[] | null>(
    null
  );

  // Delay showing spinner to prevent flashing on fast loads
  const isLoading = foldersLoading;
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        setShowSpinner(true);
      }, 200); // Show spinner after 200ms delay
      return () => clearTimeout(timer);
    } else {
      setShowSpinner(false);
    }
  }, [isLoading]);

  const folderMap = useMemo(() => {
    const map = new Map<number, RepositoryFolders>();
    if (folders) {
      folders.forEach((folder) => {
        map.set(folder.id, folder);
      });
    }
    return map;
  }, [folders]);

  const childrenMap = useMemo(() => {
    const map = new Map<number | null, RepositoryFolders[]>();
    if (folders) {
      folders.forEach((folder) => {
        const parentKey = folder.parentId ?? null;
        if (!map.has(parentKey)) {
          map.set(parentKey, []);
        }
        map.get(parentKey)!.push(folder);
      });
      map.forEach((list) => {
        list.sort((a, b) => a.order - b.order);
      });
    }
    return map;
  }, [folders]);

  // Convert folder stats array to maps for efficient lookup
  const folderStats = useMemo(() => {
    const directCounts = new Map<number, number>();
    const totalCounts = new Map<number, number>();

    if (folderStatsData) {
      folderStatsData.forEach((stat) => {
        directCounts.set(stat.folderId, stat.directCaseCount);
        totalCounts.set(stat.folderId, stat.totalCaseCount);
      });
    }

    return { directCounts, totalCounts };
  }, [folderStatsData]);

  const folderMeta = useMemo(() => {
    const meta = new Map<
      number,
      Omit<NonNullable<ArboristNode["data"]>, "childrenLoaded">
    >();
    if (folders) {
      folders.forEach((folder) => {
        // Use hasChildrenMap to determine if folder has children (even if not loaded yet)
        const hasChildren = hasChildrenMap.get(folder.id) ?? false;
        meta.set(folder.id, {
          folderId: folder.id,
          parentId: folder.parentId,
          order: folder.order,
          directCaseCount: folderStats.directCounts.get(folder.id) || 0,
          totalCaseCount: folderStats.totalCounts.get(folder.id) || 0,
          hasChildren,
          originalData: folder,
        });
      });
    }
    return meta;
  }, [folders, hasChildrenMap, folderStats]);

  const addLoadedFolderIds = useCallback((ids: Iterable<number>) => {
    setLoadedFolderIds((prev) => {
      let next: Set<number> | null = null;
      for (const id of ids) {
        if (!prev.has(id)) {
          if (!next) {
            next = new Set(prev);
          }
          next.add(id);
        }
      }
      return next ?? prev;
    });
  }, []);

  // Since all folders are loaded at once, we just need to mark them as loaded for expand/collapse tracking
  const ensureFolderChildrenLoaded = useCallback(
    async (folderId: number | null | undefined) => {
      if (folderId === null || folderId === undefined) return;
      // All folders are already loaded, just mark this parent as expanded
      addLoadedFolderIds([folderId]);
    },
    [addLoadedFolderIds]
  );

  const ensureFolderPathLoaded = useCallback(
    async (folderId: number | null | undefined) => {
      if (folderId === null || folderId === undefined) return;
      const toLoad: number[] = [];
      let currentParent = folderMap.get(folderId)?.parentId ?? null;
      while (currentParent) {
        toLoad.push(currentParent);
        currentParent = folderMap.get(currentParent)?.parentId ?? null;
      }
      if (toLoad.length === 0) return;

      // All folders are already loaded, just mark ancestors as expanded
      addLoadedFolderIds(toLoad);
    },
    [folderMap, addLoadedFolderIds]
  );

  const runVisibleFolderIds = useMemo(() => {
    if (!filteredFolders || filteredFolders.length === 0) {
      return null;
    }

    const visible = new Set<number>();
    const addWithAncestors = (folderId: number) => {
      let current: number | null | undefined = folderId;
      while (current) {
        if (visible.has(current)) break;
        visible.add(current);
        current = folderMap.get(current)?.parentId ?? null;
      }
    };

    filteredFolders.forEach((folderId) => addWithAncestors(folderId));
    return visible;
  }, [filteredFolders, folderMap]);

  // Folders whose own name matches the filter box.
  const filterMatchIds = useMemo(() => {
    if (!normalizedFilter) return null;
    const matches = new Set<number>();
    folders.forEach((folder) => {
      if (folder.name.toLowerCase().includes(normalizedFilter)) {
        matches.add(folder.id);
      }
    });
    return matches;
  }, [folders, normalizedFilter]);

  // A match is only reachable with its ancestors present, and only browsable
  // with its descendants present, so both join the matches in the visible set.
  const filterVisibleFolderIds = useMemo(() => {
    if (!filterMatchIds) return null;

    const visible = new Set<number>(filterMatchIds);

    filterMatchIds.forEach((folderId) => {
      let current = folderMap.get(folderId)?.parentId ?? null;
      while (current !== null && !visible.has(current)) {
        visible.add(current);
        current = folderMap.get(current)?.parentId ?? null;
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
  }, [filterMatchIds, folderMap, childrenMap]);

  const visibleFolderIds = useMemo(() => {
    if (!runVisibleFolderIds) return filterVisibleFolderIds;
    if (!filterVisibleFolderIds) return runVisibleFolderIds;
    const combined = new Set<number>();
    filterVisibleFolderIds.forEach((folderId) => {
      if (runVisibleFolderIds.has(folderId)) combined.add(folderId);
    });
    return combined;
  }, [runVisibleFolderIds, filterVisibleFolderIds]);

  const selectedAncestorIds = useMemo(() => {
    const ancestors = new Set<number>();
    if (!selectedFolderId) {
      return ancestors;
    }

    let currentParent = folderMap.get(selectedFolderId)?.parentId ?? null;
    while (currentParent) {
      if (ancestors.has(currentParent)) break;
      ancestors.add(currentParent);
      currentParent = folderMap.get(currentParent)?.parentId ?? null;
    }

    return ancestors;
  }, [selectedFolderId, folderMap]);

  const autoLoadedFolderIds = useMemo(() => {
    const autoLoaded = new Set<number>();
    selectedAncestorIds.forEach((id) => autoLoaded.add(id));

    if (visibleFolderIds) {
      visibleFolderIds.forEach((id) => {
        const parentId = folderMap.get(id)?.parentId ?? null;
        if (parentId !== null && parentId !== undefined) {
          autoLoaded.add(parentId);
        }
      });
    }

    return autoLoaded;
  }, [selectedAncestorIds, visibleFolderIds, folderMap]);

  const combinedLoadedFolderIds = useMemo(() => {
    const combined = new Set<number>(loadedFolderIds);
    autoLoadedFolderIds.forEach((id) => combined.add(id));
    return combined;
  }, [loadedFolderIds, autoLoadedFolderIds]);

  const { mutateAsync: updateFolder } =
    useClientQueries(schema).repositoryFolders.useUpdate();
  const { mutateAsync: updateCase } =
    useClientQueries(schema).repositoryCases.useUpdate();

  const copyMoveJob = useCopyMoveJob();
  const [pendingCopyTargets, setPendingCopyTargets] = useState<
    Map<number, string>
  >(new Map());
  // Track the in-flight copy submission (folder + case count) so the completion
  // and failure effects can clear the right per-folder spinner and toast the
  // correct count. useCopyMoveJob is single-job, so a second submit while one
  // is in flight would orphan the first job's spinner; handleCopyDrop rejects
  // overlapping submits explicitly.
  const lastSubmittedRef = useRef<{
    folderId: number;
    folderName: string;
    caseCount: number;
  } | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    x: number;
    y: number;
    targetFolderId: number;
    targetFolderName: string;
    draggedItems: Array<{ id: number | string }>;
  } | null>(null);

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);

  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const virtualAnchor = useMemo(
    () =>
      pendingDrop
        ? {
            getBoundingClientRect: () =>
              ({
                x: pendingDrop.x,
                y: pendingDrop.y,
                left: pendingDrop.x,
                top: pendingDrop.y,
                right: pendingDrop.x,
                bottom: pendingDrop.y,
                width: 0,
                height: 0,
                toJSON: () => null,
              }) as DOMRect,
          }
        : null,
    [pendingDrop]
  );

  const handleMoveDrop = useCallback(
    async (
      itemsToUpdate: Array<{ id: number | string }>,
      targetFolderId: number
    ) => {
      try {
        const updatePromises = itemsToUpdate.map((draggedItem) =>
          updateCase({
            where: { id: Number(draggedItem.id) },
            data: { folderId: targetFolderId },
          })
        );
        await Promise.all(updatePromises);

        toast.success(t("common.fields.success"), {
          description: t("common.messages.updateSuccessCount", {
            count: itemsToUpdate.length,
          }),
        });
        void refetchCases();
        void refetchFolders();
        onRefetchStats?.();
      } catch (error) {
        console.error("Failed to move test case(s):", error);
        toast.error(t("common.errors.error"), {
          description: t("common.messages.updateError"),
        });
      }
    },
    [updateCase, refetchCases, refetchFolders, onRefetchStats, t]
  );

  const handleCopyDrop = useCallback(
    async (
      itemsToUpdate: Array<{ id: number | string }>,
      targetFolderId: number,
      targetFolderName: string
    ) => {
      // useCopyMoveJob can only track one job at a time. If a copy is already
      // in flight, surfacing a second submit() call would orphan the first
      // job's spinner and lose its result toast.
      if (copyMoveJob.status !== "idle") {
        toast.error(t("repository.dragDrop.copyAlreadyRunning"));
        return;
      }
      lastSubmittedRef.current = {
        folderId: targetFolderId,
        folderName: targetFolderName,
        caseCount: itemsToUpdate.length,
      };
      setPendingCopyTargets((prev) => {
        const next = new Map(prev);
        next.set(targetFolderId, "pending");
        return next;
      });
      await copyMoveJob.submit({
        operation: "copy",
        caseIds: itemsToUpdate.map((i) => Number(i.id)),
        sourceProjectId: numericProjectId,
        targetProjectId: numericProjectId,
        targetFolderId,
        conflictResolution: "rename",
        sharedStepGroupResolution: "reuse",
      });
    },
    [copyMoveJob, numericProjectId, t]
  );

  useEffect(() => {
    if (copyMoveJob.status === "completed") {
      const submitted = lastSubmittedRef.current;
      setPendingCopyTargets((prev) => {
        if (submitted == null) return prev;
        const next = new Map(prev);
        next.delete(submitted.folderId);
        return next;
      });
      toast.success(
        t("repository.dragDrop.copyComplete", {
          count: copyMoveJob.result?.copiedCount ?? 0,
          folder: submitted?.folderName ?? "",
          dest: "samename",
          projectName: "",
        })
      );
      lastSubmittedRef.current = null;
      void refetchCases();
      void refetchFolders();
      onRefetchStats?.();
      copyMoveJob.reset();
    } else if (copyMoveJob.status === "failed") {
      const submitted = lastSubmittedRef.current;
      setPendingCopyTargets((prev) => {
        if (submitted == null) return prev;
        const next = new Map(prev);
        next.delete(submitted.folderId);
        return next;
      });
      if (submitted != null) {
        toast.error(
          t("repository.dragDrop.copyError", {
            count: submitted.caseCount,
            folder: submitted.folderName,
            dest: "samename",
            projectName: "",
          })
        );
      }
      lastSubmittedRef.current = null;
      copyMoveJob.reset();
    }
  }, [
    copyMoveJob.status,
    copyMoveJob.result,
    copyMoveJob.reset,
    refetchCases,
    refetchFolders,
    onRefetchStats,
    t,
  ]);

  const buildTree = useCallback(
    (parentId: number | null): ArboristNode[] => {
      const children = childrenMap.get(parentId ?? null) || [];
      return children
        .filter((child) => !visibleFolderIds || visibleFolderIds.has(child.id))
        .map((child) => {
          const meta = folderMeta.get(child.id);
          const hasChildren = meta?.hasChildren ?? false;
          const childrenLoaded = hasChildren
            ? combinedLoadedFolderIds.has(child.id)
            : false;

          return {
            id: child.id.toString(),
            name: child.name,
            // Always use an array for children (not undefined) so folders are treated as
            // internal nodes that can accept drops. undefined = leaf node = no drops allowed.
            children: hasChildren && childrenLoaded ? buildTree(child.id) : [],
            data: meta
              ? {
                  ...meta,
                  childrenLoaded,
                }
              : {
                  folderId: child.id,
                  parentId: child.parentId,
                  order: child.order,
                  directCaseCount: 0,
                  totalCaseCount: 0,
                  hasChildren,
                  childrenLoaded,
                  originalData: child,
                },
          };
        });
    },
    [childrenMap, combinedLoadedFolderIds, folderMeta, visibleFolderIds]
  );

  const treeData: ArboristNode[] = useMemo(() => {
    if (!folders || folders.length === 0) {
      return [];
    }
    return buildTree(null);
  }, [buildTree, folders]);

  // Handle folder selection
  const handleSelect = useCallback(
    (nodes: NodeApi<ArboristNode>[]) => {
      if (nodes.length > 0) {
        const node = nodes[0];
        const folderId = node.data?.data?.folderId;
        if (folderId) {
          setSelectedId(node.id);
          onSelectFolder(folderId);

          const url = new URL(window.location.href);
          url.searchParams.set("node", folderId.toString());
          commitUrlSearch(url);
        }
      }
    },
    [onSelectFolder]
  );

  // Handle drag and drop
  const handleMove = useCallback(
    async ({
      dragIds,
      parentId,
      index,
    }: {
      dragIds: string[];
      parentId: string | null;
      index: number;
    }) => {
      if (!canAddEdit || filteredFolders || !folders) return;

      const draggedId = parseInt(dragIds[0]);
      const newParentId = parentId ? parseInt(parentId) : null;

      // Find the dragged folder
      const draggedFolder = folders.find((f) => f.id === draggedId);
      if (!draggedFolder) return;

      try {
        // Get all folders at the target level
        const siblingsAtTarget = folders
          .filter((f) => f.parentId === newParentId && f.id !== draggedId)
          .sort((a, b) => a.order - b.order);

        // Insert the dragged folder at the new position
        const updatedFolders: Array<{ id: number; order: number }> = [];

        // Update the dragged folder
        updatedFolders.push({
          id: draggedId,
          order: index,
        });

        // Update the order of other folders at the same level
        let currentOrder = 0;
        siblingsAtTarget.forEach((sibling) => {
          if (currentOrder === index) {
            currentOrder++; // Skip the index where we inserted the dragged folder
          }
          if (sibling.order !== currentOrder) {
            updatedFolders.push({
              id: sibling.id,
              order: currentOrder,
            });
          }
          currentOrder++;
        });

        // Update the dragged folder with new parent and order
        await updateFolder({
          where: { id: draggedId },
          data: {
            parentId: newParentId,
            order: index,
          },
        });

        // Update other folders that need reordering
        await Promise.all(
          updatedFolders
            .filter((f) => f.id !== draggedId)
            .map((folder) =>
              updateFolder({
                where: { id: folder.id },
                data: { order: folder.order },
              })
            )
        );
        if (newParentId !== null && newParentId !== undefined) {
          void ensureFolderChildrenLoaded(newParentId);
        }
      } catch (error) {
        console.error("Failed to update folder:", error);
      }
    },
    [
      canAddEdit,
      filteredFolders,
      folders,
      updateFolder,
      ensureFolderChildrenLoaded,
    ]
  );

  // Calculate which nodes should be open initially to show the selected folder
  useEffect(() => {
    if (selectedFolderId && folders && !initialOpenState) {
      const openNodes: Record<string, boolean> = {};

      const addAncestor = (folderId: number) => {
        const parentId = folderMap.get(folderId)?.parentId ?? null;
        if (parentId) {
          openNodes[parentId.toString()] = true;
          addAncestor(parentId);
        }
      };

      addAncestor(selectedFolderId);
      void ensureFolderPathLoaded(selectedFolderId);

      if (Object.keys(openNodes).length > 0) {
        setInitialOpenState(openNodes);
      }
    }
  }, [
    selectedFolderId,
    folders,
    initialOpenState,
    folderMap,
    ensureFolderPathLoaded,
  ]);

  // Set initial selection after tree is rendered
  // Only run when selectedFolderId actually changes from the parent, not on treeData changes
  useEffect(() => {
    if (
      selectedFolderId &&
      treeRef.current &&
      treeData.length > 0 &&
      prevSelectedFolderIdRef.current !== selectedFolderId
    ) {
      prevSelectedFolderIdRef.current = selectedFolderId;
      void ensureFolderPathLoaded(selectedFolderId);
      // Small delay to ensure tree is fully rendered
      setTimeout(() => {
        const nodeId = selectedFolderId.toString();
        const node = treeRef.current?.get(nodeId);
        if (node) {
          node.select();
          setSelectedId(nodeId);

          // Also ensure parent nodes are open
          let parent = node.parent;
          while (parent && !parent.isRoot) {
            const parentFolderId = Number(parent.id);
            if (!Number.isNaN(parentFolderId)) {
              void ensureFolderChildrenLoaded(parentFolderId);
            }
            parent.open();
            parent = parent.parent;
          }
        }
      }, 100);
    }
  }, [
    selectedFolderId,
    treeData,
    ensureFolderPathLoaded,
    ensureFolderChildrenLoaded,
  ]);

  // Listen for custom folder selection events
  useEffect(() => {
    // Track every retry timeout so cleanup on unmount cancels them all and
    // prevents setSelectedId / onSelectFolder calls on an unmounted tree.
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const handleFolderSelectionChanged = (event: CustomEvent) => {
      const folderId = event.detail?.folderId;
      const expandParentId = event.detail?.expandParentId;
      if (folderId && treeRef.current) {
        const nodeId = folderId.toString();
        void ensureFolderPathLoaded(folderId);

        // If we need to expand a parent (creating a child folder), first load its children
        // This triggers a state update, so we need to wait for re-render before accessing the child
        if (expandParentId) {
          void ensureFolderChildrenLoaded(expandParentId);
        }

        // Helper function to select node with retry logic for newly created nodes
        const selectNodeWithRetry = (retriesLeft: number) => {
          // If a parent folder should be expanded, ensure its children are loaded and expand it
          // We call ensureFolderChildrenLoaded on each retry to ensure the state update
          // triggers a re-render that includes the children in the tree
          if (expandParentId) {
            void ensureFolderChildrenLoaded(expandParentId);
            const parentNode = treeRef.current?.get(expandParentId.toString());
            if (parentNode) {
              parentNode.open();
            }
          }

          const node = treeRef.current?.get(nodeId);
          if (node) {
            node.select();
            setSelectedId(nodeId);

            let parent = node.parent;
            while (parent && !parent.isRoot) {
              const parentFolderId = Number(parent.id);
              if (!Number.isNaN(parentFolderId)) {
                void ensureFolderChildrenLoaded(parentFolderId);
              }
              parent.open();
              parent = parent.parent;
            }

            onSelectFolder(folderId);

            // Update URL with the new folder ID
            const url = new URL(window.location.href);
            url.searchParams.set("node", folderId.toString());
            commitUrlSearch(url);
          } else if (retriesLeft > 0) {
            // Node not found yet (may still be rendering after state update), retry after a delay
            // Use longer delay to allow React to complete its render cycle
            timeouts.push(
              setTimeout(() => selectNodeWithRetry(retriesLeft - 1), 100)
            );
          }
        };

        // Start the retry loop after a short initial delay to allow state updates to propagate
        timeouts.push(setTimeout(() => selectNodeWithRetry(15), 100));
      }
    };

    window.addEventListener(
      "folderSelectionChanged",
      handleFolderSelectionChanged as EventListener
    );

    return () => {
      window.removeEventListener(
        "folderSelectionChanged",
        handleFolderSelectionChanged as EventListener
      );
      timeouts.forEach(clearTimeout);
      timeouts.length = 0;
    };
  }, [onSelectFolder, ensureFolderPathLoaded, ensureFolderChildrenLoaded]);

  useEffect(() => {
    if (!filteredFolders || filteredFolders.length === 0) {
      return;
    }

    const ancestorsToLoad = new Set<number>();
    filteredFolders.forEach((folderId) => {
      let currentParent = folderMap.get(folderId)?.parentId ?? null;
      while (currentParent) {
        ancestorsToLoad.add(currentParent);
        currentParent = folderMap.get(currentParent)?.parentId ?? null;
      }
    });
    if (ancestorsToLoad.size > 0) {
      addLoadedFolderIds(ancestorsToLoad);
    }

    const timeout = setTimeout(() => {
      if (!treeRef.current) return;
      const parentsToLoad = new Set<number>();
      filteredFolders.forEach((folderId) => {
        const node = treeRef.current?.get(folderId.toString());
        if (node) {
          let current = node.parent;
          while (current && !current.isRoot) {
            const currentFolderId = Number(current.id);
            if (!Number.isNaN(currentFolderId)) {
              parentsToLoad.add(currentFolderId);
            }
            current.open();
            current = current.parent;
          }
        }
      });
      if (parentsToLoad.size > 0) {
        addLoadedFolderIds(parentsToLoad);
      }
    }, 0);

    return () => clearTimeout(timeout);
  }, [filteredFolders, folderMap, addLoadedFolderIds]);

  // Reveal filter matches by opening every ancestor on their paths.
  useEffect(() => {
    if (!filterMatchIds || filterMatchIds.size === 0) {
      return;
    }

    const ancestorsToOpen = new Set<number>();
    filterMatchIds.forEach((folderId) => {
      let currentParent = folderMap.get(folderId)?.parentId ?? null;
      while (currentParent !== null && !ancestorsToOpen.has(currentParent)) {
        ancestorsToOpen.add(currentParent);
        currentParent = folderMap.get(currentParent)?.parentId ?? null;
      }
    });
    if (ancestorsToOpen.size === 0) {
      return;
    }
    addLoadedFolderIds(ancestorsToOpen);

    const timeout = setTimeout(() => {
      ancestorsToOpen.forEach((folderId) => {
        treeRef.current?.get(folderId.toString())?.open();
      });
    }, 0);

    return () => clearTimeout(timeout);
  }, [filterMatchIds, folderMap, addLoadedFolderIds]);

  // Clearing the filter puts the open state back; without this the ancestors
  // opened to reveal matches stay expanded for the rest of the session.
  useEffect(() => {
    if (isFiltering) return;
    const snapshot = preFilterOpenIdsRef.current;
    if (!snapshot) return;
    preFilterOpenIdsRef.current = null;

    const timeout = setTimeout(() => {
      const tree = treeRef.current;
      if (!tree) return;
      tree.closeAll();
      snapshot.forEach((nodeId) => tree.get(nodeId)?.open());
      // A folder picked out of the filtered results has to stay reachable even
      // though it was not open before filtering started.
      selectedAncestorIds.forEach((folderId) =>
        tree.get(folderId.toString())?.open()
      );
    }, 0);

    return () => clearTimeout(timeout);
  }, [isFiltering, selectedAncestorIds]);

  // Size the tree to the space it actually occupies on screen. Handing it the
  // combined height of every row instead makes react-window fill a viewport as
  // tall as the content, which renders all rows and defeats virtualization.
  useEffect(() => {
    let frame = 0;

    const measure = () => {
      const element = treeViewportRef.current;
      if (!element) return;
      const { top } = element.getBoundingClientRect();
      // Once the page is scrolled past the tree, top goes negative; cap at the
      // window so the viewport never grows beyond what can be seen.
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
  }, [showFilterInput]);

  // Update hierarchy when tree changes
  useEffect(() => {
    if (folders) {
      const hierarchyData: FolderNode[] = folders.map((folder) => ({
        id: folder.id,
        parent: folder.parentId ?? 0,
        text: folder.name,
        droppable: true,
        hasChildren: folders.some((f) => f.parentId === folder.id),
        data: folder,
        directCaseCount: 0,
        totalCaseCount: 0,
      }));
      setHierarchyData(hierarchyData);
      onHierarchyChange(hierarchyData);
    }
  }, [folders, onHierarchyChange]);

  // Every folder in the given subtrees, read from the folder data rather than
  // the rendered nodes so the whole set is known without waiting on re-renders.
  const collectSubtreeFolderIds = useCallback(
    (rootFolderIds: number[]) => {
      const ids: number[] = [];
      const seen = new Set<number>(rootFolderIds);
      const queue = [...rootFolderIds];
      while (queue.length > 0) {
        const folderId = queue.shift()!;
        ids.push(folderId);
        for (const child of childrenMap.get(folderId) ?? []) {
          if (!seen.has(child.id)) {
            seen.add(child.id);
            queue.push(child.id);
          }
        }
      }
      return ids;
    },
    [childrenMap]
  );

  // Expand-all marks the whole subtree loaded in one state update; doing it per
  // node re-rendered the tree thousands of times and froze the tab.
  const expandSubtrees = useCallback(
    async (rootFolderIds: number[]) => {
      const ids = collectSubtreeFolderIds(rootFolderIds);
      if (ids.length === 0) return;

      setIsExpandingAll(true);
      // Give the browser a frame to paint the busy state before the rebuild.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );

      addLoadedFolderIds(ids);
      setPendingExpandIds(ids);
    },
    [collectSubtreeFolderIds, addLoadedFolderIds]
  );

  // Opening happens once the rebuilt tree contains the newly loaded folders.
  useEffect(() => {
    if (!pendingExpandIds) return;
    const tree = treeRef.current;
    if (tree) {
      pendingExpandIds.forEach((folderId) =>
        tree.get(folderId.toString())?.open()
      );
    }
    setPendingExpandIds(null);
    setIsExpandingAll(false);
  }, [pendingExpandIds, treeData]);

  // Recursively collapse a node and all its descendants
  const collapseAllDescendants = useCallback((node: NodeApi<ArboristNode>) => {
    // Collapse children first (bottom-up)
    if (node.children) {
      for (const child of node.children) {
        if (child.isOpen) {
          collapseAllDescendants(child);
        }
      }
    }
    node.close();
  }, []);

  // Custom node renderer with inline editing and context menu
  const Node = ({
    node,
    style,
    dragHandle,
  }: {
    node: NodeApi<ArboristNode>;
    style: React.CSSProperties;
    dragHandle?: (el: HTMLDivElement | null) => void;
  }) => {
    const isSelected = node.isSelected;
    const data = node.data?.data;
    const hasChildren = !!data?.hasChildren;
    // Only show open folder icon if folder is open AND has children
    const IconComponent = node.isOpen && hasChildren ? FolderOpen : Folder;
    const childrenLoaded = !!data?.childrenLoaded;

    // useDragLayer subscribes the component to drag-state changes; reading
    // dndManager.getMonitor().isDragging() directly does not subscribe and
    // gates useDragModifier's listener attach/detach on incidental re-renders.
    const isDragging = useDragLayer((monitor) => monitor.isDragging());
    const { copyHeld, moveHeld } = useDragModifier(isDragging);

    // Handle test case drops
    const [{ isOver, canDrop }, drop] = useDrop<
      {
        id?: number | string;
        folderId?: number | null;
        draggedItems?: Array<{ id: number | string }>;
      },
      void,
      { isOver: boolean; canDrop: boolean }
    >(
      () => ({
        accept: ItemTypes.TEST_CASE,
        canDrop: (item: {
          id?: number | string;
          folderId?: number | null;
          draggedItems?: Array<{ id: number | string }>;
        }) => {
          const baseChecks =
            !(!canAddEdit || !!filteredFolders) && data?.folderId !== 0;
          if (copyHeld) {
            return baseChecks;
          }
          return baseChecks && item.folderId !== data?.folderId;
        },
        drop: (
          item: {
            id?: number | string;
            folderId?: number | null;
            draggedItems?: Array<{ id: number | string }>;
          },
          monitor
        ) => {
          const targetFolderId = data?.folderId;
          // folderId === 0 is a sentinel for the root pseudo-folder which
          // cannot accept drops; null/undefined means no folder data.
          if (targetFolderId == null || targetFolderId === 0) return;

          const itemsToUpdate: Array<{ id: number | string }> =
            item.draggedItems && item.draggedItems.length > 0
              ? item.draggedItems
              : item.id != null
                ? [{ id: item.id }]
                : [];
          if (itemsToUpdate.length === 0) return;

          const targetFolderName = node.data?.name ?? "";
          if (copyHeld) {
            void handleCopyDrop(
              itemsToUpdate,
              targetFolderId,
              targetFolderName
            );
          } else if (moveHeld) {
            void handleMoveDrop(itemsToUpdate, targetFolderId);
          } else {
            const offset = monitor.getClientOffset();
            if (!offset) return;
            setPendingDrop({
              x: offset.x,
              y: offset.y,
              targetFolderId,
              targetFolderName,
              draggedItems: itemsToUpdate,
            });
          }
        },
        collect: (monitor: any) => ({
          isOver: monitor.isOver(),
          canDrop: monitor.canDrop(),
        }),
      }),
      [
        data?.folderId,
        canAddEdit,
        filteredFolders,
        updateCase,
        refetchCases,
        refetchFolders,
        onRefetchStats,
        t,
        copyHeld,
        moveHeld,
        handleCopyDrop,
        handleMoveDrop,
      ]
    );

    const setCombinedRef = useCallback(
      (element: HTMLDivElement | null) => {
        drop(element);
        if (dragHandle) {
          dragHandle(element);
        }
      },
      [drop, dragHandle]
    );

    // willReceiveDrop is true when a folder is being dragged over this folder (react-arborist)
    const willReceiveFolderDrop = node.state.willReceiveDrop;

    let backgroundColor = isSelected ? "bg-secondary" : "bg-transparent";
    const textColor = isSelected ? "text-secondary-foreground" : "";
    // Highlight when receiving a folder drop (react-arborist) or test case drop (react-dnd)
    if (willReceiveFolderDrop || (isOver && canDrop)) {
      backgroundColor = "bg-primary/20 ring-2 ring-primary ring-inset";
    } else if (isOver && !canDrop && data?.folderId !== 0) {
      backgroundColor = "";
    }

    return (
      <div
        ref={setCombinedRef}
        style={style}
        className={`group flex items-center rounded-md ${backgroundColor} ${textColor} hover:bg-secondary/80 hover:text-secondary-foreground [&:hover_.text-muted-foreground]:text-secondary-foreground cursor-pointer ps-2 pe-0 py-1`}
        onClick={async () => {
          node.select();
          // Toggle expand/collapse when clicking anywhere on the folder row
          if (hasChildren) {
            if (!childrenLoaded) {
              await ensureFolderChildrenLoaded(data?.folderId);
            }
            node.toggle();
          }
        }}
        data-testid={`folder-node-${data?.folderId}`}
        data-folder-drop-target={willReceiveFolderDrop ? "true" : undefined}
        data-drop-target={isOver && canDrop ? "true" : undefined}
        data-drop-invalid={isOver && !canDrop ? "true" : undefined}
      >
        <FolderChevron
          folderId={data?.folderId}
          isOpen={node.isOpen}
          isRootFolder={data?.parentId === null}
          hasChildren={hasChildren}
          onClick={async (e) => {
            e.stopPropagation();
            if (hasChildren) {
              const wasOpen = node.isOpen;
              const isRootFolder = data?.parentId === null;
              // Option key (Mac) / Alt key (Windows) expands/collapses all descendants
              // If on a root folder, expand/collapse ALL root folders
              if (e.altKey) {
                if (isRootFolder && treeRef.current) {
                  // Expand/collapse all root folders
                  const rootNodes = treeData
                    .map((n) => treeRef.current?.get(n.id))
                    .filter(Boolean) as NodeApi<ArboristNode>[];
                  if (wasOpen) {
                    // Collapse all root folders
                    for (const rootNode of rootNodes) {
                      collapseAllDescendants(rootNode);
                    }
                  } else {
                    node.select();
                    await expandSubtrees(
                      treeData
                        .map((n) => Number(n.id))
                        .filter((id) => !Number.isNaN(id))
                    );
                  }
                } else {
                  // Non-root folder: expand/collapse only descendants
                  if (wasOpen) {
                    collapseAllDescendants(node);
                  } else {
                    node.select();
                    if (data?.folderId) {
                      await expandSubtrees([data.folderId]);
                    }
                  }
                }
              } else {
                if (!childrenLoaded) {
                  await ensureFolderChildrenLoaded(data?.folderId);
                }
                node.toggle();
                // Select the folder when expanding
                if (!wasOpen) {
                  node.select();
                }
              }
            }
          }}
        />
        <IconComponent
          className={`w-4 h-4 ms-1 shrink-0 ${
            isSelected ? "text-secondary-foreground" : "text-muted-foreground"
          }`}
        />
        <span
          className="ms-2 truncate flex-1 min-w-0 text-sm"
          title={
            data && (data.directCaseCount > 0 || data.totalCaseCount > 0)
              ? `${node.data.name} (${data.directCaseCount}/${data.totalCaseCount})`
              : node.data.name
          }
        >
          <HighlightedMatch
            text={node.data.name}
            query={normalizedFilter}
            testId="folder-filter-match"
          />
        </span>

        {pendingCopyTargets.has(data?.folderId ?? -1) && (
          <Loader2
            className="ms-2 h-3 w-3 animate-spin text-primary shrink-0"
            data-testid={`folder-row-copy-progress-${data?.folderId}`}
            aria-label={t("repository.dragDrop.copying")}
          />
        )}

        {data && (data.directCaseCount > 0 || data.totalCaseCount > 0) && (
          <span
            className={`ms-2 pe-px text-xs shrink-0 ${isSelected ? "text-secondary-foreground" : "text-muted-foreground"}`}
          >
            {`(${data.directCaseCount}/${data.totalCaseCount})`}
          </span>
        )}

        {canAddEdit && !filteredFolders && data?.folderId !== 0 && (
          <div className="ms-1 flex items-center h-7 invisible group-hover:visible shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-6 p-0"
                  data-testid={`folder-actions-trigger-${data?.folderId ?? 0}`}
                  aria-label={t("common.actions.actionsLabel")}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    setEditModalState({
                      open: true,
                      folderId: data?.folderId || null,
                    })
                  }
                >
                  <div className="flex items-center gap-2">
                    <SquarePenIcon className="h-4 w-4" />
                    {t("repository.folderActions.edit")}
                  </div>
                </DropdownMenuItem>
                {onCopyMoveFolder && (
                  <DropdownMenuItem
                    data-testid={`folder-action-copy-move-${data?.folderId ?? 0}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyMoveFolder(data?.folderId ?? 0, node.data.name);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4" />
                      {t("repository.cases.copyMoveToProject")}
                    </div>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    const folderNode: FolderNode = {
                      id: data?.folderId || 0,
                      parent: data?.parentId ?? 0,
                      text: node.data.name,
                      droppable: true,
                      hasChildren: !!node.children?.length,
                      data: data?.originalData,
                      directCaseCount: data?.directCaseCount || 0,
                      totalCaseCount: data?.totalCaseCount || 0,
                    };
                    setDeleteModalState({ open: true, node: folderNode });
                  }}
                  className="text-destructive"
                >
                  <div className="flex items-center gap-2">
                    <Trash2Icon className="h-4 w-4" />
                    {t("repository.folderActions.delete")}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  };

  // Handle drag leave to hide cursor when dragging outside tree area
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide cursor if we're actually leaving the tree container
    // Check if relatedTarget is outside the container
    const container = e.currentTarget;
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !container.contains(relatedTarget)) {
      treeRef.current?.hideCursor();
    }
  }, []);

  // Bottom drop zone for moving folders to end of root level
  const [{ isOverBottom }, bottomDropRef] = useDrop<
    { id: string; dragIds: string[] },
    void,
    { isOverBottom: boolean }
  >(
    () => ({
      accept: "NODE", // react-arborist uses "NODE" for folder drag items
      canDrop: () => canAddEdit && !filteredFolders,
      drop: (item) => {
        // Move the dragged folder to the end of root level
        const rootFolders = folders?.filter((f) => f.parentId === null) || [];
        const maxOrder = rootFolders.reduce(
          (max, f) => Math.max(max, f.order),
          -1
        );
        void handleMove({
          dragIds: item.dragIds || [item.id],
          parentId: null,
          index: maxOrder + 1,
        });
      },
      collect: (monitor) => ({
        isOverBottom: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [canAddEdit, filteredFolders, folders, handleMove]
  );

  // Show loading spinner while data is being fetched (with delay to prevent flashing)
  if (showSpinner || folders === undefined) {
    return <LoadingSpinner />;
  }

  // Only show empty message after loading is complete and there are no folders
  if (folders && folders.length === 0) {
    return (
      <div className="m-4 text-center text-muted-foreground">
        {canAddEdit
          ? t("repository.emptyFolders")
          : t("repository.noFoldersOrCasesNoPermission")}
      </div>
    );
  }

  return (
    <>
      {showFilterInput && (
        <div className="relative mb-2 ms-1 me-2">
          <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            value={filterQuery}
            onChange={(e) => {
              captureOpenStateBeforeFiltering();
              setFilterQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setFilterQuery("");
              }
            }}
            placeholder={t("search.filter")}
            aria-label={t("search.filter")}
            className="h-7 ps-7 pe-7 text-xs"
            data-testid="folder-filter-input"
          />
          {isFiltering && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-0.5 top-1/2 -translate-y-1/2 h-6 w-6"
              aria-label={t("common.aria.clearFilter")}
              data-testid="folder-filter-clear"
              onClick={() => setFilterQuery("")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
      <div
        ref={treeViewportRef}
        onDragLeave={handleDragLeave}
        className="relative flex flex-col"
        aria-busy={isExpandingAll || undefined}
      >
        {isExpandingAll && (
          <div
            className="absolute inset-0 z-10 flex items-start justify-center bg-background/70 pt-8"
            data-testid="folder-tree-busy"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          </div>
        )}
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
          selection={selectedId || selectedFolderId?.toString() || undefined}
          onSelect={handleSelect}
          onToggle={async (id) => {
            const folderId = Number(id);
            if (!Number.isNaN(folderId) && treeRef.current?.isOpen(id)) {
              await ensureFolderChildrenLoaded(folderId);
            }
          }}
          onMove={
            canAddEdit && !filteredFolders && !isFiltering
              ? handleMove
              : undefined
          }
          disableDrag={!canAddEdit || !!filteredFolders || isFiltering}
          disableDrop={!canAddEdit || !!filteredFolders || isFiltering}
          dndRootElement={dndRootElement || undefined}
        >
          {Node}
        </Tree>
        {isFiltering && treeData.length === 0 && (
          <div
            className="px-2 py-4 text-center text-xs text-muted-foreground"
            data-testid="folder-filter-no-matches"
          >
            {t("common.ui.search.noResultsFound")}
          </div>
        )}
        {/* Bottom drop zone for moving folders to end of root level - fills remaining space */}
        {canAddEdit && !filteredFolders && !isFiltering && (
          <div
            ref={(el) => {
              bottomDropRef(el);
            }}
            className="h-16 w-full relative shrink-0"
            data-testid="folder-tree-end"
          >
            {/* Drop indicator line with circle - matches react-arborist cursor style */}
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
                  style={{
                    height: 2,
                    background: "#4B91E2",
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editModalState.open && editModalState.folderId && (
        <EditFolderModal
          folderId={editModalState.folderId}
          open={editModalState.open}
          onClose={() => setEditModalState({ open: false, folderId: null })}
        />
      )}

      {/* Delete Modal */}
      {deleteModalState.open && deleteModalState.node && (
        <DeleteFolderModal
          folderNode={deleteModalState.node}
          canAddEdit={canAddEdit}
          refetchFolders={refetchFolders}
          refetchCases={refetchCases}
          onDeleted={() => {
            onSelectFolder(null);
            setSelectedId(null);
            const url = new URL(window.location.href);
            url.searchParams.delete("node");
            commitUrlSearch(url);
          }}
          open={deleteModalState.open}
          onClose={() => setDeleteModalState({ open: false, node: null })}
        />
      )}

      <Popover
        open={!!pendingDrop}
        onOpenChange={(open) => {
          if (!open) setPendingDrop(null);
        }}
      >
        {virtualAnchor && (
          <PopoverAnchor
            {...({
              virtualRef: { current: virtualAnchor },
            } as unknown as Record<string, unknown>)}
          />
        )}
        <PopoverContent
          data-testid="drop-action-popover"
          side="bottom"
          align="start"
          className="flex flex-col gap-2"
          onEscapeKeyDown={() => setPendingDrop(null)}
          onInteractOutside={() => setPendingDrop(null)}
        >
          <Button
            autoFocus
            data-testid="drop-action-cancel"
            variant="default"
            onClick={() => setPendingDrop(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="drop-action-move"
            variant="secondary"
            onClick={() => {
              if (
                pendingDrop &&
                pendingDrop.draggedItems.length > 0 &&
                pendingDrop.targetFolderId
              ) {
                void handleMoveDrop(
                  pendingDrop.draggedItems,
                  pendingDrop.targetFolderId
                );
              }
              setPendingDrop(null);
            }}
          >
            <ArrowRightLeft className="h-4 w-4" />
            {t("repository.dragDrop.move")}
          </Button>
          <Button
            data-testid="drop-action-copy"
            variant="secondary"
            onClick={() => {
              if (
                pendingDrop &&
                pendingDrop.draggedItems.length > 0 &&
                pendingDrop.targetFolderId
              ) {
                void handleCopyDrop(
                  pendingDrop.draggedItems,
                  pendingDrop.targetFolderId,
                  pendingDrop.targetFolderName
                );
              }
              setPendingDrop(null);
            }}
          >
            <CopyPlus className="h-4 w-4" />
            {t("repository.dragDrop.copy")}
          </Button>
          <p className="text-xs text-muted-foreground pt-1 border-t">
            {t(
              isMac
                ? "repository.dragDrop.modifierHintMac"
                : "repository.dragDrop.modifierHintWin"
            )}
          </p>
        </PopoverContent>
      </Popover>
    </>
  );
};

export default TreeView;
