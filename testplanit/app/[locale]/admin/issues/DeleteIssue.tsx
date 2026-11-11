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
      <AlertDialogContent className="border-destructive sm:max-w-[425px] lg:max-w-[400px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="me-2 h-6 w-6" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmMessage", {
                  name: issue.name,
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
              <AlertDialogCancel type="button" onClick={onClose}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
