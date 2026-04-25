"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useUpdateTags } from "~/lib/hooks";

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
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Restoring a soft-deleted tag is a separate operation from creating a
  // new one — kept on the auto-generated update hook so the React Query
  // cache invalidation (cases-with-tags lists, filter dropdowns, etc.)
  // stays automatic.
  const { mutateAsync: updateTag } = useUpdateTags();

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

    // Atomic detection + create on the server. Replaces the previous
    // `useFindManyTags` pre-load + client-side scan, which (a) doesn't
    // scale past a few thousand tags and (b) raced the submit click —
    // the user could submit before the cache resolved, the existing-tag
    // check skipped, and the create call hit P2002 with no soft-deleted
    // restore offered.
    try {
      const response = await fetch("/api/admin/tags/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.name }),
      });

      if (response.status === 409) {
        const errBody = await response.json().catch(() => ({}));
        if (errBody?.code === "RESTORE_REQUIRED") {
          // Restore the soft-deleted tag (server returned its id).
          try {
            await updateTag({
              where: { id: errBody.tagId },
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
        }
        if (errBody?.code === "EXISTS_ACTIVE") {
          form.setError("name", {
            type: "custom",
            message: tTags("errors.nameExists"),
          });
          setIsSubmitting(false);
          return;
        }
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
        setIsSubmitting(false);
        return;
      }

      if (!response.ok) {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
        setIsSubmitting(false);
        return;
      }

      // 201 — refresh the tags list so the new tag appears immediately.
      void queryClient.refetchQueries();
      onClose();
      setIsSubmitting(false);
    } catch (err) {
      console.error("[AddTag] submit error:", err);
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
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
