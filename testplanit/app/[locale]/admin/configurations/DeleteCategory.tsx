"use client";

import { Form } from "@/components/ui/form";
import type { ConfigCategories } from "~/zenstack/models";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useFindManyConfigurations,
  useFindManyConfigVariants,
  useUpdateConfigCategories,
  useUpdateManyConfigurations,
  useUpdateManyConfigVariants,
} from "~/lib/hooks";

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

interface DeleteConfigCategoryProps {
  category: ConfigCategories;
  open: boolean;
  onClose: () => void;
}

export function DeleteConfigCategory({
  category,
  open,
  onClose,
}: DeleteConfigCategoryProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfigCategories } = useUpdateConfigCategories();
  const { mutateAsync: updateManyConfigurations } =
    useUpdateManyConfigurations();
  const { mutateAsync: updateManyConfigVariants } =
    useUpdateManyConfigVariants();

  const t = useTranslations("admin.configurations.categories.delete");
  const tCommon = useTranslations("common");

  const form = useForm();
  const {
    formState: { errors },
    setError,
    handleSubmit,
  } = form;

  const { data: variants } = useFindManyConfigVariants({
    where: {
      AND: [
        {
          categoryId: category.id,
        },
        { isDeleted: false },
      ],
    },
  });

  const { data: configurations } = useFindManyConfigurations({
    include: { variants: true },
    where: {
      AND: [
        {
          variants: {
            some: {
              variantId: {
                in: variants?.map((v) => v.id),
              },
            },
          },
          isDeleted: false,
        },
      ],
    },
  });

  async function onSubmit() {
    setIsSubmitting(true);
    try {
      await updateManyConfigurations({
        where: {
          id: {
            in: configurations?.map((config) => config.id),
          },
        },
        data: { isDeleted: true },
      });

      await updateManyConfigVariants({
        where: { categoryId: category.id },
        data: { isDeleted: true },
      });

      await updateConfigCategories({
        where: { id: category.id },
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
                {t("deleteCategory")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t.rich("deleteCategoryConfirm", {
                  name: category.name,
                  strong: (chunks: any) => (
                    <span className="font-bold break-all">{chunks}</span>
                  ),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive text-destructive-foreground p-2">
              {t("deleteCategoryWarning")}
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
