"use client";
import { useState, useEffect, useMemo } from "react";
import { useUpdateTags } from "~/lib/hooks";
import { Tags } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { TagsUpdateSchema } from "@zenstackhq/runtime/zod/models";

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

import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

// Create a simpler schema that works with form inference
const EditTagSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type EditTagFormData = z.infer<typeof EditTagSchema>;

interface EditTagModalProps {
  tag: Tags;
}

export function EditTagModal({ tag }: EditTagModalProps) {
  const t = useTranslations("admin.tags.edit");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateTag } = useUpdateTags();

  const handleCancel = () => setOpen(false);

  const defaultFormValues = useMemo(
    () => ({
      name: tag.name,
    }),
    [tag.name]
  );

  const form = useForm<EditTagFormData>({
    resolver: zodResolver(EditTagSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form, form.reset]);

  const {
    watch,
    setValue,
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  async function onSubmit(data: EditTagFormData) {
    setIsSubmitting(true);
    try {
      await updateTag({
        where: { id: tag.id },
        data: {
          name: data.name,
        },
      });
      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
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
                    <HelpPopover helpKey="tag.name" />
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
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
