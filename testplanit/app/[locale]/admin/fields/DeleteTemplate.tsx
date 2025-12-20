"use client";
import { useState } from "react";
import {
  useUpdateTemplates,
  useFindFirstTemplates,
  useUpdateManyRepositoryCases,
  useUpdateManySessions,
} from "~/lib/hooks";
import { Templates } from "@prisma/client";

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

import { useTranslations } from "next-intl";

interface DeleteTemplateModalProps {
  template: Templates;
}

export function DeleteTemplateModal({ template }: DeleteTemplateModalProps) {
  const t = useTranslations("admin.templates.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateTemplate } = useUpdateTemplates();
  const { mutateAsync: updateManyTestCases } = useUpdateManyRepositoryCases();
  const { mutateAsync: updateManySessions } = useUpdateManySessions();

  const { data: defaultTemplate } = useFindFirstTemplates({
    where: {
      AND: [{ isDefault: true }, { isEnabled: true }, { isDeleted: false }],
    },
  });

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
    if (!defaultTemplate) {
      setError("root", {
        type: "custom",
        message: t("errors.defaultTemplateNotFound"),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Reassign all test cases using this template to the default template
      await updateManyTestCases({
        where: { templateId: template.id },
        data: { templateId: defaultTemplate.id },
      });

      // Reassign all exploratory sessions using this template to the default template
      await updateManySessions({
        where: { templateId: template.id },
        data: { templateId: defaultTemplate.id },
      });

      // Soft delete the template
      await updateTemplate({
        where: { id: template.id },
        data: { isDeleted: true },
      });

      setOpen(false);
      reset();
    } catch (err: any) {
      setError("root", {
        type: "custom",
        message: t("errors.unknown"),
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
        <Button variant="secondary" className="text-destructive">
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
                  name: template.templateName,
                  strong: (chunks: any) => (
                    <span className="font-bold">{chunks}</span>
                  ),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-200 p-3 rounded border border-yellow-300 dark:border-yellow-700">
              <p className="font-semibold mb-1">{t("warning")}</p>
              <p className="text-sm">{tGlobal("runs.delete.warning")}</p>
            </div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className=" bg-destructive text-destructive-foreground text-sm p-2"
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
                {tCommon("actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={onSubmit}
                disabled={isSubmitting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("status.deleting")
                  : tCommon("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
