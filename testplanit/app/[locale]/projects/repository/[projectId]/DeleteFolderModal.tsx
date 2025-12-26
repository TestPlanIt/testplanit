"use client";
import { useState, useMemo, useCallback } from "react";
import {
  useUpdateManyRepositoryCases,
  useUpdateManyRepositoryFolders,
  useFindManyRepositoryCases,
} from "~/lib/hooks";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export interface FolderNode {
  id: number;
  parent: number | string;
  text: string;
  droppable: boolean;
  hasChildren: boolean;
  data?: any;
}

interface DeleteFolderModalProps {
  folderNode: FolderNode;
  allFolders: FolderNode[];
  refetchFolders?: () => void;
  refetchCases?: () => void;
  canAddEdit: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DeleteFolderModal({
  folderNode,
  allFolders,
  refetchFolders,
  refetchCases,
  canAddEdit,
  open: controlledOpen,
  onOpenChange,
}: DeleteFolderModalProps) {
  const t = useTranslations();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpen = onOpenChange || setUncontrolledOpen;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateManyCases } = useUpdateManyRepositoryCases();
  const { mutateAsync: updateManyFolders } = useUpdateManyRepositoryFolders();
  const { projectId } = useParams<{ projectId: string }>();

  // Helper to get all descendant folder IDs (including self)
  const getDescendantFolderIds = useCallback(
    (folderId: number, folders: FolderNode[]): number[] => {
      const children = folders.filter((f) => f.parent === folderId);
      let ids = [folderId];
      children.forEach((child) => {
        ids = ids.concat(getDescendantFolderIds(child.id, folders));
      });
      return ids;
    },
    []
  );

  // All folder IDs to delete
  const folderIdsToDelete = useMemo(
    () => getDescendantFolderIds(folderNode.id, allFolders),
    [folderNode.id, allFolders, getDescendantFolderIds]
  );

  // Fetch all cases in these folders when dialog is open
  const { data: cases, isLoading: isCasesLoading } = useFindManyRepositoryCases(
    open && projectId
      ? {
          where: {
            projectId: Number(projectId),
            folderId: { in: folderIdsToDelete },
            isDeleted: false,
          },
          select: { id: true },
        }
      : undefined,
    { enabled: open && !!projectId }
  );

  // Count all cases in these folders (from API if available, fallback to old logic)
  const caseCount = open
    ? isCasesLoading
      ? null
      : cases
        ? cases.length
        : 0
    : 0;

  if (!canAddEdit || folderNode.id === 0) return null;

  const handleCancel = () => setOpen(false);

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(true);
  };

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      // Mark all cases in these folders as deleted
      await updateManyCases({
        data: { isDeleted: true },
        where: { folderId: { in: folderIdsToDelete } },
      });
      // Mark all folders as deleted
      await updateManyFolders({
        data: { isDeleted: true },
        where: { id: { in: folderIdsToDelete } },
      });
      setOpen(false);
      toast.success(t("repository.deleteFolder.success"));
      refetchFolders?.();
      refetchCases?.();
    } catch (err: any) {
      console.error("Error deleting folder(s):", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined && (
        <Button
          variant="secondary"
          className="text-destructive"
          type="button"
          onClick={handleOpen}
          data-testid={`delete-folder-btn-${folderNode.id}`}
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      )}
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[600px] border-destructive">
        <div className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 mr-2" />
              {t("repository.folderActions.delete")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="overflow-hidden">
            {isCasesLoading
              ? t("common.loading")
              : t("repository.deleteFolder.confirmMessage", {
                  count: caseCount ?? 0,
                })}
          </div>
          <div className="bg-destructive text-destructive-foreground p-2">
            {t("repository.deleteFolder.warning")}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={handleCancel}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isSubmitting}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {isSubmitting
                ? t("common.actions.deleting")
                : t("repository.deleteFolder.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
