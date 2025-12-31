"use client";
import { useState } from "react";
import { useUpdateWorkflows } from "~/lib/hooks";
import { Workflows } from "@prisma/client";
import { useTranslations } from "next-intl";

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
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

interface DeleteWorkflowsModalProps {
  workflows: Workflows;
}

export function DeleteWorkflowsModal({
  workflows: workflows,
}: DeleteWorkflowsModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateWorkflows } = useUpdateWorkflows();

  const t = useTranslations("admin.workflows");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();

  const handleCancel = () => {
    setOpen(false);
    reset();
  };

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
    reset,
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateWorkflows({
        data: { isDeleted: true },
        where: { id: workflows.id },
      });
      setOpen(false);
      reset();
    } catch (err: any) {
      setError("root", {
        type: "custom",
        message: tGlobal("common.errors.unknown"),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          reset();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="px-2 py-1 h-auto">
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
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
                    <span className="whitespace-nowrap font-bold">
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
                onClick={handleCancel}
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
