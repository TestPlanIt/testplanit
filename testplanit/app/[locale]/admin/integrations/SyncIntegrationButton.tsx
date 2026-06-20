"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Integration } from "~/zenstack/models";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface SyncIntegrationButtonProps {
  integration: Integration;
}

export function SyncIntegrationButton({
  integration,
}: SyncIntegrationButtonProps) {
  const t = useTranslations("admin.integrations");
  const [isSyncing, setIsSyncing] = useState(false);

  // SIMPLE_URL integrations have no API to pull from, so sync is not supported.
  if (integration.provider === "SIMPLE_URL") {
    return (
      <Button variant="ghost" disabled className="px-2 py-1 h-auto">
        <RefreshCw className="h-4 w-4" />
        <span className="sr-only">{t("syncIntegration")}</span>
      </Button>
    );
  }

  const handleSync = async () => {
    setIsSyncing(true);

    try {
      const toastId = toast.loading(t("syncInProgress"));

      const response = await fetch(
        `/api/admin/integrations/${integration.id}/sync`,
        {
          method: "POST",
        }
      );

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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          onClick={handleSync}
          disabled={isSyncing}
          className="px-2 py-1 h-auto"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          <span className="sr-only">{t("syncIntegration")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t("syncIntegration")}</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {t("syncIntegrationHint")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
