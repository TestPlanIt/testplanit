"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, Loader2, AlertCircle, ExternalLink, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFindManyProjectIntegration } from "@/lib/hooks/project-integration";
import { useFindManyIssue } from "@/lib/hooks/issue";
import { useDebounce } from "@/components/Debounce";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateIssueDialog } from "./create-issue-dialog";
import { CreateIssueJiraForm } from "./create-issue-jira-form";
import { toast } from "sonner";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";

interface ExternalIssue {
  id: string;
  key?: string; // The actual issue key from Jira (e.g., "TPI-12")
  title: string;
  description?: string;
  status: string;
  priority?: string;
  externalId?: string;
  externalKey?: string;
  externalUrl?: string;
  externalStatus?: string;
  url?: string; // Direct URL to the issue
  createdBy?: {
    name: string;
    email: string;
  };
}

type InternalIssue = {
  id: number;
  name: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  externalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
};

type IssueItem =
  | (InternalIssue & { isExternal: false })
  | (ExternalIssue & { isExternal: true });

interface SearchIssuesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onIssueSelected?: (issue: IssueItem) => void;
  multiSelect?: boolean;
  onIssuesSelected?: (issues: IssueItem[]) => void;
  linkedIssueIds?: (string | number)[]; // IDs of already linked issues
}

