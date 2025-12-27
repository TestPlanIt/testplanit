"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useUpdateMilestoneTypes,
  useFindFirstMilestoneTypes,
  useDeleteManyMilestoneTypesAssignment,
  useUpdateManyMilestones,
} from "~/lib/hooks";
import { MilestoneTypes } from "@prisma/client";

import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteMilestoneTypeModalProps {
  milestoneType: MilestoneTypes;
}

export function DeleteMilestoneTypeModal({
  milestoneType,
}: DeleteMilestoneTypeModalProps) {
  const t = useTranslations("admin.milestones.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateMilestoneType } = useUpdateMilestoneTypes();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useDeleteManyMilestoneTypesAssignment();
  const { mutateAsync: updateManyMilestones } = useUpdateManyMilestones();

  const { data: defaultMilestoneType } = useFindFirstMilestoneTypes({
    where: {
      AND: [{ isDefault: true }, { isDeleted: false }],
    },
  });

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    if (!defaultMilestoneType) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.defaultNotFound"),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Step 1: Reassign all milestones using this type to the default type
      await updateManyMilestones({
        where: { milestoneTypesId: milestoneType.id },
        data: {
          milestoneTypesId: defaultMilestoneType.id,
        },
      });

      // Step 2: Delete project assignments for this milestone type
      await deleteManyMilestoneTypesAssignment({
        where: { milestoneTypeId: milestoneType.id },
      });

      // Step 3: Soft delete the milestone type
      await updateMilestoneType({
        data: { isDeleted: true },
        where: { id: milestoneType.id },
      });
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" className="text-destructive">
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title", {
                  item: tCommon("fields.milestoneTypes"),
                })}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div>
              {t("confirmMessage", {
                name: milestoneType.name,
              })}
            </div>
            <div className="bg-destructive text-destructive-foreground p-2">
              {tGlobal("runs.delete.warning")}
            </div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <AlertDialogCancel disabled={isSubmitting}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isSubmitting}
                onClick={onSubmit}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("actions.deleting")
                  : tCommon("actions.confirmDelete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
