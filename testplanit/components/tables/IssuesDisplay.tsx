import React, { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ExternalLink, Loader2 } from "lucide-react";
import { Link } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import DOMPurify from "dompurify";
import { useIssueColors } from "@/hooks/useIssueColors";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";

interface IssueDisplayProps {
  id: number;
  name: string;
  externalId?: string | null;
  externalUrl?: string | null;
  title?: string | null;
  status?: string | null;
  size?: "small" | "large";
  projectIds: number[];
  data?: any; // Additional data from external system
  integrationProvider?: string; // e.g., "JIRA"
  integrationId?: number; // ID of the integration
  lastSyncedAt?: Date | null; // When the issue was last synced
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
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

export const IssuesDisplay: React.FC<IssueDisplayProps> = ({
  id,
  name,
  externalId,
  externalUrl,
  title,
  status,
  size = "small",
  projectIds,
  data,
  integrationProvider,
  integrationId,
  lastSyncedAt,
  issueTypeName,
  issueTypeIconUrl,
}) => {
  const t = useTranslations();
  const { getPriorityStyle, getStatusStyle } = useIssueColors();
  const [isOpen, setIsOpen] = useState(false);
  const [jiraDetails, setJiraDetails] = useState<JiraIssueDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const syncTriggeredRef = useRef(false); // Track if we've already triggered a sync for this issue

  // Function to check if sync is needed and trigger it
  const triggerSyncIfNeeded = () => {
    // Only trigger once per component mount
    if (syncTriggeredRef.current) {
      return;
    }

    // Only sync external issues with integration
    if (!integrationId || !integrationProvider) {
      return;
    }

    // Check if lastSyncedAt is older than 3 hours
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const now = new Date().getTime();
    const lastSynced = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    const needsSync = !lastSyncedAt || now - lastSynced > THREE_HOURS_MS;

    if (needsSync) {
      syncTriggeredRef.current = true;

      // Fire and forget - trigger background sync using the same endpoint as the sync button
      fetch(`/api/issues/${id}/sync`, {
        method: "POST",
      }).catch((err) => {
        // Silently fail - this is a background optimization
        console.debug("Background sync trigger failed:", err);
      });
    }
  };

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
    if (
      isOpen &&
      externalUrl &&
      integrationProvider === "JIRA" &&
      integrationId &&
      !jiraDetails
    ) {
      setIsLoading(true);
      setError(null);

      fetch(
        `/api/integrations/jira/issue-details?issueKey=${encodeURIComponent(name)}&integrationId=${integrationId}`
      )
        .then(async (res) => {
          if (!res.ok) {
            try {
              const error = await res.json();
              if (res.status === 401 && error.requiresAuth) {
                throw new Error(
                  error.error ||
                    "Please authenticate with Jira to view issue details"
                );
              }
              throw new Error(error.error || "Failed to fetch issue details");
            } catch (e) {
              if (e instanceof Error) throw e;
              throw new Error(
                `Failed to fetch issue details: ${res.status} ${res.statusText}`
              );
            }
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
  }, [
    isOpen,
    externalUrl,
    integrationProvider,
    integrationId,
    name,
    jiraDetails,
  ]);

  // Issue config is no longer needed as we use integrations directly
  const issueConfig = null;
  const isLoadingConfig = false;

  if (!id || !name) {
    return null;
  }

  const iconClassName =
    size === "large" ? "w-5 h-5 shrink-0" : "w-4 h-4 shrink-0";

  // For external issues, show "KEY: Title" format
  const displayText =
    externalUrl && title && title !== name ? `${name}: ${title}` : name;

  let linkHref: string | undefined | null = undefined;

  // First priority: Use externalUrl if provided (for Jira and other external integrations)
  if (externalUrl) {
    linkHref = externalUrl;
  }
  // Second priority: Use externalId as fallback
  else if (externalId) {
    // If we have an externalId but no URL, just show the ID
    linkHref = null;
  }

  // Use Popover for external issues, Tooltip for internal
  // Show Jira popover if we have integration info, even if externalUrl is missing (we can still fetch details)
  const isExternalIssue =
    integrationProvider?.toUpperCase() === "JIRA" && integrationId;

  const badgeContent = (
    <Badge
      key={id}
      className={`hover:bg-accent hover:text-accent-foreground hover:border-primary transition-colors w-full max-w-full inline-flex ${size === "large" ? "text-base" : ""}`}
    >
      <div className="flex items-center gap-1 min-w-0 w-full">
        <IssueTypeIcon
          issueTypeName={issueTypeName}
          iconUrl={issueTypeIconUrl}
          className={iconClassName}
        />
        <div className="min-w-0 flex-1 overflow-hidden">
          {linkHref ? (
            <Link
              href={linkHref}
              className="truncate block hover:text-inherit"
              target="_blank"
              rel="noopener noreferrer"
              title={displayText}
            >
              {displayText}
            </Link>
          ) : (
            <span className="truncate block" title={displayText}>
              {displayText}
            </span>
          )}
        </div>
      </div>
    </Badge>
  );

  if (isExternalIssue) {
    return (
      <div
        className="flex items-center group w-full max-w-full"
        onMouseEnter={() => {
          // Trigger background sync if needed
          triggerSyncIfNeeded();

          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }
          hoverTimeoutRef.current = setTimeout(() => {
            setIsOpen(true);
          }, 200); // 200ms delay before opening
        }}
        onMouseLeave={() => {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }
          hoverTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
          }, 100); // 100ms delay before closing
        }}
      >
        <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <PopoverTrigger asChild className="w-full">
            {badgeContent}
          </PopoverTrigger>
          <PopoverContent
            className="w-96 p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
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
                {t("common.ui.issues.errorLoadingDetails")}
                {error}
              </div>
            )}
            {jiraDetails && !isLoading && !error && (
              <div className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1">
                    <IssueTypeIcon
                      issueTypeName={jiraDetails.issueType?.name}
                      iconUrl={jiraDetails.issueType?.iconUrl}
                      className="h-4 w-4"
                    />
                    {linkHref ? (
                      <Link
                        href={linkHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:text-primary hover:underline"
                      >
                        {jiraDetails.key}
                      </Link>
                    ) : (
                      <span className="font-semibold">{jiraDetails.key}</span>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-xs"
                    style={getStatusStyle(jiraDetails.status.name)}
                  >
                    {jiraDetails.status.name}
                  </Badge>
                </div>

                {/* Summary */}
                <h4 className="font-medium">{jiraDetails.summary}</h4>

                {/* Description */}
                {jiraDetails.description && (
                  <div
                    className="text-sm text-muted-foreground line-clamp-3 [&_a]:text-primary [&_a]:underline [&_p]:mb-2 [&_p:last-child]:mb-0"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(jiraDetails.description, {
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
                <div className="flex justify-between items-center gap-4 text-sm">
                  {jiraDetails.priority && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {t("common.fields.priority")}:
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs gap-1"
                        style={getPriorityStyle(jiraDetails.priority.name)}
                      >
                        {jiraDetails.priority.iconUrl && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={jiraDetails.priority.iconUrl}
                            alt={jiraDetails.priority.name}
                            className="h-3 w-3"
                          />
                        )}
                        {jiraDetails.priority.name}
                      </Badge>
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
                      <span className="text-muted-foreground">
                        {t("common.ui.issues.assignee")}:
                      </span>
                      <span>{jiraDetails.assignee.displayName}</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                  <span>
                    {t("common.ui.issues.updated")}
                    {new Date(jiraDetails.updated).toLocaleDateString()}
                  </span>
                  {linkHref && (
                    <Link
                      href={linkHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-primary"
                    >
                      {t("common.ui.issues.openInJira")}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
        {linkHref && (
          <ExternalLink className="w-4 h-4 -ml-1 mr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    );
  }

  // For internal issues, use the original Tooltip
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <div
          className="flex items-center group w-full max-w-full"
          onMouseEnter={() => {
            // Trigger background sync if needed
            triggerSyncIfNeeded();
          }}
        >
          <TooltipTrigger asChild className="cursor-default w-full">
            {badgeContent}
          </TooltipTrigger>
          {linkHref && (
            <ExternalLink className="w-4 h-4 -ml-1 mr-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
        <TooltipContent className="max-w-sm bg-popover text-popover-foreground border">
          <div className="space-y-1">
            <div className="font-semibold">{name}</div>
            {title && title !== name && (
              <div className="text-sm opacity-90">{title}</div>
            )}
            {status && (
              <div className="text-xs opacity-75">
                {t("common.ui.issues.status")}
                {status}
              </div>
            )}
            {linkHref && (
              <div className="text-xs opacity-75">
                {t("common.ui.issues.clickToOpenInNewTab")}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
