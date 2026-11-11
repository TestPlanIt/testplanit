"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Groups } from "~/zenstack/models";
import { useTranslations } from "next-intl";
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

interface DeleteGroupProps {
  group: Groups;
  open: boolean;
  onClose: () => void;
}

export function DeleteGroup({ group, open, onClose }: DeleteGroupProps) {
  const t = useTranslations("admin.groups.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateGroup } =
    useClientQueries(schema).groups.useUpdate();

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateGroup({ where: { id: group.id }, data: { isDeleted: true } });
      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tGlobal("common.errors.unknown"),
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
                {t("deleteGroup")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteGroupDescription")}
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
