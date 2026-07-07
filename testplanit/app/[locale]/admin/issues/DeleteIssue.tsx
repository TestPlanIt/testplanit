"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";
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

interface DeleteIssueProps {
  issue: Issue;
  open: boolean;
  onClose: () => void;
}

export function DeleteIssue({ issue, open, onClose }: DeleteIssueProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateIssue } =
    useClientQueries(schema).issue.useUpdate();

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  const t = useTranslations("admin.issues.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateIssue({
        where: { id: issue.id },
        data: { isDeleted: true },
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
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 me-2" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmMessage", {
                  name: issue.name,
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
                  {errors.root.message}
                </div>
              )}
              <AlertDialogCancel type="button" onClick={onClose}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="bg-destructive"
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
