"use client";
import type { Configurations } from "~/zenstack/models";
import { useState } from "react";
import { useUpdateConfigurations } from "~/lib/hooks";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { Form } from "@/components/ui/form";
import { TriangleAlert } from "lucide-react";

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

interface DeleteConfigurationProps {
  configuration: Configurations;
  open: boolean;
  onClose: () => void;
}

export function DeleteConfiguration({
  configuration,
  open,
  onClose,
}: DeleteConfigurationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfiguration } = useUpdateConfigurations();
  const t = useTranslations("admin.configurations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateConfiguration({
        where: { id: configuration.id },
        data: { isDeleted: true },
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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("delete.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("delete.message", {
                  strong: (chunks) => (
                    <span className="font-bold break-all">{chunks}</span>
                  ),
                  name: configuration.name,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive text-destructive-foreground p-2">
              {tGlobal("runs.delete.warning")}
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
                  : tCommon("actions.confirmDelete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
