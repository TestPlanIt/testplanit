"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useUpdateConfigCategories,
  useUpdateManyConfigVariants,
  useUpdateManyConfigurations,
  useFindManyConfigVariants,
  useFindManyConfigurations,
} from "~/lib/hooks";
import { ConfigCategories } from "@prisma/client";
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

interface DeleteConfigurationModalProps {
  category: ConfigCategories;
}

export function DeleteConfigCategoriesModal({
  category,
}: DeleteConfigurationModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfigCategories } = useUpdateConfigCategories();
  const { mutateAsync: updateManyConfigurations } =
    useUpdateManyConfigurations();
  const { mutateAsync: updateManyConfigVariants } =
    useUpdateManyConfigVariants();

  const t = useTranslations("admin.configurations.categories.delete");
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
                    <span className="whitespace-nowrap font-bold">
                      {chunks}
                    </span>
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
