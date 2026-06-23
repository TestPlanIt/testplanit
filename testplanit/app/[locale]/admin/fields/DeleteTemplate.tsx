"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Templates } from "~/zenstack/models";
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

import { useTranslations } from "next-intl";

interface DeleteTemplateProps {
  template: Templates;
  open: boolean;
  onClose: () => void;
}

export function DeleteTemplate({
  template,
  open,
  onClose,
}: DeleteTemplateProps) {
  const t = useTranslations("admin.templates.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateTemplate } = useClientQueries(schema).templates.useUpdate();
  const { mutateAsync: updateManyTestCases } = useClientQueries(schema).repositoryCases.useUpdateMany();
  const { mutateAsync: updateManySessions } = useClientQueries(schema).sessions.useUpdateMany();

  const { data: defaultTemplate } = useClientQueries(schema).templates.useFindFirst({
    where: {
      AND: [{ isDefault: true }, { isEnabled: true }, { isDeleted: false }],
    },
  });

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
  } = form;

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

      onClose();
    } catch {
      setError("root", {
        type: "custom",
        message: t("errors.unknown"),
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
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("confirmMessage", {
                  name: template.templateName,
                  strong: (chunks: any) => (
                    <span className="font-bold break-all">{chunks}</span>
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
                onClick={onClose}
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
