"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useFindManyRepositoryCasesByDescendants } from "~/hooks/useRepositoryCasesByDescendants";

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
  refetchFolders?: () => void;
  refetchCases?: () => void;
  onDeleted?: () => void;
  canAddEdit: boolean;
  open: boolean;
  onClose: () => void;
}

export function DeleteFolderModal({
  folderNode,
  refetchFolders,
  refetchCases,
  onDeleted,
  canAddEdit,
  open,
  onClose,
}: DeleteFolderModalProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { projectId } = useParams<{ projectId: string }>();

  // Count the cases that will be deleted for the confirmation message. The
  // server walks the folder subtree from the single root folderId (recursive
  // CTE) and returns only the count, so a deep tree never has to enumerate
  // every descendant folder id in the request — that is what previously
  // overflowed the GET query string and returned HTTP 414.
  const { totalCount, isLoading: isCasesLoading } =
    useFindManyRepositoryCasesByDescendants({
      projectId: Number(projectId),
      folderId: folderNode.id,
      where: { isDeleted: false },
      enabled: open && !!projectId && folderNode.id !== 0,
    });

  const caseCount = open ? (isCasesLoading ? null : (totalCount ?? 0)) : 0;

  if (!canAddEdit || folderNode.id === 0) return null;

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      // Delete the whole subtree in one request. The server resolves every
      // descendant folder and soft-deletes the folders (bulk, with the
      // name-freeing rename) and their cases atomically — replacing the old
      // client-side fan-out of one PUT per folder, which exhausted browser
      // connections (net::ERR_INSUFFICIENT_RESOURCES) on large trees.
      const res = await fetch(
        `/api/projects/${projectId}/folders/delete-subtree`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: folderNode.id }),
        }
      );

      if (!res.ok) {
        throw new Error(`Delete failed (status ${res.status})`);
      }

      onClose();
      toast.success(t("repository.deleteFolder.success"));
      onDeleted?.();
      refetchFolders?.();
      refetchCases?.();
    } catch (err: any) {
      console.error("Error deleting folder(s):", err);
      toast.error(t("common.errors.somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[600px] border-destructive">
        <div className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 me-2" />
              {t("repository.folderActions.delete")}
            </AlertDialogTitle>
            <AlertDialogDescription className="overflow-hidden">
              {isCasesLoading
                ? t("common.loading")
                : t("repository.deleteFolder.confirmMessage", {
                    count: caseCount ?? 0,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-destructive text-destructive-foreground p-2">
            {t("repository.deleteFolder.warning")}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={onClose}>
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
