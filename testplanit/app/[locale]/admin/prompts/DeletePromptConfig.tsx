"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PromptConfig } from "@prisma/client";
import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useUpdateManyProjects } from "~/lib/hooks";
import { useUpdatePromptConfig } from "~/lib/hooks/prompt-config";

interface DeletePromptConfigProps {
  config: PromptConfig;
}

export function DeletePromptConfig({ config }: DeletePromptConfigProps) {
  const t = useTranslations("admin.prompts.delete");
  const tPrompts = useTranslations("admin.prompts");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { mutateAsync: updatePromptConfig } = useUpdatePromptConfig();
  const { mutateAsync: updateManyProjects } = useUpdateManyProjects();

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

      setOpen(false);
    } catch (error: any) {
      console.error("Error deleting prompt config:", error);
      toast.error(tCommon("errors.error"), {
        description: error?.info?.message || error?.message || tCommon("errors.error"),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        size="icon"
        onClick={() => setOpen(true)}
        className="px-2 py-1 h-auto"
        disabled={config.isDefault}
        title={config.isDefault ? tPrompts("cannotDeleteDefault") : undefined}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("confirmMessage", {
                name: config.name,
                strong: (chunks: any) => (
                  <span className="font-bold">{chunks}</span>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-200 p-3 rounded border border-yellow-300 dark:border-yellow-700">
            <p className="text-sm">{t("warning")}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpen(false)}>
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
    </>
  );
}
