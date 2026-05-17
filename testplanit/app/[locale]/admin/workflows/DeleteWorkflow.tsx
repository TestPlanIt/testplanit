"use client";
import { Workflows } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useUpdateWorkflows } from "~/lib/hooks";

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

interface DeleteWorkflowsProps {
  workflows: Workflows;
  open: boolean;
  onClose: () => void;
}

export function DeleteWorkflows({
  workflows: workflows,
  open,
  onClose,
}: DeleteWorkflowsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateWorkflows } = useUpdateWorkflows();

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateWorkflows({
        data: { isDeleted: true },
        where: { id: workflows.id },
      });
      onClose();
    } catch {
      setError("root", {
        type: "custom",
        message: tGlobal("common.errors.unknown"),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("delete.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("delete.confirmMessage", {
                  name: workflows.name,
                  strong: (chunks) => (
                    <span className="font-bold [overflow-wrap:anywhere]">
                      {chunks}
                    </span>
                  ),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div>{tGlobal("runs.delete.warning")}</div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className=" bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {tGlobal("common.errors.unknown")}
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
                onClick={onSubmit}
                disabled={isSubmitting}
                className="bg-destructive hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("actions.deleting")
                  : tCommon("actions.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
