"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDeleteAppConfig } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { Trash2, TriangleAlert } from "lucide-react";
import { useForm } from "react-hook-form";
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
import { AppConfigRow } from "./types";

interface DeleteAppConfigModalProps {
  config: AppConfigRow;
}

export function DeleteAppConfigModal({ config }: DeleteAppConfigModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: deleteAppConfig } = useDeleteAppConfig();
  const t = useTranslations("admin.appConfig");
  const tCommon = useTranslations("common");

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

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await deleteAppConfig({
        where: { key: config.key },
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
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:bg-destructive/10"
          data-testid="delete-config"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="sm:max-w-[425px] lg:max-w-[400px] border-destructive"
        data-testid="delete-confirmation-modal"
      >
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {tCommon("actions.confirmDelete")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {`Are you sure you want to delete the configuration key "${config.key}"? This action cannot be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive text-destructive-foreground p-2">
              {`This will permanently remove this configuration.`}
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
