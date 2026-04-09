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
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useDeleteLlmIntegration } from "~/lib/hooks/llm-integration";
import { useDeleteLlmProviderConfig } from "~/lib/hooks/llm-provider-config";

interface DeleteLlmIntegrationProps {
  integration: any;
  open: boolean;
  onClose: () => void;
}

export function DeleteLlmIntegration({
  integration,
  open,
  onClose,
}: DeleteLlmIntegrationProps) {
  const t = useTranslations("admin.llm.delete");
  const tGlobal = useTranslations();
  const [loading, setLoading] = useState(false);

  const { mutateAsync: deleteLlmIntegration } = useDeleteLlmIntegration();
  const { mutateAsync: deleteLlmProviderConfig } = useDeleteLlmProviderConfig();

  const handleDelete = async () => {
    setLoading(true);

    try {
      // Delete the LLM provider config first if it exists
      if (integration.llmProviderConfig) {
        await deleteLlmProviderConfig({
          where: { id: integration.llmProviderConfig.id },
        });
      }

      // Delete the LLM integration
      await deleteLlmIntegration({
        where: { id: integration.id },
      });

      toast.success(tGlobal("common.fields.success"), {
        description: t("integrationDeletedSuccess"),
      });

      onClose();
      // ZenStack will automatically invalidate hooks - no manual refresh needed
    } catch (error: any) {
      console.error("Error deleting integration:", error);
      toast.error(tGlobal("common.errors.error"), {
        description: error.message || t("failedToDeleteIntegration"),
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
            {tGlobal("admin.llm.delete.description", {
              name: integration?.name,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {tGlobal("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tGlobal("common.actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
