"use client";
import { useState, useEffect, useMemo } from "react";
import { useUpdateConfigVariants } from "~/lib/hooks";
import { Variant } from "./Categories";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { SquarePen } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { HelpPopover } from "@/components/ui/help-popover";

const FormSchema = (t: any) =>
  z.object({
    name: z.string().min(1, {
      message: t("fields.validation.nameRequired"),
    }),
  });

interface EditVariantModalProps {
  variant: Variant;
  onClose: () => void;
  onSave: (updatedVariant: Variant) => void;
}

export function EditVariantModal({
  variant,
  onClose,
  onSave,
}: EditVariantModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfigVariants } = useUpdateConfigVariants();
  const t = useTranslations("admin.configurations.variants.edit");
  const tCommon = useTranslations("common");

  const handleCancel = () => {
    setOpen(false);
    onClose();
  };

  const defaultFormValues = useMemo(
    () => ({
      name: variant.name,
    }),
    [variant.name]
  );

  const form = useForm<z.infer<ReturnType<typeof FormSchema>>>({
    resolver: zodResolver(FormSchema(tCommon)),
    defaultValues: {
      name: variant.name,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form, form.reset]);

  const {
    handleSubmit,
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<ReturnType<typeof FormSchema>>) {
    setIsSubmitting(true);
    try {
      await updateConfigVariants({
        where: { id: variant.id },
        data: {
          name: data.name,
        },
      });

      setOpen(false);
      setIsSubmitting(false);
      onSave({ ...variant, name: data.name });
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message:
            "Variant name already exists. Please choose a different name.",
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: "An unknown error occurred.",
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" className="p-0">
          <SquarePen className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="configVariant.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.type === "custom" &&
                  errors.root.message === "duplicate"
                    ? tCommon("errors.duplicate")
                    : tCommon("errors.unknown")}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("actions.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("status.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
