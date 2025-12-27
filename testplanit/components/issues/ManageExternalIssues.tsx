"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Loader2, ExternalLink, Bug } from "lucide-react";
import { toast } from "sonner";
import { SearchIssuesDialog } from "./search-issues-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "~/lib/navigation";

// Utility function to format provider names for display
const formatProviderName = (provider: string): string => {
  switch (provider.toLowerCase()) {
    case 'jira':
      return 'Jira';
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'azure_devops':
      return 'Azure DevOps';
    case 'linear':
      return 'Linear';
    case 'simple_url':
      return ''; // Empty string to avoid "Link Issue Issue"
    default:
      // Capitalize first letter and replace underscores with spaces
      return provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase().replace(/_/g, ' ');
  }
};

interface ExternalIssue {
  id: number;
  key: string;
  summary: string;
  status?: string;
  url?: string;
  externalId?: string;
}

interface JiraIssueDetails {
  key: string;
  summary: string;
  description: string;
  status: {
    name: string;
    color?: string;
  };
  priority?: {
    name: string;
    iconUrl?: string;
  };
  assignee?: {
    displayName: string;
    avatarUrl?: string;
  } | null;
  reporter?: {
    displayName: string;
    avatarUrl?: string;
  };
  issueType: {
    name: string;
    iconUrl?: string;
  };
  created: string;
  updated: string;
}

interface ManageExternalIssuesProps {
  testCaseId: number;
  projectId: number;
  projectIntegrationId: number;
  integrationId: number;
  provider: string;
  linkedIssueIds?: number[];
  setLinkedIssueIds?: (issueIds: number[]) => void;
  entityType?: 'testCase' | 'testRun' | 'session' | 'testRunResult' | 'testRunStepResult' | 'sessionResult';
}

