"use client";

import { Badge } from "@/components/ui/badge";
import { trackerLabelStyle } from "~/lib/integrations/trackerLabelStyle";
import { isDarkTheme } from "~/utils/theme";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import DOMPurify from "dompurify";
import { Bug, ExternalLink, Loader2, Milestone, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ExternalIssueDetails } from "~/lib/integrations/issueDetails";
import { Link } from "~/lib/navigation";
import { SearchIssuesDialog } from "./search-issues-dialog";
import { apiFetch } from "~/lib/basePath";

// Utility function to format provider names for display
const formatProviderName = (provider: string): string => {
  switch (provider.toLowerCase()) {
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
      return (
        provider.charAt(0).toUpperCase() +
        provider.slice(1).toLowerCase().replace(/_/g, " ")
      );
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

interface ManageExternalIssuesProps {
  testCaseId: number;
  projectId: number;
  projectIntegrationId: number;
  integrationId: number;
  provider: string;
  linkedIssueIds?: number[];
  setLinkedIssueIds?: (issueIds: number[]) => void;
  entityType?:
    | "testCase"
    | "testRun"
    | "session"
    | "testRunResult"
    | "testRunStepResult"
    | "sessionResult";
  /**
   * INT-05: when set, SearchIssuesDialog's "Create New Issue" path
   * prefills the title + description from the failed-iteration body
   * builder. Threaded through unchanged.
   */
  iterationContext?: {
    iterationId: number;
    testRunId: number;
    testRunCaseId: number;
  };
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
  const { resolvedTheme } = useTheme();
  const darkTheme = isDarkTheme(resolvedTheme);
  const [isOpen, setIsOpen] = useState(false);
  const [details, setDetails] = useState<ExternalIssueDetails | null>(null);
  // Only the trackers whose keys the details route resolves are asked.
  const hasTrackerDetails =
    ["JIRA", "GITHUB"].includes(provider ?? "") && !!integrationId;
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

  // Fetch the tracker's issue details when the popover opens
  useEffect(() => {
    if (isOpen && hasTrackerDetails && !details) {
      setIsLoading(true);
      setError(null);

      apiFetch(
        `/api/integrations/issue-details?issueKey=${encodeURIComponent(issue.key)}&integrationId=${integrationId}`
      )
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("Failed to fetch issue details");
          }
          return res.json();
        })
        .then((data) => {
          setDetails(data);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setIsLoading(false);
        });
    }
  }, [isOpen, hasTrackerDetails, integrationId, issue.key, details]);

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
          aria-label={t("common.aria.removeIssue")}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </Badge>
  );

  if (hasTrackerDetails) {
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
          <PopoverTrigger asChild className="w-full">
            {badgeContent}
          </PopoverTrigger>
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
            {details && !isLoading && !error && (
              <div className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {details.issueType?.iconUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={details.issueType.iconUrl}
                        alt={details.issueType.name}
                        className="h-4 w-4"
                      />
                    )}
                    <span className="font-semibold">{details.key}</span>
                  </div>
                  <IssueStatusDisplay
                    status={details.status.name}
                    className="text-xs"
                  />
                </div>

                {/* Summary */}
                <h4 className="font-medium">{details.summary}</h4>

                {/* Description */}
                {details.description && (
                  <div
                    className="text-sm text-muted-foreground line-clamp-3 [&_a]:text-primary [&_a]:underline [&_p]:mb-2 [&_p:last-child]:mb-0"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(details.description, {
                        ALLOWED_TAGS: [
                          "p",
                          "br",
                          "a",
                          "strong",
                          "em",
                          "u",
                          "ul",
                          "ol",
                          "li",
                        ],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                      }),
                    }}
                  />
                )}

                {/* Priority and Assignee */}
                <div className="flex items-center gap-4 text-sm">
                  {details.priority && (
                    <div className="flex items-center gap-1">
                      {details.priority.iconUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={details.priority.iconUrl}
                          alt={details.priority.name}
                          className="h-4 w-4"
                        />
                      )}
                      <span className="font-medium">
                        {details.priority.name}
                      </span>
                    </div>
                  )}
                  {details.assignees.length > 0 && (
                    <div className="flex items-center gap-1">
                      {details.assignees[0].avatarUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={details.assignees[0].avatarUrl}
                          alt={details.assignees[0].displayName}
                          className="h-5 w-5 rounded-full"
                        />
                      )}
                      <span>
                        {details.assignees
                          .map((assignee) => assignee.displayName)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                {details.labels.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="text-muted-foreground text-xs">
                      {t(
                        "projects.settings.integrations.integration.requirementsConfig.labelsLabel"
                      )}
                      :
                    </span>
                    {details.labels.map((label) => (
                      <Badge
                        key={label}
                        variant="outline"
                        className="text-xs"
                        style={trackerLabelStyle(
                          details.labelColors?.[label],
                          darkTheme
                        )}
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}

                {details.milestone && (
                  <div className="flex items-center gap-1 text-sm">
                    <Milestone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground text-xs">
                      {t("common.fields.milestone")}:
                    </span>
                    <span>{details.milestone.name}</span>
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>
                    {t("common.updated")}:{" "}
                    {details.updated
                      ? new Date(details.updated).toLocaleDateString()
                      : ""}
                  </span>
                  {issue.url && (
                    <Link
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-primary"
                    >
                      {t("issues.viewExternal", {
                        provider: formatProviderName(provider),
                      })}
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

  // Without a tracker to ask, the badge is all there is to show
  return badgeContent;
}

export function ManageExternalIssues({
  testCaseId,
  projectId,
  projectIntegrationId: _projectIntegrationId,
  integrationId,
  provider,
  linkedIssueIds,
  setLinkedIssueIds,
  entityType = "testCase",
  iterationContext,
}: ManageExternalIssuesProps) {
  const t = useTranslations();
  const [linkedIssues, setLinkedIssues] = useState<ExternalIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  // This component owns the whole `issues` form value but only ever sees the
  // links a tracker claims: every response below is scoped server-side to
  // issues belonging to an ACTIVE issue-tracking integration, so
  // integration-less links (requirements) and links stranded by a
  // since-deactivated integration are absent from all of them.
  //
  // Ownership, not issue kind, is the durable predicate — but it decides what
  // this component may SPEAK FOR, not what it copies forward. It publishes
  // exactly the set the server has handed it and says nothing about the rest.
  // Merging the form value's foreign ids back in looks safer and is not: that
  // value is a page-load snapshot of somebody else's state, and the case's
  // Linked Requirements panel commits its unlinks straight to the database
  // without touching this form, so republishing a requirement id the snapshot
  // still carries makes the save recreate a link the user just removed. A
  // snapshot cannot hold a foreign link alive and let the user let go of it;
  // only the save, reading the links as they actually are, can do both — so
  // it holds integration-less links out of the replace entirely
  // (utils/caseIssueLinkWrite.ts) and this value never speaks for them.
  const linkedIssueIdsRef = useRef<number[]>(linkedIssueIds ?? []);

  useEffect(() => {
    linkedIssueIdsRef.current = linkedIssueIds ?? [];
  }, [linkedIssueIds]);

  const publishLinkedIssueIds = (ownedIssues: ExternalIssue[]) => {
    if (!setLinkedIssueIds) return;
    const next = ownedIssues.map((issue) => issue.id);
    const current = linkedIssueIdsRef.current;
    // Handing the parent a fresh array for an unchanged set would re-fire the
    // prop-sync fetch below and spin.
    if (
      next.length === current.length &&
      next.every((id) => current.includes(id))
    ) {
      return;
    }
    linkedIssueIdsRef.current = next;
    setLinkedIssueIds(next);
  };

  // Fetch linked issues on mount
  useEffect(() => {
    // Only fetch if entity exists (testCaseId > 0)
    if (testCaseId > 0) {
      void fetchLinkedIssues();
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
      void fetchLinkedIssues();
    }
  }, [linkedIssueIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLinkedIssues = async () => {
    try {
      let url = `/api/integrations/jira/link-issue?`;
      if (entityType === "testRun") {
        url += `testRunId=${testCaseId}`;
      } else if (entityType === "session") {
        url += `sessionId=${testCaseId}`;
      } else if (entityType === "testRunResult") {
        url += `testRunResultId=${testCaseId}`;
      } else if (entityType === "testRunStepResult") {
        url += `testRunStepResultId=${testCaseId}`;
      } else if (entityType === "sessionResult") {
        url += `sessionResultId=${testCaseId}`;
      } else {
        url += `testCaseId=${testCaseId}`;
      }

      const response = await apiFetch(url);
      if (response.ok) {
        const data = await response.json();
        const issues = data.linkedIssues || [];
        setLinkedIssues(issues);
        // Update form field with fetched issue IDs
        publishLinkedIssueIds(issues);
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
          externalId: issue.externalId,
        };
        const updatedIssues = [...linkedIssues, newIssue];
        setLinkedIssues(updatedIssues);
        publishLinkedIssueIds(updatedIssues);
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
      if (entityType === "testRun") {
        body.testRunId = testCaseId;
      } else if (entityType === "session") {
        body.sessionId = testCaseId;
      } else if (entityType === "testRunResult") {
        body.testRunResultId = testCaseId;
      } else if (entityType === "testRunStepResult") {
        body.testRunStepResultId = testCaseId;
      } else if (entityType === "sessionResult") {
        body.sessionResultId = testCaseId;
      } else {
        body.testCaseId = testCaseId;
      }

      const response = await apiFetch("/api/integrations/jira/link-issue", {
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
        publishLinkedIssueIds(updatedIssues);
        setIsSearchOpen(false);
      } else {
        toast.error(t("issues.linkError"));
      }
    } catch {
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
      const updatedIssues = linkedIssues.filter(
        (issue) => issue.id !== issueId
      );
      setLinkedIssues(updatedIssues);
      publishLinkedIssueIds(updatedIssues);
      return;
    }

    try {
      const body: any = {
        jiraIssueId: issue.externalId || issue.key, // Use externalId if available
      };

      // Add the appropriate entity ID based on entityType
      if (entityType === "testRun") {
        body.testRunId = testCaseId;
      } else if (entityType === "session") {
        body.sessionId = testCaseId;
      } else if (entityType === "testRunResult") {
        body.testRunResultId = testCaseId;
      } else if (entityType === "testRunStepResult") {
        body.testRunStepResultId = testCaseId;
      } else if (entityType === "sessionResult") {
        body.sessionResultId = testCaseId;
      } else {
        body.testCaseId = testCaseId;
      }

      const response = await apiFetch("/api/integrations/jira/link-issue", {
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
        publishLinkedIssueIds(updatedIssues);
      } else {
        toast.error(t("issues.unlinkError"));
      }
    } catch {
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
        {t("issues.linkExternalIssue", {
          provider: formatProviderName(provider),
        })}
      </Button>

      <SearchIssuesDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        projectId={projectId}
        linkedIssueIds={linkedIssues.map((issue) => issue.key)}
        iterationContext={iterationContext}
        // WR-01: onIssueSelected below only handles issue.isExternal.
        allowInternalPicks={false}
        onIssueSelected={(issue) => {
          if (issue.isExternal) {
            void handleLinkIssue({
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
