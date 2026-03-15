"use client";

import { CaseExportTemplate } from "@prisma/client";
import { useState } from "react";
import { useUpdateCaseExportTemplate } from "~/lib/hooks";

import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";

import { useTranslations } from "next-intl";

interface DeleteQuickScriptTemplateModalProps {
  template: CaseExportTemplate;
}

export function DeleteQuickScriptTemplateModal({
  template,
}: DeleteQuickScriptTemplateModalProps) {
  const t = useTranslations("admin.exportTemplates.delete");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateTemplate } = useUpdateCaseExportTemplate();

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
    reset,
  } = form;

  const handleCancel = () => {
    setOpen(false);
    reset();
  };

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateTemplate({
        where: { id: template.id },
        data: { isDeleted: true },
      });

      setOpen(false);
      reset();
    } catch (err: any) {
      setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
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
        <Button
          variant="destructive"
          className="px-2 py-1 h-auto"
          data-testid="delete-export-template-button"
        >
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("confirmMessage", {
                  name: template.name,
                  strong: (chunks: any) => (
                    <span className="font-bold">{chunks}</span>
                  ),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
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
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
