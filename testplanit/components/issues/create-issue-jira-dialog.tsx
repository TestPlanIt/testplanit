"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CreateIssueJiraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  integrationId: number;
  jiraUrl: string;
  projectKey: string;
  issueTypeId?: string;
  onIssueCreated?: (issue: any) => void;
  defaultValues?: {
    title?: string;
    description?: string;
  };
}

export function CreateIssueJiraDialog({
  open,
  onOpenChange,
  projectId,
  integrationId,
  jiraUrl,
  projectKey,
  issueTypeId,
  onIssueCreated,
  defaultValues,
}: CreateIssueJiraDialogProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);

  // Build the Jira create issue URL
  const buildJiraCreateUrl = () => {
    const baseUrl = jiraUrl.replace(/\/$/, "");

    // Try multiple URL patterns for different Jira configurations
    const patterns = [
      // Modern Jira Cloud
      `${baseUrl}/secure/CreateIssue.jspa`,
      // Legacy Jira
      `${baseUrl}/secure/CreateIssue!default.jspa`,
      // Alternative pattern
      `${baseUrl}/secure/CreateIssueDetails!init.jspa`,
    ];

    // Use the first pattern for now, but we can make this smarter later
    const url = patterns[0];

    const params = new URLSearchParams();

    // For Jira Cloud, try using project key as pid
    if (projectKey) {
      params.append("pid", projectKey);
    }

    // Add issue type if provided
    if (issueTypeId) {
      params.append("issuetype", issueTypeId);
    }

    // Pre-fill summary if provided
    if (defaultValues?.title) {
      params.append("summary", defaultValues.title);
    }

    // Pre-fill description if provided
    if (defaultValues?.description) {
      params.append("description", defaultValues.description);
    }

    const queryString = params.toString();
    const finalUrl = queryString ? `${url}?${queryString}` : url;

    // console.log("Jira create URL debug:", {
    //   baseUrl: jiraUrl,
    //   projectKey,
    //   issueTypeId,
    //   finalUrl,
    // });

    return finalUrl;
  };

  const handleOpenInNewTab = () => {
    window.open(buildJiraCreateUrl(), "_blank");
    onOpenChange(false);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleIframeError = () => {
    setError(t("issues.jiraIframeError"));
    setIsLoading(false);
  };

  // Reset loading state when dialog opens
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setError(null);
    }
  }, [open]);

  // Listen for postMessage from Jira (if they implement it)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security check - ensure message is from Jira domain
      if (!event.origin.includes(jiraUrl)) return;

      // Handle issue created message if Jira sends one
      if (event.data?.type === "issue-created" && event.data?.issue) {
        onIssueCreated?.(event.data.issue);
        onOpenChange(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [jiraUrl, onIssueCreated, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("issues.createIssueInJira")}</DialogTitle>
          <DialogDescription>
            {t("issues.createIssueInJiraFallbackDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              {t("issues.jiraIframeFallback")}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2">
            <Button onClick={handleOpenInNewTab} className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("issues.createIssueInJira")}
            </Button>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {t("issues.jiraFallbackNote")}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
