"use client";
import { useState } from "react";
import { useUpdateIssue } from "~/lib/hooks";
import { Issue } from "@prisma/client";

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
} from "@/components/ui/alert-dialog";

import { useTranslations } from "next-intl";

interface DeleteIssueModalProps {
  issue: Issue;
}

export function DeleteIssueModal({ issue }: DeleteIssueModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateIssue } = useUpdateIssue();

  const handleCancel = () => setOpen(false);

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
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" className="text-destructive">
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div>
              {t("confirmMessage", {
                name: issue.name,
              })}
            </div>
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
              <AlertDialogCancel type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={form.handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="bg-destructive"
              >
                {isSubmitting
                  ? tCommon("status.deleting")
                  : tCommon("actions.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
