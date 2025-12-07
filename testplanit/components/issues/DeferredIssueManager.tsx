"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Bug } from "lucide-react";
import { SearchIssuesDialog } from "./search-issues-dialog";
import {
  useUpsertIssue,
  useFindManyIssue,
  useFindManyProjectIntegration,
} from "~/lib/hooks";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

interface DeferredIssueManagerProps {
  projectId: number;
  selectedIssues: never[]; // Not used anymore, kept for compatibility
  onIssuesChange: (issueIds: number[]) => void; // Back to simple number array
  disabled?: boolean;
  label?: string;
  linkedIssueIds?: number[]; // The actual Issue IDs to display
  maxBadgeWidth?: string; // Tailwind max-width class for issue badges (e.g., "max-w-xs", "max-w-full")
}

/**
 * DeferredIssueManager - Creates Issue records but marks them for cleanup on cancel
 * This provides immediate UI feedback while allowing cancellation without permanent changes.
 */
export function DeferredIssueManager({
  projectId,
  selectedIssues, // Not used anymore
  onIssuesChange,
  disabled = false,
  label,
  linkedIssueIds = [],
  maxBadgeWidth = "max-w-xl",
}: DeferredIssueManagerProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { mutateAsync: upsertIssue } = useUpsertIssue();

  // Utility function to format provider names for display
  const formatProviderName = (provider: string): string => {
    switch (provider?.toLowerCase()) {
      case "jira":
        return "Jira";
      case "github":
        return "GitHub";
      case "gitlab":
        return "GitLab";
      case "azure_devops":
        return "Azure DevOps";
      case "linear":
        return "Linear";
      case "simple_url":
        return ""; // Empty string to avoid "Link Issue Issue"
      default:
        // Capitalize first letter and replace underscores with spaces
        return provider
          ? provider.charAt(0).toUpperCase() +
              provider.slice(1).toLowerCase().replace(/_/g, " ")
          : "";
    }
  };

  // Get the project's active integration to set the correct integrationId
  const { data: projectIntegrations } = useFindManyProjectIntegration({
    where: {
      projectId,
      isActive: true,
    },
    include: {
      integration: true,
    },
  });

  const activeIntegration = projectIntegrations?.[0];

  // Fetch the actual Issue records to display
  const { data: issues, refetch } = useFindManyIssue({
    where: {
      id: { in: linkedIssueIds },
      isDeleted: false,
    },
  });

  const handleRemoveIssue = (issueId: number) => {
    const updatedIds = linkedIssueIds.filter((id) => id !== issueId);
    onIssuesChange(updatedIds);
  };

  const handleAddIssue = async (issue: any) => {
    if (!issue.isExternal || !session?.user?.id) return;

    // console.log("DeferredIssueManager: Creating issue:", {
    //   key: issue.key,
    //   id: issue.id,
    //   title: issue.title,
    //   summary: issue.summary,
    //   projectId,
    //   userId: session.user.id,
    //   integrationId: activeIntegration?.integrationId || activeIntegration?.integration?.id
    // });

    const integrationId =
      activeIntegration?.integrationId || activeIntegration?.integration?.id;

    if (!integrationId) {
      toast.error(t("common.errors.issueManagement.noActiveIntegration"));
      return;
    }

    try {
      // Use upsert to handle cases where the issue already exists
      const newIssue = await upsertIssue({
        where: {
          externalId_integrationId: {
            externalId: String(issue.id),
            integrationId: integrationId,
          },
        },
        create: {
          name: issue.key || String(issue.id),
          title: issue.title || issue.summary || "",
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          externalId: String(issue.id),
          externalKey: issue.key,
          externalUrl: issue.url || issue.externalUrl,
          externalStatus: issue.status,
          externalData: issue,
          projectId,
          createdById: session.user.id,
          integrationId: integrationId,
        },
        update: {
          // Update fields that might have changed
          title: issue.title || issue.summary || "",
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          externalKey: issue.key,
          externalUrl: issue.url || issue.externalUrl,
          externalStatus: issue.status,
          externalData: issue,
        },
      });

      // console.log("DeferredIssueManager: Issue created successfully:", {
      //   id: newIssue?.id,
      //   name: newIssue?.name,
      //   externalKey: newIssue?.externalKey
      // });

      if (newIssue) {
        // Add the new Issue ID to the linked issues
        const updatedIds = [...linkedIssueIds, newIssue.id];
        onIssuesChange(updatedIds);
        refetch(); // Refresh the display
        toast.success(`Issue ${issue.key} linked successfully`);
      }
    } catch (error: any) {
      console.error("DeferredIssueManager: Error upserting issue:", error);
      toast.error(t("common.messages.createError"));
    }
  };

  return (
    <div className="space-y-3">
      {label && (
        <div className="text-sm font-medium text-foreground">{label}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {issues?.map((issue) => (
          <Badge
            key={issue.id}
            className={`hover:bg-accent hover:text-accent-foreground hover:border-primary transition-colors group overflow-hidden ${maxBadgeWidth}`}
          >
            <div className="flex items-center min-w-0">
              <Bug className="w-4 h-4 shrink-0 mr-1" />
              {issue.externalUrl ? (
                <a
                  href={issue.externalUrl}
                  className="min-w-0 truncate hover:text-inherit"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={`${issue.externalKey || issue.name}: ${issue.title}`}
                >
                  {issue.externalKey || issue.name}: {issue.title}
                </a>
              ) : (
                <span
                  className="min-w-0 truncate"
                  title={`${issue.externalKey || issue.name}: ${issue.title}`}
                >
                  {issue.externalKey || issue.name}: {issue.title}
                </span>
              )}
              <button
                type="button"
                title="Remove issue"
                onClick={() => handleRemoveIssue(issue.id)}
                disabled={disabled}
                className="ml-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </Badge>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsSearchOpen(true)}
        disabled={disabled}
      >
        <Plus className="h-4 w-4" />
        {t("issues.linkExternalIssue", {
          provider: formatProviderName(
            activeIntegration?.integration?.provider || "Issue"
          ),
        })}
      </Button>

      <SearchIssuesDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        projectId={projectId}
        linkedIssueIds={linkedIssueIds.map((id) => String(id))}
        onIssueSelected={(issue) => {
          handleAddIssue(issue);
          setIsSearchOpen(false);
        }}
      />
    </div>
  );
}
