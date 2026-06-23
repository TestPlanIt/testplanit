"use client";
import type { ResultFields } from "~/zenstack/models";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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

interface DeleteResultFieldProps {
  resultfield: ResultFields;
  open: boolean;
  onClose: () => void;
}

export function DeleteResultField({
  resultfield,
  open,
  onClose,
}: DeleteResultFieldProps) {
  const t = useTranslations("admin.templates.resultFields.delete");
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateResultField } = useClientQueries(schema).resultFields.useUpdate();
  const { mutateAsync: updateManyFieldOptions } = useClientQueries(schema).fieldOptions.useUpdateMany();

  const { data: defaultResultField } = useClientQueries(schema).resultFields.useFindFirst({
    where: {
      AND: [{ isEnabled: true }, { isDeleted: false }],
    },
  });

  const form = useForm();
  const {
    formState: { errors },
    setError,
  } = form;

  async function onSubmit() {
    if (!defaultResultField) {
      setError("root", {
        type: "custom",
        message: tCommon("errors.defaultNotFound"),
      });
      return;
    }
    setIsSubmitting(true);
    try {
      // Clean up any orphaned Field Options
      await updateManyFieldOptions({
        data: { isDeleted: true },
        where: {
          AND: [{ resultFields: { none: {} } }, { resultFields: { none: {} } }],
        },
      });

      await updateResultField({
        data: { isDeleted: true },
        where: { id: resultfield.id },
      });
      onClose();
    } catch {
      setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("confirmMessage", {
                  name: resultfield.displayName,
                  strong: (chunks: any) => (
                    <span className="font-bold break-all">{chunks}</span>
                  ),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive text-destructive-foreground p-2">
              {t("warning")}
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
