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
import { useState } from "react";
import { toast } from "sonner";

interface DeleteRequirementModalProps {
  projectId: string;
  requirementId: number;
  /** The subtree's descendant count (root excluded), computed by the caller
   *  by walking the tree's own in-memory childrenMap -- not fetched. This
   *  tree already holds every requirement in memory (load-all, plan 25-08),
   *  so there is no lazy-load gap to bridge the way
   *  `useFindManyRepositoryCasesByDescendants` bridges one for folders; a
   *  second server round trip here would only invite the tree and this
   *  modal to disagree about the count. */
  descendantCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Handed the server's own `deletedIds` (root + every descendant) so the
   *  caller can decide whether the current selection needs clearing --
   *  never recomputed client-side, since that is exactly the truth the
   *  server just produced. */
  onDeleted?: (deletedIds: number[]) => void;
}

/**
 * HIER-04's honest cascade confirmation. Forked from `DeleteFolderModal.tsx`'s
 * `AlertDialog` structure and `handleDelete` fetch shape (25-PATTERNS.md) --
 * the route and body are swapped for the requirement equivalent (no body;
 * `requirementId` is a path param, not a JSON field). The delete itself runs
 * through 25-05's server-guarded `delete-subtree` route, which resolves the
 * whole subtree with a depth-capped CTE inside one transaction and
 * soft-deletes it (`deleteRequirementSubtree`, Phase 21) -- this modal never
 * loops over descendants or deletes client-side.
 */
export function DeleteRequirementModal({
  projectId,
  requirementId,
  descendantCount,
  open,
  onOpenChange,
  onDeleted,
}: DeleteRequirementModalProps) {
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDelete = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${requirementId}/delete-subtree`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error(`Delete failed (status ${res.status})`);
      }
      const body = (await res.json().catch(() => null)) as {
        deletedIds?: number[];
      } | null;
      onOpenChange(false);
      toast.success(t("requirements.delete.success"));
      onDeleted?.(body?.deletedIds ?? [requirementId]);
    } catch (err) {
      console.error("Failed to delete requirement:", err);
      toast.error(t("requirements.delete.failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="sm:max-w-[425px] lg:max-w-[600px] border-destructive"
        data-testid="delete-requirement-dialog"
      >
        <div className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 me-2" />
              {t("requirements.delete.dialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="overflow-hidden">
              {descendantCount > 0
                ? t("requirements.delete.confirmWithChildren", {
                    count: descendantCount,
                  })
                : t("requirements.delete.confirmNoChildren")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={isSubmitting}
              onClick={(e) => {
                // `AlertDialogAction` is Radix's `DialogPrimitive.Close` --
                // it closes the (controlled) dialog on click by default,
                // synchronously, before this async delete resolves.
                // preventDefault stops that so a failed delete leaves the
                // dialog open; `onOpenChange(false)` inside handleDelete is
                // the only path that actually closes it, and only runs on
                // success.
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground"
              data-testid="delete-requirement-confirm"
            >
              {isSubmitting
                ? t("common.actions.deleting")
                : t("requirements.delete.submit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
