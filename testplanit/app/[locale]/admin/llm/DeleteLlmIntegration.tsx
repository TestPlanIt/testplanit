"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { useDeleteLlmIntegration } from "~/lib/hooks/llm-integration";
import { useDeleteLlmProviderConfig } from "~/lib/hooks/llm-provider-config";

interface DeleteLlmIntegrationProps {
  integration: any;
}

export function DeleteLlmIntegration({ integration }: DeleteLlmIntegrationProps) {
  const t = useTranslations("admin.llm.delete");
  const [open, setOpen] = useState(false);
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

      toast.success(t("success"), {
        description: t("integrationDeletedSuccess"),
      });

      setOpen(false);
      // ZenStack will automatically invalidate hooks - no manual refresh needed
    } catch (error: any) {
      console.error("Error deleting integration:", error);
      toast.error(t("error"), {
        description: error.message || t("failedToDeleteIntegration"),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmMessage", { name: integration?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOpen(false)}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}