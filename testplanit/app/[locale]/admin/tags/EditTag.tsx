"use client";
import type { Tags } from "~/zenstack/models";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
} from "@/components/ui/dialog";

import { HelpPopover } from "@/components/ui/help-popover";
import { useTranslations } from "next-intl";

// Create a simpler schema that works with form inference
const EditTagSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type EditTagFormData = z.infer<typeof EditTagSchema>;

interface EditTagProps {
  tag: Tags;
  open: boolean;
  onClose: () => void;
}

export function EditTag({ tag, open, onClose }: EditTagProps) {
  const t = useTranslations("admin.tags.edit");
  const tTags = useTranslations("tags.edit");
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateTag } = useClientQueries(schema).tags.useUpdate();
  // Query all tags (including soft-deleted) for case-insensitive duplicate checking
  const { data: allTags } = useClientQueries(schema).tags.useFindMany({
    select: { id: true, name: true, isDeleted: true },
  });

  const form = useForm<EditTagFormData>({
    resolver: standardSchemaResolver(EditTagSchema),
    defaultValues: {
      name: tag.name,
    },
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: EditTagFormData) {
    setIsSubmitting(true);

    // Check for case-insensitive duplicate (excluding the current tag)
    const nameToCheck = data.name.toLowerCase();
    const conflictingTag = allTags?.find(
      (t) => t.name.toLowerCase() === nameToCheck && t.id !== tag.id
    );

    if (conflictingTag) {
      if (conflictingTag.isDeleted) {
        // Rename the deleted tag to something unique so we can use this name
        try {
          await updateTag({
            where: { id: conflictingTag.id },
            data: { name: `${conflictingTag.name}_deleted_${Date.now()}` },
          });
        } catch {
          form.setError("root", {
            type: "custom",
            message: tCommon("errors.unknown"),
          });
          setIsSubmitting(false);
          return;
        }
      } else {
        // Active tag with this name exists
        form.setError("name", {
          type: "custom",
          message: tTags("errors.nameExists"),
        });
        setIsSubmitting(false);
        return;
      }
    }

    try {
      await updateTag({
        where: { id: tag.id },
        data: {
          name: data.name,
        },
      });
      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tTags("errors.nameExists"),
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
    <Dialog open={open} onOpenChange={onClose}>
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
                    {tCommon("name")}
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
              <Button variant="outline" type="button" onClick={onClose}>
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
