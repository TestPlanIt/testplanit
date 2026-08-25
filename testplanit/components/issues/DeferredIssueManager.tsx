"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bug, Plus, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SearchIssuesDialog } from "./search-issues-dialog";

interface DeferredIssueManagerProps {
  projectId: number;
  selectedIssues: never[]; // Not used anymore, kept for compatibility
  onIssuesChange: (issueIds: number[]) => void; // Back to simple number array
  disabled?: boolean;
  label?: string;
  linkedIssueIds?: number[]; // The actual Issue IDs to display
  maxBadgeWidth?: string; // Tailwind max-width class for issue badges (e.g., "max-w-xs", "max-w-full")
  /**
   * INT-05: when set, the underlying SearchIssuesDialog prefills the
   * Create New Issue form with title + description from the iteration
   * body builder. Threaded through unchanged.
   */
  iterationContext?: {
    iterationId: number;
    testRunId: number;
    testRunCaseId: number;
  };
}

/**
 * DeferredIssueManager - Links Issue records to an entity that doesn't have
 * an id yet (an unsaved test case, run, session, etc.). An externally picked
 * issue is upserted into a real Issue shell immediately; an internal pick is
 * simply tracked, since it already refers to an existing Issue row. Either
 * way, an Issue shell created here survives even if the surrounding form is
 * later cancelled -- nothing in this component removes it.
 */
export function DeferredIssueManager({
  projectId,
  selectedIssues: _selectedIssues, // Not used anymore
  onIssuesChange,
  disabled = false,
  label,
  linkedIssueIds = [],
  maxBadgeWidth = "max-w-xl",
  iterationContext,
}: DeferredIssueManagerProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { mutateAsync: upsertIssue } =
    useClientQueries(schema).issue.useUpsert();

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
      case "mantisbt":
        return "MantisBT";
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
  const { data: projectIntegrations } = useClientQueries(
    schema
  ).projectIntegration.useFindMany({
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
  const { data: issues, refetch } = useClientQueries(schema).issue.useFindMany({
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
    // Internal pick: `issue.id` is already a real Issue primary key (not a
    // tracker key), so there's nothing to upsert -- just register it in the
    // tracked array. Skip silently on a repeat pick rather than duplicating
    // the id or re-toasting.
    if (!issue.isExternal) {
      if (linkedIssueIds.includes(issue.id)) {
        return;
      }
      const updatedIds = [...linkedIssueIds, issue.id];
      onIssuesChange(updatedIds);
      void refetch(); // Refresh the display
      toast.success(
        `Issue ${issue.externalKey || issue.name} linked successfully`
      );
      return;
    }

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
        void refetch(); // Refresh the display
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
              <Bug className="w-4 h-4 shrink-0 me-1" />
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
                title={t("common.aria.removeIssue")}
                onClick={() => handleRemoveIssue(issue.id)}
                disabled={disabled}
                className="ms-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
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
        iterationContext={iterationContext}
        onIssueSelected={(issue) => {
          void handleAddIssue(issue);
          setIsSearchOpen(false);
        }}
      />
    </div>
  );
}
