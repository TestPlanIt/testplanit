"use client";
import { useState } from "react";
import {
  useUpdateConfigVariants,
  useUpdateManyConfigurations,
} from "~/lib/hooks";
import { Variant } from "./Categories";

import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Trash, TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

interface DeleteVariantModalProps {
  variant: Variant;
  onClose: () => void;
  onDelete: (variantId: number) => void;
}

export function DeleteVariantModal({
  variant,
  onClose,
  onDelete,
}: DeleteVariantModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfigVariants } = useUpdateConfigVariants();
  const { mutateAsync: updateManyConfigurations } =
    useUpdateManyConfigurations();
  const t = useTranslations("admin.configurations.variants.delete");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const handleCancel = () => {
    setOpen(false);
    onClose();
  };

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateManyConfigurations({
        where: {
          variants: {
            some: {
              variantId: variant.id,
            },
          },
        },
        data: { isDeleted: true },
      });
      await updateConfigVariants({
        where: { id: variant.id },
        data: { isDeleted: true },
      });

      setIsSubmitting(false);
      onDelete(variant.id!);
      setOpen(false);
    } catch (err: any) {
      console.error(
        `Failed during deletion process for variant ID: ${variant.id}`,
        err
      );
      form.setError("root", {
        type: "custom",
        message: tGlobal("milestones.errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="link" className="p-0 ml-2">
          <Trash className="h-4 w-4" />
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
            <AlertDialogDescription>
              <div>
                {t.rich("message", {
                  name: variant.name,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </div>
            </AlertDialogDescription>
            <div className="bg-destructive text-destructive-foreground p-2">
              {tGlobal("runs.delete.warning")}
            </div>
            <div>{t("suggestion")}</div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {tGlobal("milestones.errors.unknown")}
                </div>
              )}
              <AlertDialogCancel type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </AlertDialogCancel>
              <Button
                type="submit"
                disabled={isSubmitting}
                variant="destructive"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("status.deleting")
                  : tCommon("actions.delete")}
              </Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
