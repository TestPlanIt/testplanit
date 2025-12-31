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
import { useToast } from "@/components/ui/use-toast";
import { ExtendedIssue } from "./columns";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "~/lib/navigation";

interface SyncIssueProps {
  issue: ExtendedIssue;
}

export function SyncIssue({ issue }: SyncIssueProps) {
  const t = useTranslations("admin.issues");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);

  // Only show sync button for issues with external integration
  if (!issue.integrationId || !issue.externalId) {
    return null;
  }

  const handleSync = async () => {
    setIsSyncing(true);

    try {
      const response = await fetch(`/api/issues/${issue.id}/sync`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync issue");
      }

      // Invalidate all queries and refresh the router cache
      // This ensures the table updates with the latest data from the database
      await queryClient.invalidateQueries();
      router.refresh();

      // Wait a brief moment for the queries to refetch
      await new Promise(resolve => setTimeout(resolve, 100));

      // Show success message after data is refreshed
      toast({
        title: t("syncSuccess"),
        description: t("syncSuccessDescription", { name: issue.name }),
      });
    } catch (error: any) {
      console.error("Error syncing issue:", error);
      toast({
        title: t("syncError"),
        description: error.message || t("syncErrorDescription"),
        variant: "destructive",
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
            className="px-2 py-1 h-auto"
          >
            <RefreshCw
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span className="sr-only">{t("syncIssue")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("syncIssue")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
