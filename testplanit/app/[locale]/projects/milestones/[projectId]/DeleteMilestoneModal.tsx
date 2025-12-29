"use client";
import { useState } from "react";
import { useUpdateMilestones } from "~/lib/hooks";
import { Milestones } from "@prisma/client";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DeleteMilestoneModalProps {
  milestone: Milestones;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestones: Milestones[];
  onDeleteSuccess?: () => void;
}

export function DeleteMilestoneModal({
  milestone,
  open,
  onOpenChange,
  milestones,
  onDeleteSuccess,
}: DeleteMilestoneModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: updateMilestone } = useUpdateMilestones();
  const t = useTranslations("milestones.delete");
  const tCommon = useTranslations("common");

  async function handleDelete() {
    setIsSubmitting(true);
    setError(null);
    try {
      await updateMilestone({
        where: { id: milestone.id },
        data: {
          isDeleted: true,
        },
      });

      const updateDescendants = async (parentId: number) => {
        const childMilestones = milestones.filter(
          (m) => m.parentId === parentId
        );
        for (const child of childMilestones) {
          await updateMilestone({
            where: { id: child.id },
            data: { isDeleted: true },
          });
          await updateDescendants(child.id);
        }
      };

      await updateDescendants(milestone.id);

      if (onDeleteSuccess) {
        onDeleteSuccess();
      }

      onOpenChange(false);
    } catch (err: any) {
      setError(tCommon("errors.unknown"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center">
            <TriangleAlert className="w-6 h-6 mr-2" />
            {t("title")}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <div>
          {t("confirmMessage", {
            name: milestone.name,
          })}
        </div>
        <div className="bg-destructive text-destructive-foreground p-2">
          {t("warning")}
        </div>
        <AlertDialogFooter>
          {error && (
            <div
              className="bg-destructive text-destructive-foreground text-sm p-2"
              role="alert"
            >
              {error}
            </div>
          )}
          <AlertDialogCancel disabled={isSubmitting}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? tCommon("actions.deleting")
              : tCommon("actions.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
