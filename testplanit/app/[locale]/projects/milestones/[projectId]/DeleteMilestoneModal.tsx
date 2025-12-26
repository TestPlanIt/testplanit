"use client";
import { useState } from "react";
import { useUpdateMilestones } from "~/lib/hooks";
import { Milestones } from "@prisma/client";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const { mutateAsync: updateMilestone } = useUpdateMilestones();
  const t = useTranslations("milestones.delete");
  const tCommon = useTranslations("common");
  const handleCancel = () => onOpenChange(false);

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: "An unknown error occurred.",
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {tCommon("errors.unknown")}
                </div>
              )}
              <AlertDialogCancel type="button" onClick={handleCancel}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={isSubmitting}
                className="bg-destructive"
              >
                {isSubmitting
                  ? tCommon("actions.deleting")
                  : tCommon("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
