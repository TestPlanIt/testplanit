"use client";
import type { Roles } from "~/zenstack/models";
import { useState } from "react";
import {
  useFindFirstRoles,
  useUpdateManyUser,
  useUpdateRoles,
} from "~/lib/hooks";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { TriangleAlert } from "lucide-react";

import { Form } from "@/components/ui/form";

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

interface DeleteRoleProps {
  role: Roles;
  open: boolean;
  onClose: () => void;
}

export function DeleteRole({ role, open, onClose }: DeleteRoleProps) {
  const t = useTranslations("admin.roles.delete");
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateRole } = useUpdateRoles();
  const { mutateAsync: updateManyUser } = useUpdateManyUser();

  const { data: defaultRole } = useFindFirstRoles({
    where: { isDefault: true, isDeleted: false },
  });

  const form = useForm();
  const {
    formState: { errors },
  } = form;

  async function onSubmit() {
    if (!defaultRole) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.defaultNotFound"),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await updateManyUser({
        where: { roleId: role.id },
        data: { roleId: defaultRole.id },
      });

      await updateRole({
        data: { isDeleted: true },
        where: { id: role.id },
      });
      onClose();
      setIsSubmitting(false);
    } catch {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                <TriangleAlert className="w-6 h-6 mr-2" />
                {t("title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("confirmMessage", {
                  name: role.name,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-destructive text-destructive-foreground p-2">
              {t("warning")}
            </div>
            <AlertDialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <AlertDialogCancel disabled={isSubmitting}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isSubmitting}
                onClick={onSubmit}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isSubmitting
                  ? tCommon("actions.deleting")
                  : tCommon("actions.confirmDelete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
