"use client";
import { useState } from "react";
import { useUpdateStatus } from "~/lib/hooks";
import { Status } from "@prisma/client";

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

interface DeleteStatusModalProps {
  status: Status;
}

export function DeleteStatusModal({ status }: DeleteStatusModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateStatus } = useUpdateStatus();

  const handleCancel = () => {
    setOpen(false);
    reset();
  };

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
    reset,
  } = form;

  const t = useTranslations("admin.statuses.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateStatus({
        data: { isDeleted: true },
        where: { id: status.id },
      });
      setOpen(false);
      reset();
    } catch (err: any) {
      setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("confirmMessage", {
                  name: status.name,
                  strong: (chunks: any) => <strong>{chunks}</strong>,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div>{tGlobal("runs.delete.warning")}</div>
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
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={onSubmit}
                disabled={isSubmitting}
                className="bg-destructive hover:bg-destructive/90"
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
