"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Integration } from "@prisma/client";

interface SyncIntegrationButtonProps {
  integration: Integration;
}

export function SyncIntegrationButton({ integration }: SyncIntegrationButtonProps) {
  const t = useTranslations("admin.integrations");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);

    try {
      const toastId = toast.loading(t("syncInProgress"));

      const response = await fetch(`/api/admin/integrations/${integration.id}/sync`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync integration");
      }

      // Show success message immediately - sync happens in background
      toast.success(t("syncSuccess"), {
        id: toastId,
        description: t("syncSuccessDescription", { name: integration.name }),
      });
    } catch (error: any) {
      console.error("Error syncing integration:", error);
      toast.error(t("syncError"), {
        description: error.message || t("syncErrorDescription"),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={isSyncing}
            className="h-8 w-8 p-0"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span className="sr-only">{t("syncIntegration")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("syncIntegration")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
