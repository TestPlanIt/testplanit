import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useParams } from "next/navigation";
import {
  useFindManyRepositoryFolders,
  useUpdateRepositoryFolders,
  useUpdateRepositoryCases,
} from "~/lib/hooks";
import { Tree, NodeApi, TreeApi } from "react-arborist";
import { useTranslations } from "next-intl";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  MoreVertical,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditFolderModal } from "./EditFolder";
import { DeleteFolderModal } from "./DeleteFolderModal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useDrop } from "react-dnd";
import { ItemTypes } from "~/types/dndTypes";
import { toast } from "@/components/ui/use-toast";
import type { RepositoryFolders } from "@prisma/client";

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
  onRefetchFolders?: (refetch: () => void) => void;
  onRefetchStats?: () => void;
  /** Ref to an element to scope DnD events to (prevents "Cannot have two HTML5 backends" error in portals) */
  dndRootElement?: HTMLElement | null;
}> = ({
  onSelectFolder,
  onHierarchyChange,
  selectedFolderId,
  filteredFolders,
  canAddEdit,
  runId,
  folderStatsData,
  onRefetchFolders,
  onRefetchStats,
  dndRootElement,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const t = useTranslations();
  const treeRef = useRef<TreeApi<ArboristNode>>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevSelectedFolderIdRef = useRef<number | null>(null);
  const [hierarchyData, setHierarchyData] = useState<FolderNode[]>([]);
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

  // Fetch lightweight metadata for ALL folders (just id and parentId to build hierarchy)
  // This is much faster than loading full folder objects
  const { data: folderHierarchyData } = useFindManyRepositoryFolders(
    {
      where: {
        projectId: Number(projectId),
        isDeleted: false,
      },
      select: {
        id: true,
        parentId: true,
      },
    },
    {
      optimisticUpdate: false,
    }
  );

  // Build a map of which folders have children (from lightweight data)
  const hasChildrenMap = useMemo(() => {
    const map = new Map<number, boolean>();
    if (folderHierarchyData) {
      // Initialize all folders as having no children
      folderHierarchyData.forEach((f) => map.set(f.id, false));
      // Mark folders that have children
      folderHierarchyData.forEach((f) => {
        if (f.parentId !== null) {
          map.set(f.parentId, true);
        }
      });
    }
    return map;
  }, [folderHierarchyData]);

  // Load ALL folders at once (full data)
  // This is more efficient than lazy loading because:
  // 1. Folder metadata is small (no test cases)
  // 2. Avoids ZenStack access control issues on lazy load endpoint
  // 3. Enables instant expand/collapse without network requests
  const {
    data: allFolders,
    isLoading: foldersLoading,
    error,
    refetch: refetchFolders,
  } = useFindManyRepositoryFolders(
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

  const visibleFolderIds = useMemo(() => {
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

  const { mutateAsync: updateFolder } = useUpdateRepositoryFolders();
  const { mutateAsync: updateCase } = useUpdateRepositoryCases();

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
            children: hasChildren
              ? childrenLoaded
                ? buildTree(child.id)
                : []
              : undefined,
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
          window.history.pushState({}, "", url.toString());
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
          ensureFolderChildrenLoaded(newParentId);
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
      ensureFolderPathLoaded(selectedFolderId);

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
      ensureFolderPathLoaded(selectedFolderId);
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
              ensureFolderChildrenLoaded(parentFolderId);
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
    const handleFolderSelectionChanged = (event: CustomEvent) => {
      const folderId = event.detail?.folderId;
      if (folderId && treeRef.current) {
        const nodeId = folderId.toString();
        ensureFolderPathLoaded(folderId);
        setTimeout(() => {
          const node = treeRef.current?.get(nodeId);
          if (node) {
            node.select();
            setSelectedId(nodeId);

            let parent = node.parent;
            while (parent && !parent.isRoot) {
              const parentFolderId = Number(parent.id);
              if (!Number.isNaN(parentFolderId)) {
                ensureFolderChildrenLoaded(parentFolderId);
              }
              parent.open();
              parent = parent.parent;
            }

            onSelectFolder(folderId);
          }
        }, 0);
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

  // Recursively expand a node and all its descendants
  const expandAllDescendants = useCallback(
    async (node: NodeApi<ArboristNode>) => {
      const folderId = node.data?.data?.folderId;
      if (folderId) {
        await ensureFolderChildrenLoaded(folderId);
      }
      node.open();

      // Expand all children recursively
      if (node.children) {
        for (const child of node.children) {
          if (child.data?.data?.hasChildren) {
            await expandAllDescendants(child);
          }
        }
      }
    },
    [ensureFolderChildrenLoaded]
  );

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
    const IconComponent = node.isOpen ? FolderOpen : Folder;
    const data = node.data?.data;
    const hasChildren = !!data?.hasChildren;
    const childrenLoaded = !!data?.childrenLoaded;

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
          return (
            !(!canAddEdit || !!filteredFolders) &&
            data?.folderId !== 0 &&
            item.folderId !== data?.folderId
          );
        },
        drop: (item: {
          id?: number | string;
          folderId?: number | null;
          draggedItems?: Array<{ id: number | string }>;
        }) => {
          const targetFolderId = data?.folderId;
          if (!targetFolderId) return;

          const processDrop = async () => {
            let itemsToUpdate: Array<{ id: number | string }> = [];

            if (item.draggedItems && item.draggedItems.length > 0) {
              itemsToUpdate = item.draggedItems;
            } else if (item.id) {
              itemsToUpdate.push({ id: item.id });
            }

            if (itemsToUpdate.length === 0) return;

            try {
              const updatePromises = itemsToUpdate.map((draggedItem) =>
                updateCase({
                  where: { id: Number(draggedItem.id) },
                  data: { folderId: targetFolderId },
                })
              );
              await Promise.all(updatePromises);

              toast({
                title: t("common.fields.success"),
                description: t("common.messages.updateSuccess", {
                  count: itemsToUpdate.length,
                }),
              });
              refetchCases();
              refetchFolders();
              onRefetchStats?.();
            } catch (error) {
              console.error("Failed to move test case(s):", error);
              toast({
                title: t("common.errors.error"),
                description: t("common.messages.updateError"),
                variant: "destructive",
              });
            }
          };
          processDrop();
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

    let backgroundColor = isSelected ? "bg-secondary" : "bg-transparent";
    const textColor = isSelected ? "text-secondary-foreground" : "";
    if (isOver && canDrop) {
      backgroundColor = "bg-primary/50";
    } else if (isOver && !canDrop && data?.folderId !== 0) {
      backgroundColor = "";
    }

    return (
      <div
        ref={setCombinedRef}
        style={style}
        className={`group flex items-center rounded-md ${backgroundColor} ${textColor} hover:bg-secondary/80 cursor-pointer px-2 py-1`}
        onClick={() => node.select()}
        data-testid={`folder-node-${data?.folderId}`}
      >
        <Button
          variant="ghost"
          size="sm"
          className={`p-0 h-6 w-6 ${hasChildren ? "" : "invisible"}`}
          onClick={async (e) => {
            e.stopPropagation();
            if (hasChildren) {
              const wasOpen = node.isOpen;
              // Option key (Mac) / Alt key (Windows) expands/collapses all descendants
              if (e.altKey) {
                if (wasOpen) {
                  collapseAllDescendants(node);
                } else {
                  await expandAllDescendants(node);
                  node.select();
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
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform ${
              node.isOpen ? "rotate-90" : ""
            }`}
          />
        </Button>
        <IconComponent
          className={`w-4 h-4 ml-1 ${
            isSelected ? "text-primary" : "text-muted-foreground"
          }`}
        />
        <span className="ml-2 truncate flex-1">{node.data.name}</span>

        {canAddEdit && !filteredFolders && data?.folderId !== 0 && (
          <div className="ml-1 flex items-center h-7 invisible group-hover:visible shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 p-0">
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

        {data && (data.directCaseCount > 0 || data.totalCaseCount > 0) && (
          <span className="ml-2 text-xs text-muted-foreground shrink-0">
            {`(${data.directCaseCount}/${data.totalCaseCount})`}
          </span>
        )}
      </div>
    );
  };

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
      <Tree
        ref={treeRef}
        data={treeData}
        openByDefault={false}
        initialOpenState={initialOpenState}
        width="100%"
        height={Math.max(treeData.length * 35, 700)}
        indent={24}
        rowHeight={32}
        overscanCount={0}
        selection={selectedId || selectedFolderId?.toString() || undefined}
        onSelect={handleSelect}
        onToggle={async (id) => {
          const folderId = Number(id);
          if (!Number.isNaN(folderId) && treeRef.current?.isOpen(id)) {
            await ensureFolderChildrenLoaded(folderId);
          }
        }}
        onMove={canAddEdit && !filteredFolders ? handleMove : undefined}
        disableDrag={!canAddEdit || !!filteredFolders}
        disableDrop={!canAddEdit || !!filteredFolders}
        dndRootElement={dndRootElement || undefined}
      >
        {Node}
      </Tree>

      {/* Edit Modal */}
      {editModalState.open && editModalState.folderId && (
        <EditFolderModal
          folderId={editModalState.folderId}
          selected={selectedId === editModalState.folderId.toString()}
          open={editModalState.open}
          onOpenChange={(open) => setEditModalState({ open, folderId: null })}
        />
      )}

      {/* Delete Modal */}
      {deleteModalState.open && deleteModalState.node && (
        <DeleteFolderModal
          folderNode={deleteModalState.node}
          allFolders={hierarchyData}
          canAddEdit={canAddEdit}
          refetchFolders={refetchFolders}
          refetchCases={refetchCases}
          open={deleteModalState.open}
          onOpenChange={(open) => setDeleteModalState({ open, node: null })}
        />
      )}
    </>
  );
};

export default TreeView;