// Helper function to strip HTML tags and get plain text for search preview
function stripHtmlTags(html: string): string {
  if (!html) return "";
  // Remove HTML tags and decode HTML entities
  return html
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
    .replace(/&amp;/g, "&") // Replace &amp; with &
    .replace(/&lt;/g, "<") // Replace &lt; with <
    .replace(/&gt;/g, ">") // Replace &gt; with >
    .replace(/&quot;/g, '"') // Replace &quot; with "
    .replace(/&#39;/g, "'") // Replace &#39; with '
    .replace(/\s+/g, " ") // Replace multiple whitespace with single space
    .trim();
}

export function SearchIssuesDialog({
  open,
  onOpenChange,
  projectId,
  onIssueSelected,
  multiSelect = false,
  onIssuesSelected,
  linkedIssueIds = [],
}: SearchIssuesDialogProps) {
  const t = useTranslations();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<IssueItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [externalIssues, setExternalIssues] = useState<ExternalIssue[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  // Automatically use external search if project has an active integration
  const [searchExternal, setSearchExternal] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Fetch project integrations
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

  // Automatically enable external search when integration is available
  useEffect(() => {
    if (activeIntegration) {
      setSearchExternal(true);
    }
  }, [activeIntegration]);

  // Search internal issues (only when no integration or explicitly internal)
  const { data: internalIssues, isLoading: loadingInternal } = useFindManyIssue(
    {
      where: {
        projectId,
        ...(debouncedSearchQuery && {
          OR: [
            { title: { contains: debouncedSearchQuery, mode: "insensitive" } },
            {
              description: {
                contains: debouncedSearchQuery,
                mode: "insensitive",
              },
            },
            {
              externalKey: {
                contains: debouncedSearchQuery,
                mode: "insensitive",
              },
            },
          ],
        }),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    },
    {
      enabled:
        !activeIntegration &&
        !searchExternal &&
        debouncedSearchQuery.length > 0,
    }
  );

  // Trigger external search when searchExternal changes or query changes
  useEffect(() => {
    if (searchExternal && debouncedSearchQuery.length > 0) {
      searchExternalIssues();
    }
  }, [searchExternal, debouncedSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchExternalIssues = async () => {
    if (!activeIntegration) return;

    setIsSearching(true);
    setAuthError(null);

    try {
      // Get external project ID from integration config (for GitHub this is owner/repo)
      const integrationConfig = (activeIntegration.config as Record<string, any>) || {};
      const externalProjectId = integrationConfig.externalProjectId || integrationConfig.externalProjectKey || "";

      const searchParams = new URLSearchParams({
        q: debouncedSearchQuery,
      });
      if (externalProjectId) {
        searchParams.set("projectId", externalProjectId);
      }

      const response = await fetch(
        `/api/integrations/${activeIntegration.integrationId}/search?${searchParams.toString()}`
      );

      if (response.status === 401) {
        const errorData = await response.json();
        setAuthError(errorData.authUrl || "Authentication required");
        setExternalIssues([]);
        return;
      }

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("Search API error:", errorData);
        throw new Error(errorData.error || "Failed to search external issues");
      }

      const data = await response.json();
      // Map the IssueData from adapter to ExternalIssue format
      const formattedIssues = data.issues.map((issue: any) => ({
        id: issue.id, // Jira's internal ID
        key: issue.key, // Jira issue key (e.g., "TPI-12")
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        externalId: issue.id, // Use Jira's ID as externalId
        externalKey: issue.key, // Use Jira's key as externalKey
        externalUrl: issue.url,
        externalStatus: issue.status,
        isExternal: true,
      }));
      setExternalIssues(formattedIssues);
    } catch (error) {
      console.error("Failed to search external issues:", error);
      setExternalIssues([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleIssueToggle = (issue: IssueItem) => {
    if (multiSelect) {
      setSelectedIssues((prev) => {
        const isSelected = prev.some((i) =>
          i.isExternal && issue.isExternal
            ? i.id === issue.id // Compare by ID for external issues
            : !i.isExternal && !issue.isExternal
              ? i.id === issue.id // Compare by ID for internal issues
              : false
        );
        if (isSelected) {
          return prev.filter((i) =>
            i.isExternal && issue.isExternal
              ? i.id !== issue.id
              : !i.isExternal && !issue.isExternal
                ? i.id !== issue.id
                : true
          );
        } else {
          return [...prev, issue];
        }
      });
    } else {
      onIssueSelected?.(issue);
      onOpenChange(false);
    }
  };

  const handleConfirmSelection = () => {
    onIssuesSelected?.(selectedIssues);
    onOpenChange(false);
    setSelectedIssues([]);
  };

  const handleAuthenticate = (authUrl: string) => {
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    window.open(
      authUrl,
      "_blank",
      `width=${width},height=${height},left=${left},top=${top}`
    );
  };

  const allIssues: IssueItem[] = searchExternal
    ? externalIssues.map((issue) => ({ ...issue, isExternal: true as const }))
    : (internalIssues || []).map((issue) => ({
        ...issue,
        isExternal: false as const,
      }));
  const isLoading = searchExternal ? isSearching : loadingInternal;


  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <DialogTitle>
                  {activeIntegration ? (
                    <div className="flex items-center gap-2">
                      {t("issues.searchIssues")}
                      <span className="text-sm font-normal text-muted-foreground">
                        {"("}
                        {activeIntegration.integration.name}
                        {")"}
                      </span>
                    </div>
                  ) : (
                    t("issues.searchIssues")
                  )}
                </DialogTitle>
                <DialogDescription>
                  {activeIntegration
                    ? t("issues.searchExternalDescription", {
                        provider: activeIntegration.integration.provider,
                      })
                    : t("issues.searchIssuesDescription")}
                </DialogDescription>
              </div>
              {activeIntegration && !authError && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateDialog(true)}
                  className="mt-2"
                >
                  <Plus className="h-4 w-4" />
                  {t("issues.createNewIssue")}
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-4 max-w-[660px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("issues.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {authError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("issues.authenticationRequired")}</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>{t("issues.authRequiredDescription")}</span>
                  {authError.startsWith("http") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAuthenticate(authError)}
                    >
                      {t("issues.authenticate")}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="w-full max-w-full overflow-hidden flex flex-col">
              <ScrollArea className="h-[400px] rounded-md border w-full shrink-0 [&_[data-radix-scroll-area-viewport]>div]:block! [&_[data-radix-scroll-area-viewport]>div]:max-w-full!">
                {isLoading ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : allIssues.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <Search className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {debouncedSearchQuery
                        ? t("issues.noIssuesFound")
                        : t("issues.startTypingToSearch")}
                    </p>
                  </div>
                ) : (
                  <div className="p-4 space-y-2 w-full max-w-full overflow-hidden">
                    {allIssues.map((issue) => {
                      const isSelected = selectedIssues.some((i) =>
                        i.isExternal && issue.isExternal
                          ? i.id === issue.id
                          : !i.isExternal && !issue.isExternal
                            ? i.id === issue.id
                            : false
                      );

                      // Check if issue is already linked
                      // For external issues, compare by key (e.g., "TPI-11")
                      const isAlreadyLinked = linkedIssueIds.some(
                        (linkedId) => {
                          if (issue.isExternal) {
                            // Compare by Jira key
                            return String(linkedId) === String(issue.key);
                          } else {
                            // For internal issues, compare by ID
                            return String(linkedId) === String(issue.id);
                          }
                        }
                      );

                      // Generate a stable key
                      const key = issue.isExternal
                        ? `external-${issue.id}`
                        : `internal-${issue.id}`;
                      return (
                        <div
                          key={key}
                          className={`rounded-lg border p-4 transition-colors overflow-hidden ${
                            isAlreadyLinked
                              ? "border-muted bg-muted/50 opacity-40 cursor-not-allowed"
                              : isSelected
                                ? "border-primary bg-primary/5 cursor-pointer"
                                : "hover:bg-accent cursor-pointer"
                          }`}
                          onClick={() =>
                            !isAlreadyLinked && handleIssueToggle(issue)
                          }
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 min-w-0">
                                {multiSelect && (
                                  <Checkbox
                                    checked={isSelected}
                                    disabled={isAlreadyLinked}
                                    onCheckedChange={() =>
                                      !isAlreadyLinked &&
                                      handleIssueToggle(issue)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                )}
                                <h4 className="text-sm font-medium flex items-center gap-2 min-w-0 flex-1">
                                  {issue.isExternal &&
                                    ((issue as any).key ||
                                      issue.externalKey) && (
                                      <span className="text-muted-foreground shrink-0">
                                        {"["}
                                        {(issue as any).key ||
                                          issue.externalKey}
                                        {"] "}
                                      </span>
                                    )}
                                  <span className="truncate">
                                    {issue.isExternal
                                      ? issue.title
                                      : issue.name}
                                  </span>
                                  {isAlreadyLinked && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs shrink-0"
                                    >
                                      {t("issues.alreadyLinked")}
                                    </Badge>
                                  )}
                                </h4>
                              </div>
                              {issue.description && (
                                <p className="text-sm text-muted-foreground line-clamp-4 wrap-break-word">
                                  {stripHtmlTags(issue.description)}
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                {issue.priority && (
                                  <IssuePriorityDisplay priority={issue.priority} />
                                )}
                                {(issue.externalStatus || issue.status) && (
                                  <IssueStatusDisplay
                                    status={issue.externalStatus || issue.status}
                                  />
                                )}
                                {issue.createdBy && (
                                  <span className="text-muted-foreground truncate max-w-[200px]">
                                    {issue.createdBy.name ||
                                      issue.createdBy.email}
                                  </span>
                                )}
                              </div>
                            </div>
                            {issue.isExternal &&
                              ((issue as any).url || issue.externalUrl) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(
                                      (issue as any).url ||
                                        issue.externalUrl ||
                                        "",
                                      "_blank"
                                    );
                                  }}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {multiSelect && selectedIssues.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-4">
                <span className="text-sm font-medium">
                  {t("issues.selectedCount", { count: selectedIssues.length })}
                </span>
                <Button onClick={handleConfirmSelection} size="sm">
                  {t("issues.confirmSelection")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showCreateDialog &&
        activeIntegration?.integration.provider === "JIRA" && (
          <CreateIssueJiraForm
            open={showCreateDialog}
            onOpenChange={setShowCreateDialog}
            projectId={projectId}
            integrationId={activeIntegration.integrationId}
            projectKey={
              (activeIntegration.config as any)?.externalProjectKey || ""
            }
            issueTypeId={(activeIntegration.config as any)?.defaultIssueType}
            onIssueCreated={(createdIssue) => {
              // Close the create dialog
              setShowCreateDialog(false);

              // Show success toast
              toast.success(t("issues.created"), {
                description: t("issues.issueCreatedDescription", {
                  key: createdIssue.key,
                }),
              });

              // Set the search query to the newly created issue key
              // This will trigger the search and show the new issue
              if (createdIssue.key) {
                setSearchQuery(createdIssue.key);
              }
            }}
          />
        )}

      {showCreateDialog &&
        activeIntegration?.integration.provider !== "JIRA" && (
          <CreateIssueDialog
            open={showCreateDialog}
            onOpenChange={setShowCreateDialog}
            projectId={projectId}
            onIssueCreated={(createdIssue) => {
              // Close the create dialog
              setShowCreateDialog(false);

              // Set the search query to the newly created issue key or title
              // This will trigger the search and show the new issue
              if (createdIssue.key || createdIssue.externalKey) {
                setSearchQuery(createdIssue.key || createdIssue.externalKey);
              } else if (createdIssue.title || createdIssue.name) {
                setSearchQuery(createdIssue.title || createdIssue.name);
              }
            }}
          />
        )}
    </>
  );
}
