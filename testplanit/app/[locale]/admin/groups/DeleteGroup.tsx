"use client";
import { useState } from "react";
import { useUpdateGroups } from "~/lib/hooks";
import { Groups } from "@prisma/client";
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
} from "@/components/ui/alert-dialog";

interface DeleteGroupModalProps {
  group: Groups;
}

export function DeleteGroupModal({ group }: DeleteGroupModalProps) {
  const t = useTranslations("admin.groups.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateGroup } = useUpdateGroups();

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateGroup({ where: { id: group.id }, data: { isDeleted: true } });
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: tGlobal("common.errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="px-2 py-1 h-auto">
          <Trash2 className="h-5 w-5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("deleteGroup")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div>{t("deleteGroupDescription")}</div>
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
              <AlertDialogCancel disabled={isSubmitting}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isSubmitting}
                onClick={onSubmit}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("actions.submitting")
                  : tCommon("actions.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
