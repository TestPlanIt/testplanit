"use client";
import { CaseFields } from "@prisma/client";
import { useState } from "react";
import {
  useFindFirstCaseFields,
  useUpdateCaseFields,
  useUpdateManyFieldOptions,
} from "~/lib/hooks";

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

interface DeleteCaseFieldProps {
  casefield: CaseFields;
  open: boolean;
  onClose: () => void;
}

export function DeleteCaseField({
  casefield,
  open,
  onClose,
}: DeleteCaseFieldProps) {
  const t = useTranslations("admin.templates.caseFields.delete");
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateCaseFields } = useUpdateCaseFields();
  const { mutateAsync: updateManyFieldOptions } = useUpdateManyFieldOptions();

  const { data: defaultCaseField } = useFindFirstCaseFields({
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
    if (!defaultCaseField) {
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
          AND: [{ caseFields: { none: {} } }, { resultFields: { none: {} } }],
        },
      });

      await updateCaseFields({
        data: { isDeleted: true },
        where: { id: casefield.id },
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
                  name: casefield.displayName,
                  strong: (chunks: any) => (
                    <span className="font-bold">{chunks}</span>
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
