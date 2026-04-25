"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useCreateTags, useFindManyTags, useUpdateTags } from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
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

// Create a simpler schema that works with form inference
const AddTagSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type AddTagFormData = z.infer<typeof AddTagSchema>;

interface AddTagProps {
  open: boolean;
  onClose: () => void;
}

export function AddTag({ open, onClose }: AddTagProps) {
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tTags = useTranslations("tags.add");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createTag } = useCreateTags();
  const { mutateAsync: updateTag } = useUpdateTags();
  // Query all tags (including soft-deleted) for case-insensitive duplicate
  // checking. Track loading state so we can block submit until the data
  // arrives — without this the user can race the query, `allTags` is
  // undefined, the existing-tag check is skipped, and the create call
  // hits a P2002 unique-constraint error instead of triggering the
  // soft-deleted-tag restore path.
  const { data: allTags, isPending: isAllTagsPending } = useFindManyTags({
    select: { id: true, name: true, isDeleted: true },
  });

  const form = useForm<AddTagFormData>({
    resolver: zodResolver(AddTagSchema),
    defaultValues: {
      name: "",
    },
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: AddTagFormData) {
    setIsSubmitting(true);

    // Check for case-insensitive duplicate (including soft-deleted tags)
    const nameToCheck = data.name.toLowerCase();
    const existingTag = allTags?.find(
      (tag) => tag.name.toLowerCase() === nameToCheck
    );

    if (existingTag) {
      if (existingTag.isDeleted) {
        // Restore the soft-deleted tag
        try {
          await updateTag({
            where: { id: existingTag.id },
            data: { isDeleted: false },
          });
          onClose();
          setIsSubmitting(false);
          return;
        } catch {
          form.setError("root", {
            type: "custom",
            message: tCommon("errors.unknown"),
          });
          setIsSubmitting(false);
          return;
        }
      } else {
        // Tag already exists and is active
        form.setError("name", {
          type: "custom",
          message: tTags("errors.nameExists"),
        });
        setIsSubmitting(false);
        return;
      }
    }

    try {
      await createTag({
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
              <DialogTitle>{tGlobal("tags.add.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {tGlobal("tags.add.title")}
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
                    <Input placeholder={tCommon("name")} {...field} />
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
              <Button type="submit" disabled={isSubmitting || isAllTagsPending}>
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