// Component for individual linked issue with hover functionality
function LinkedIssueBadge({
  issue,
  provider,
  integrationId,
  onUnlink,
}: {
  issue: ExternalIssue;
  provider: string;
  integrationId: number;
  onUnlink: (issueId: number) => void;
}) {
  const t = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const [jiraDetails, setJiraDetails] = useState<JiraIssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // Fetch Jira issue details when popover opens
  useEffect(() => {
    if (isOpen && provider === "JIRA" && integrationId && !jiraDetails) {
      setIsLoading(true);
      setError(null);

      fetch(
        `/api/integrations/jira/issue-details?issueKey=${encodeURIComponent(issue.key)}&integrationId=${integrationId}`
      )
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("Failed to fetch issue details");
          }
          return res.json();
        })
        .then((data) => {
          setJiraDetails(data);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setIsLoading(false);
        });
    }
  }, [isOpen, provider, integrationId, issue.key, jiraDetails]);

  const displayText =
    issue.summary && issue.summary !== issue.key
      ? `${issue.key}: ${issue.summary}`
      : issue.key;

  const badgeContent = (
    <Badge className="hover:bg-accent hover:text-accent-foreground hover:border-primary transition-colors group w-full max-w-full inline-flex">
      <div className="flex items-center gap-2 min-w-0 w-full">
        <Bug className="w-4 h-4 shrink-0" />
        <div className="min-w-0 flex-1 overflow-hidden">
          {issue.url ? (
            <a
              href={issue.url}
              className="truncate block hover:text-inherit"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={displayText}
            >
              {displayText}
            </a>
          ) : (
            <span className="truncate block" title={displayText}>
              {displayText}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnlink(issue.id);
          }}
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Remove issue"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </Badge>
  );

  if (provider === "JIRA") {
    return (
      <div
        className="w-full max-w-full"
        onMouseEnter={() => {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }
          hoverTimeoutRef.current = setTimeout(() => {
            setIsOpen(true);
          }, 200);
        }}
        onMouseLeave={() => {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }
          hoverTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
          }, 100);
        }}
      >
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild className="w-full">{badgeContent}</PopoverTrigger>
          <PopoverContent
            className="w-96 p-0"
            align="start"
            onMouseEnter={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
              }
            }}
            onMouseLeave={() => {
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
              }
              hoverTimeoutRef.current = setTimeout(() => {
                setIsOpen(false);
              }, 100);
            }}
          >
            {isLoading && (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {error && (
              <div className="p-4 text-sm text-destructive">
                {t("common.errors.unknown")}: {error}
              </div>
            )}
            {jiraDetails && !isLoading && !error && (
              <div className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {jiraDetails.issueType?.iconUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={jiraDetails.issueType.iconUrl}
                        alt={jiraDetails.issueType.name}
                        className="h-4 w-4"
                      />
                    )}
                    <span className="font-semibold">{jiraDetails.key}</span>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-sm ${
                      jiraDetails.status.color === "green"
                        ? "bg-green-100 text-green-800"
                        : jiraDetails.status.color === "yellow"
                          ? "bg-yellow-100 text-yellow-800"
                          : jiraDetails.status.color === "blue"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-muted"
                    }`}
                  >
                    {jiraDetails.status.name}
                  </span>
                </div>

                {/* Summary */}
                <h4 className="font-medium">{jiraDetails.summary}</h4>

                {/* Description */}
                {jiraDetails.description && (
                  <div className="text-sm text-muted-foreground line-clamp-3">
                    {jiraDetails.description}
                  </div>
                )}

                {/* Priority and Assignee */}
                <div className="flex items-center gap-4 text-sm">
                  {jiraDetails.priority && (
                    <div className="flex items-center gap-1">
                      {jiraDetails.priority.iconUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={jiraDetails.priority.iconUrl}
                          alt={jiraDetails.priority.name}
                          className="h-4 w-4"
                        />
                      )}
                      <span className="font-medium">
                        {jiraDetails.priority.name}
                      </span>
                    </div>
                  )}
                  {jiraDetails.assignee && (
                    <div className="flex items-center gap-1">
                      {jiraDetails.assignee.avatarUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={jiraDetails.assignee.avatarUrl}
                          alt={jiraDetails.assignee.displayName}
                          className="h-5 w-5 rounded-full"
                        />
                      )}
                      <span>{jiraDetails.assignee.displayName}</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>
                    {t("common.updated")}:{" "}
                    {new Date(jiraDetails.updated).toLocaleDateString()}
                  </span>
                  {issue.url && (
                    <Link
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-primary"
                    >
                      {t("issues.viewExternal", { provider: formatProviderName(provider) })}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // For non-JIRA providers, just return the badge without popover
  return badgeContent;
}

export function ManageExternalIssues({
  testCaseId,
  projectId,
  projectIntegrationId,
  integrationId,
  provider,
  linkedIssueIds,
  setLinkedIssueIds,
  entityType = 'testCase',
}: ManageExternalIssuesProps) {
  const t = useTranslations();
  const [linkedIssues, setLinkedIssues] = useState<ExternalIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // Fetch linked issues on mount
  useEffect(() => {
    // Only fetch if entity exists (testCaseId > 0)
    if (testCaseId > 0) {
      fetchLinkedIssues();
    } else {
      // For new entities, just set loading to false
      setIsLoading(false);
    }
  }, [testCaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync linkedIssueIds prop with linkedIssues state when it changes
  useEffect(() => {
    if (
      testCaseId > 0 &&
      linkedIssueIds &&
      linkedIssueIds.length > 0 &&
      linkedIssues.length === 0 &&
      !isLoading
    ) {
      fetchLinkedIssues();
    }
  }, [linkedIssueIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLinkedIssues = async () => {
    try {
      let url = `/api/integrations/jira/link-issue?`;
      if (entityType === 'testRun') {
        url += `testRunId=${testCaseId}`;
      } else if (entityType === 'session') {
        url += `sessionId=${testCaseId}`;
      } else if (entityType === 'testRunResult') {
        url += `testRunResultId=${testCaseId}`;
      } else if (entityType === 'testRunStepResult') {
        url += `testRunStepResultId=${testCaseId}`;
      } else if (entityType === 'sessionResult') {
        url += `sessionResultId=${testCaseId}`;
      } else {
        url += `testCaseId=${testCaseId}`;
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const issues = data.linkedIssues || [];
        setLinkedIssues(issues);
        // Update form field with fetched issue IDs
        if (setLinkedIssueIds) {
          const issueIds = issues.map((i: ExternalIssue) => i.id);
          setLinkedIssueIds(issueIds);
        }
      }
    } catch (error) {
      console.error("Error fetching linked issues:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkIssue = async (issue: ExternalIssue) => {
    setIsLinking(true);
    try {
      // If entity doesn't exist yet (testCaseId === 0), just update local state
      if (testCaseId === 0) {
        const newIssue: ExternalIssue = {
          id: Date.now(), // Temporary ID for new issues
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          url: issue.url,
          externalId: issue.externalId
        };
        const updatedIssues = [...linkedIssues, newIssue];
        setLinkedIssues(updatedIssues);
        if (setLinkedIssueIds) {
          setLinkedIssueIds(updatedIssues.map((i: ExternalIssue) => i.id));
        }
        setIsSearchOpen(false);
        setIsLinking(false);
        return;
      }
      const body: any = {
        jiraIssueKey: issue.key,
        jiraIssueId: issue.externalId || issue.key, // jiraIssueId should be the external ID
        integrationId,
        issueTitle: issue.summary,
        issueUrl: issue.url,
      };

      // Add the appropriate entity ID based on entityType
      if (entityType === 'testRun') {
        body.testRunId = testCaseId;
      } else if (entityType === 'session') {
        body.sessionId = testCaseId;
      } else if (entityType === 'testRunResult') {
        body.testRunResultId = testCaseId;
      } else if (entityType === 'testRunStepResult') {
        body.testRunStepResultId = testCaseId;
      } else if (entityType === 'sessionResult') {
        body.sessionResultId = testCaseId;
      } else {
        body.testCaseId = testCaseId;
      }

      const response = await fetch("/api/integrations/jira/link-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(t("common.errors.issueManagement.linkedSuccess"));
        // Use the linked issues from the response to ensure we have the correct database IDs
        const updatedIssues = data.linkedIssues || [];
        setLinkedIssues(updatedIssues);
        // Update form field with issue IDs
        if (setLinkedIssueIds) {
          setLinkedIssueIds(updatedIssues.map((i: ExternalIssue) => i.id));
        }
        setIsSearchOpen(false);
      } else {
        toast.error(t("issues.linkError"));
      }
    } catch (error) {
      toast.error(t("common.errors.issueManagement.linkError"));
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlinkIssue = async (issueId: number) => {
    // Find the issue to get its external ID
    const issue = linkedIssues.find((i) => i.id === issueId);
    if (!issue) return;

    // If entity doesn't exist yet (testCaseId === 0), just update local state
    if (testCaseId === 0) {
      const updatedIssues = linkedIssues.filter((issue) => issue.id !== issueId);
      setLinkedIssues(updatedIssues);
      if (setLinkedIssueIds) {
        setLinkedIssueIds(updatedIssues.map((i) => i.id));
      }
      return;
    }

    try {
      const body: any = {
        jiraIssueId: issue.externalId || issue.key, // Use externalId if available
      };

      // Add the appropriate entity ID based on entityType
      if (entityType === 'testRun') {
        body.testRunId = testCaseId;
      } else if (entityType === 'session') {
        body.sessionId = testCaseId;
      } else if (entityType === 'testRunResult') {
        body.testRunResultId = testCaseId;
      } else if (entityType === 'testRunStepResult') {
        body.testRunStepResultId = testCaseId;
      } else if (entityType === 'sessionResult') {
        body.sessionResultId = testCaseId;
      } else {
        body.testCaseId = testCaseId;
      }

      const response = await fetch("/api/integrations/jira/link-issue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        toast.success(t("common.errors.issueManagement.unlinkedSuccess"));
        const updatedIssues = linkedIssues.filter(
          (issue) => issue.id !== issueId
        );
        setLinkedIssues(updatedIssues);
        // Update form field with issue IDs
        if (setLinkedIssueIds) {
          setLinkedIssueIds(updatedIssues.map((i) => i.id));
        }
      } else {
        toast.error(t("issues.unlinkError"));
      }
    } catch (error) {
      toast.error(t("common.errors.issueManagement.unlinkError"));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-1 w-full max-w-full overflow-hidden">
      <div className="flex flex-col gap-2 w-full">
        {linkedIssues.map((issue) => (
          <LinkedIssueBadge
            key={issue.id}
            issue={issue}
            provider={provider}
            integrationId={integrationId}
            onUnlink={handleUnlinkIssue}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsSearchOpen(true)}
        disabled={isLinking}
      >
        <Plus className="h-4 w-4" />
        {t("issues.linkExternalIssue", { provider: formatProviderName(provider) })}
      </Button>

      <SearchIssuesDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        projectId={projectId}
        linkedIssueIds={linkedIssues.map((issue) => issue.key)}
        onIssueSelected={(issue) => {
          if (issue.isExternal) {
            handleLinkIssue({
              id: Number(issue.id),
              key: (issue as any).key || issue.externalKey || String(issue.id),
              summary: issue.title,
              status: issue.externalStatus || issue.status,
              url: (issue as any).url || issue.externalUrl || undefined,
              externalId:
                issue.externalId || (issue as any).key || issue.externalKey,
            });
          }
        }}
      />
    </div>
  );
}
