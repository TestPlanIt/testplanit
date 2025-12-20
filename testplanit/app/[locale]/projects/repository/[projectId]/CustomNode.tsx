import React, { useCallback } from "react";
import { useDrop, DropTargetMonitor } from "react-dnd";
import { FolderNode } from "./TreeView";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  MoreVertical,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateRepositoryCases } from "~/lib/hooks";
import { ItemTypes } from "~/types/dndTypes";
import { toast } from "@/components/ui/use-toast";
import { useTranslations } from "next-intl";
import { EditFolderModal } from "./EditFolder";
import { DeleteFolderModal } from "./DeleteFolderModal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type CustomNodeProps = {
  node: FolderNode;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
  onToggle: (event: React.MouseEvent) => void;
  onSelect: (node: FolderNode) => void;
  draggable?: boolean;
  handleRef: React.Ref<HTMLDivElement>;
  disableEditing?: boolean;
  canAddEdit: boolean;
  refetchCases?: () => void;
  refetchFolders?: () => void;
  allFolders: FolderNode[];
  options?: { treeData?: FolderNode[] };
  directCaseCount?: number;
  totalCaseCount?: number;
};

// Structure for individual items within draggedItems array, mirrors SortableItem and TestCaseDragPreview
interface DraggedCaseInfo {
  id: number | string;
  // name: string; // Name is not strictly needed for the drop operation logic here
}

// Updated structure for the item received by the drop target
interface TestCaseDropItem {
  id?: number | string; // Primary item's id, if applicable (item that was directly dragged)
  folderId?: number | null; // Primary item's original folderId
  // name?: string;              // Primary item's name - not used in drop logic
  // index?: number;             // Primary item's index - not used in drop logic
  draggedItems?: DraggedCaseInfo[]; // Array of all items being dragged (if multi-select)
}

const CustomNode: React.FC<CustomNodeProps> = ({
  node,
  depth,
  isOpen,
  isSelected,
  onToggle,
  onSelect,
  handleRef,
  disableEditing,
  canAddEdit,
  refetchCases,
  refetchFolders,
  allFolders,
  options,
  directCaseCount,
  totalCaseCount,
}) => {
  const { id, text } = node;
  const indent = depth * 24;
  const t = useTranslations();

  const { mutateAsync: updateCase } = useUpdateRepositoryCases();

  const [{ isOver, canDrop }, drop] = useDrop<
    TestCaseDropItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: ItemTypes.TEST_CASE,
      canDrop: (item) => {
        return !disableEditing && id !== 0 && item.folderId !== id;
      },
      drop: (item) => {
        const targetFolderId = id;
        const processDrop = async () => {
          let itemsToUpdate: DraggedCaseInfo[] = [];

          // LOGGING: See what is received on drop
          // console.log("[DROP] Received item:", item);

          if (item.draggedItems && item.draggedItems.length > 0) {
            itemsToUpdate = item.draggedItems;
          } else if (item.id) {
            itemsToUpdate.push({ id: item.id });
          }

          // LOGGING: What will be updated
          // console.log("[DROP] itemsToUpdate:", itemsToUpdate);

          if (itemsToUpdate.length === 0) {
            return;
          }

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
            refetchCases?.();
            refetchFolders?.();
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
      collect: (monitor: DropTargetMonitor<TestCaseDropItem, void>) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [id, text, disableEditing, updateCase, refetchCases, refetchFolders, t]
  );

  const handleNodeSelect = () => onSelect(node);

  const IconComponent = isSelected ? FolderOpen : Folder;

  let backgroundColor = isSelected ? "bg-secondary" : "bg-transparent";
  const textColor = isSelected ? "text-secondary-foreground" : "";
  if (isOver && canDrop) {
    backgroundColor = "bg-blue-100 dark:bg-blue-900/50";
  } else if (isOver && !canDrop && id !== 0) {
    backgroundColor = "bg-red-100 dark:bg-red-900/50";
  }

  const setCombinedRef = useCallback(
    (element: HTMLDivElement | null) => {
      drop(element);
      if (typeof handleRef === "function") {
        handleRef(element);
      } else if (handleRef) {
        (handleRef as React.MutableRefObject<HTMLDivElement | null>).current =
          element;
      }
    },
    [drop, handleRef]
  );

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  return (
    <div
      ref={setCombinedRef}
      className={`group flex items-center rounded-md ${backgroundColor} ${textColor} hover:bg-secondary/80`}
      style={{ paddingInlineStart: indent }}
      onClick={handleNodeSelect}
      role="button"
      tabIndex={0}
      data-testid={`folder-node-${id}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleNodeSelect();
        }
      }}
    >
      <div className="flex items-center grow min-w-0">
        <Button
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(e);
          }}
          className={`px-1 py-0 h-auto ${node.hasChildren ? "visible" : "invisible"}`}
          aria-label={
            isOpen ? t("common.actions.collapse") : t("common.actions.expand")
          }
        >
          <ChevronRight
            className={`w-4 h-4 text-muted-foreground transition-transform duration-100 ${isOpen ? "rotate-90" : ""}`}
          />
        </Button>
        <div className="ml-1">
          <IconComponent
            className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
        </div>
        <div
          className={`flex-1 pl-1 truncate ${isSelected ? "font-semibold" : ""}`}
        >
          {text}
        </div>
        {canAddEdit && !disableEditing && id !== 0 && (
          <div className="ml-1 flex items-center h-7 invisible group-hover:visible shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 p-0">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <div className="flex items-center gap-2">
                    <SquarePenIcon className="h-4 w-4" />
                    {t("repository.folderActions.edit")}
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive"
                >
                  <div className="flex items-center gap-2">
                    <Trash2Icon className="h-4 w-4" />
                    {t("repository.folderActions.delete")}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {editOpen && (
              <EditFolderModal
                folderId={id}
                selected={isSelected}
                open={editOpen}
                onOpenChange={setEditOpen}
              />
            )}
            {deleteOpen && (
              <DeleteFolderModal
                folderNode={node}
                allFolders={allFolders}
                canAddEdit={canAddEdit}
                refetchFolders={refetchFolders}
                refetchCases={refetchCases}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
              />
            )}
          </div>
        )}
        {(directCaseCount !== undefined || totalCaseCount !== undefined) && (
          <span className="ml-2 text-xs text-muted-foreground shrink-0">
            {`(${directCaseCount ?? 0}/${totalCaseCount ?? 0})`}
          </span>
        )}
      </div>
    </div>
  );
};

export default CustomNode;
