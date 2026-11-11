"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { MilestoneTypes } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useForm } from "react-hook-form";

import { TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

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

interface DeleteMilestoneTypeProps {
  milestoneType: MilestoneTypes;
  open: boolean;
  onClose: () => void;
}

export function DeleteMilestoneType({
  milestoneType,
  open,
  onClose,
}: DeleteMilestoneTypeProps) {
  const t = useTranslations("admin.milestones.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateMilestoneType } =
    useClientQueries(schema).milestoneTypes.useUpdate();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useClientQueries(schema).milestoneTypesAssignment.useDeleteMany();
  const { mutateAsync: updateManyMilestones } =
    useClientQueries(schema).milestones.useUpdateMany();

  const { data: defaultMilestoneType } = useClientQueries(
    schema
  ).milestoneTypes.useFindFirst({
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
      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="border-destructive sm:max-w-[425px] lg:max-w-[400px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="me-2 h-6 w-6" />
                {tCommon("dialogs.delete.title", {
                  item: tCommon("fields.milestoneTypes"),
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmMessage", {
                  name: milestoneType.name,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive p-2 text-destructive-foreground">
              {tGlobal("runs.delete.warning")}
            </div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive p-2 text-sm text-destructive-foreground"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <AlertDialogCancel
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
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
