import { User } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import UploadAvatar from "@/components/UploadAvatar";

import { Form } from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FormSchema = z.object({});

interface EditAvatarProps {
  user: User;
  open: boolean;
  onClose: () => void;
}

export function EditAvatar({ user, open, onClose }: EditAvatarProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const { data: session, update: updateSession } = useSession();
  const queryClient = useQueryClient();
  const t = useTranslations("users.avatar");
  const tCommon = useTranslations("common");

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(_data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      // Use dedicated update API endpoint instead of ZenStack
      // (ZenStack 2.21+ has issues with nested update operations)
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(avatarUrl && { image: avatarUrl }),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update avatar");
      }

      onClose();
      setIsSubmitting(false);

      // Update the session to reflect the new avatar
      await updateSession();

      // Refetch all queries to refresh UI with new avatar
      void queryClient.refetchQueries();
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  if (!session) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("changeProfilePicture")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("changeProfilePicture")}
              </DialogDescription>
            </DialogHeader>
            <UploadAvatar onUpload={setAvatarUrl} />
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
