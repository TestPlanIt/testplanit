"use client";

import {
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PromptConfig } from "~/zenstack/models";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface DeletePromptConfigProps {
  config: PromptConfig;
  open: boolean;
  onClose: () => void;
}

export function DeletePromptConfig({
  config,
  open,
  onClose,
}: DeletePromptConfigProps) {
  const t = useTranslations("admin.prompts.delete");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);

  const { mutateAsync: updatePromptConfig } = useClientQueries(schema).promptConfig.useUpdate();
  const { mutateAsync: updateManyProjects } = useClientQueries(schema).projects.useUpdateMany();

  const handleDelete = async () => {
    setLoading(true);

    try {
      // Unassign any projects using this config (set to null = use system default)
      await updateManyProjects({
        where: { promptConfigId: config.id },
        data: { promptConfigId: null },
      });

      // Soft delete the prompt config
      await updatePromptConfig({
        where: { id: config.id },
        data: { isDeleted: true },
      });

      toast.success(tCommon("fields.success"));

      onClose();
    } catch (error: any) {
      console.error("Error deleting prompt config:", error);
      toast.error(tCommon("errors.error"), {
        description:
          error?.info?.message || error?.message || tCommon("errors.error"),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent className="border-destructive">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich("confirmMessage", {
              name: config.name,
              strong: (chunks: any) => (
                <span className="font-bold break-all">{chunks}</span>
              ),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-200 p-3 rounded border border-yellow-300 dark:border-yellow-700">
          <p className="text-sm">{t("warning")}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tCommon("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
