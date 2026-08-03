"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { stripHtmlTags } from "~/utils/stripHtmlTags";
import { useDebounce } from "@/components/Debounce";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isIntegrationAuthCompleteMessage } from "~/lib/integrations/oauthPopup";
import { CreateIssueDialog } from "./create-issue-dialog";
import { CreateIssueJiraForm } from "./create-issue-jira-form";

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
  _projectKey?: string; // Project key for multi-project badge (D-06)
  _projectName?: string; // Full project name for display
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
  /**
   * INT-05: when set, "Create New Issue" opens with the title +
   * description prefilled from the failed iteration's parameter values
   * and a deep link. The dialog fetches the prefill from
   * `/api/repository/test-runs/{runId}/cases/{caseId}/iterations/{iterId}/issue-body`.
   *
   * `runId` and `testRunCaseId` are required for the IDOR-defense URL.
   */
  iterationContext?: {
    iterationId: number;
    testRunId: number;
    testRunCaseId: number;
  };
}

export function SearchIssuesDialog({
  open,
  onOpenChange,
  projectId,
  onIssueSelected,
  multiSelect = false,
  onIssuesSelected,
  linkedIssueIds = [],
  iterationContext,
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

  // INT-05: prefill payload from the failed-iteration body builder. Loaded
  // lazily when the user opens "Create New Issue" with an iterationContext.
  const [iterationPrefill, setIterationPrefill] = useState<{
    title: string;
    description: unknown;
  } | null>(null);
  const [isLoadingPrefill, setIsLoadingPrefill] = useState(false);

  // Filter state: null means "All" (fan-out to all projects)
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<
    string | null
  >(null);

  // Partial failure tracking (fan-out: a per-project entry exists when that
  // project's search returned non-2xx). The error message is captured so
  // the UI can distinguish "no matches" (success but empty) from "search
  // failed" (e.g. GitHub 422 on a config that lists users not repos, or
  // 403 from a token whose lifetime exceeds the org's PAT policy).
  const [searchFailures, setSearchFailures] = useState<
    { projectKey: string; status: number; message: string }[]
  >([]);
  // Single-project / fatal error captured separately. Used both for the
  // legacy single-project search (no fan-out) and as a catch-all when the
  // fan-out path hits an exception before per-project results land.
  const [searchError, setSearchError] = useState<string | null>(null);

  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Tracks the key of a just-created issue we're polling for. While set, the
  // debounce-triggered search effect skips firing for that key so it can't race
  // with and overwrite the polling loop's results.
  const pollingForKeyRef = useRef<string | null>(null);

  // Fetch project integrations
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

  // Fetch active IntegrationProject records for multi-project fan-out
  const { data: activeIntegrationProjects } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        projectIntegrationId: activeIntegration?.id || "",
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
    },
    {
      enabled: !!activeIntegration?.id,
    }
  );

  // Automatically enable external search when integration is available
  useEffect(() => {
    if (activeIntegration) {
      setSearchExternal(true);
    }
  }, [activeIntegration]);

  // Search internal issues (only when no integration or explicitly internal)
  const { data: internalIssues, isLoading: loadingInternal } = useClientQueries(
    schema
  ).issue.useFindMany(
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
      // Polling loop owns this key — skip to avoid overwriting its results
      if (pollingForKeyRef.current === debouncedSearchQuery) return;
      void searchExternalIssues();
    }
  }, [searchExternal, debouncedSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Authenticate button opens the OAuth flow in a popup that lands on
  // /integrations/auth-complete, which posts back here. Clear the
  // auth-required state and re-run the search the user was blocked on.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isIntegrationAuthCompleteMessage(event) || !event.data.success) {
        return;
      }
      setAuthError(null);
      if (searchExternal && debouncedSearchQuery.length > 0) {
        void searchExternalIssues();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [searchExternal, debouncedSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchExternalIssues = async (
    queryOverride?: string,
    options?: { manageLoadingState?: boolean }
  ): Promise<ExternalIssue[] | null> => {
    if (!activeIntegration) return null;

    const query = queryOverride ?? debouncedSearchQuery;
    const manageLoadingState = options?.manageLoadingState ?? true;

    if (manageLoadingState) setIsSearching(true);
    setAuthError(null);
    setSearchError(null);
    setSearchFailures([]);

    try {
      const projectsToSearch =
        activeIntegrationProjects?.filter(() => true) || [];

      if (projectsToSearch.length === 0) {
        // Fallback: legacy single-project search from config
        const integrationConfig =
          (activeIntegration.config as Record<string, any>) || {};
        const externalProjectId =
          integrationConfig.externalProjectId ||
          integrationConfig.externalProjectKey ||
          "";

        const searchParams = new URLSearchParams({ q: query });
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
          return null;
        }

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: undefined }));
          console.error("Search API error:", errorData);
          setSearchError(
            errorData?.error ??
              `HTTP ${response.status}: failed to search external issues`
          );
          setExternalIssues([]);
          return null;
        }

        const data = await response.json();
        const formattedIssues = data.issues.map((issue: any) => ({
          id: issue.id,
          key: issue.key,
          title: issue.title,
          description: issue.description,
          status: issue.status,
          priority: issue.priority,
          externalId: issue.id,
          externalKey: issue.key,
          externalUrl: issue.url,
          externalStatus: issue.status,
          isExternal: true,
        }));
        setExternalIssues(formattedIssues);
        return formattedIssues;
      }

      // Fan-out search: call search API once per IntegrationProject (per D-04)
      const searchPromises = projectsToSearch.map(async (ip) => {
        try {
          const searchParams = new URLSearchParams({
            q: query,
            projectId: ip.externalProjectId,
          });

          const response = await fetch(
            `/api/integrations/${activeIntegration.integrationId}/search?${searchParams.toString()}`
          );

          if (response.status === 401) {
            const errorData = await response.json();
            setAuthError(errorData.authUrl || "Authentication required");
            return {
              success: false,
              projectKey: ip.externalProjectKey,
              status: response.status,
              message: errorData.error ?? "Authentication required",
              issues: [] as ExternalIssue[],
            };
          }

          if (!response.ok) {
            // Read the server's error message so the UI can surface what
            // actually went wrong (422 validation, 403 scope/policy, 500
            // downstream). Falling back to a generic message keeps the
            // path safe if the server returned a non-JSON body.
            const errorData = await response
              .json()
              .catch(() => ({ error: undefined }));
            return {
              success: false,
              projectKey: ip.externalProjectKey,
              status: response.status,
              message:
                errorData?.error ?? `HTTP ${response.status}: search failed`,
              issues: [] as ExternalIssue[],
            };
          }

          const data = await response.json();
          const formattedIssues: ExternalIssue[] = (data.issues || []).map(
            (issue: any) => ({
              id: issue.id,
              key: issue.key,
              title: issue.title,
              description: issue.description,
              status: issue.status,
              priority: issue.priority,
              externalId: issue.id,
              externalKey: issue.key,
              externalUrl: issue.url,
              externalStatus: issue.status,
              isExternal: true,
              _projectKey: ip.externalProjectKey, // Per D-06: badge source
              _projectName: ip.externalProjectName,
            })
          );
          return {
            success: true as const,
            projectKey: ip.externalProjectKey,
            issues: formattedIssues,
          };
        } catch (err) {
          return {
            success: false as const,
            projectKey: ip.externalProjectKey,
            status: 0,
            message: err instanceof Error ? err.message : "Network error",
            issues: [] as ExternalIssue[],
          };
        }
      });

      const results = await Promise.allSettled(searchPromises);

      const allIssues: ExternalIssue[] = [];
      const failures: {
        projectKey: string;
        status: number;
        message: string;
      }[] = [];

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.success) {
            allIssues.push(...result.value.issues);
          } else {
            failures.push({
              projectKey: result.value.projectKey,
              status: result.value.status,
              message: result.value.message,
            });
          }
        } else {
          // Promise itself rejected (shouldn't happen with try/catch, but safety net)
          failures.push({
            projectKey: "unknown",
            status: 0,
            message:
              result.reason instanceof Error
                ? result.reason.message
                : "Unknown error",
          });
        }
      }

      setExternalIssues(allIssues);
      setSearchFailures(failures);
      return allIssues;
    } catch (error) {
      console.error("Failed to search external issues:", error);
      setSearchError(
        error instanceof Error
          ? error.message
          : "Failed to search external issues"
      );
      setExternalIssues([]);
      return null;
    } finally {
      if (manageLoadingState) setIsSearching(false);
    }
  };

  // Jira's JQL search index is eventually consistent — a just-created issue
  // may take a few seconds to appear. Re-fire the search until the new key
  // shows up or we give up. Keep isSearching true throughout so the user sees
  // a continuous spinner instead of a flickering "No results" state.
  const pollForCreatedIssue = async (key: string) => {
    const delaysMs = [0, 800, 1200, 1600, 2000];
    pollingForKeyRef.current = key;
    setIsSearching(true);
    try {
      for (const delay of delaysMs) {
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        // User changed the query mid-poll — abandon
        if (pollingForKeyRef.current !== key) return;
        const results = await searchExternalIssues(key, {
          manageLoadingState: false,
        });
        if (results === null) return;
        if (results.some((i) => i.key === key || i.externalKey === key)) {
          return;
        }
      }
    } finally {
      if (pollingForKeyRef.current === key) {
        pollingForKeyRef.current = null;
      }
      setIsSearching(false);
    }
  };

  // Client-side filter derived from full fan-out results
  const filteredExternalIssues = useMemo(() => {
    if (selectedProjectFilter === null) return externalIssues;
    const ip = activeIntegrationProjects?.find(
      (p) => p.id === selectedProjectFilter
    );
    if (!ip) return externalIssues;
    return externalIssues.filter(
      (issue) => issue._projectKey === ip.externalProjectKey
    );
  }, [externalIssues, selectedProjectFilter, activeIntegrationProjects]);

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
    ? filteredExternalIssues.map((issue) => ({
        ...issue,
        isExternal: true as const,
      }))
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
                  onClick={async () => {
                    // INT-05: when launching from a failed iteration, fetch
                    // the prefill payload before mounting the dialog so the
                    // textarea initialization sees the doc on first render.
                    if (iterationContext && !iterationPrefill) {
                      setIsLoadingPrefill(true);
                      try {
                        const url = `/api/repository/test-runs/${iterationContext.testRunId}/cases/${iterationContext.testRunCaseId}/iterations/${iterationContext.iterationId}/issue-body`;
                        const res = await fetch(url);
                        if (res.ok) {
                          const body = await res.json();
                          setIterationPrefill(body);
                        } else {
                          // Surface but do not block — the dialog still
                          // opens with an empty body in this case.
                          console.error(
                            "Failed to load iteration issue body",
                            await res.text()
                          );
                        }
                      } catch (err) {
                        console.error(
                          "Failed to load iteration issue body",
                          err
                        );
                      } finally {
                        setIsLoadingPrefill(false);
                      }
                    }
                    setShowCreateDialog(true);
                  }}
                  className="mt-2"
                  disabled={isLoadingPrefill}
                >
                  <Plus className="h-4 w-4" />
                  {t("issues.createNewIssue")}
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="space-y-4 max-w-[660px]">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("issues.searchPlaceholder")}
                value={searchQuery}
                // The term travels as a GET param into the tracker's JQL
                // URL — an accidental large paste blows past URL limits
                // (CloudFront 414). Cap well below them.
                maxLength={255}
                onChange={(e) => {
                  pollingForKeyRef.current = null;
                  setSearchQuery(e.target.value.slice(0, 255));
                }}
                className="ps-10"
              />
            </div>

            {/* Project filter chips — only shown when 2+ active IntegrationProject records exist (D-05) */}
            {activeIntegrationProjects &&
              activeIntegrationProjects.length >= 2 && (
                <div className="flex flex-wrap gap-1 px-0">
                  <Badge
                    variant={
                      selectedProjectFilter === null ? "default" : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => setSelectedProjectFilter(null)}
                  >
                    {t("issues.filterAll")}
                  </Badge>
                  {activeIntegrationProjects.map((ip) => (
                    <Badge
                      key={ip.id}
                      variant={
                        selectedProjectFilter === ip.id ? "default" : "outline"
                      }
                      className="cursor-pointer max-w-40 truncate"
                      onClick={() => setSelectedProjectFilter(ip.id)}
                      title={ip.externalProjectName || ip.externalProjectKey}
                    >
                      {ip.externalProjectName || ip.externalProjectKey}
                    </Badge>
                  ))}
                </div>
              )}

            {/* Search-failed alert (legacy single-project path or fan-out
                exception). Distinct from "no matches" — shown when the API
                actually returned a non-2xx, so the user knows the empty
                state below is NOT just "nothing matched". */}
            {searchError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("issues.searchFailedTitle")}</AlertTitle>
                <AlertDescription>{searchError}</AlertDescription>
              </Alert>
            )}

            {/* Partial failure alert (fan-out: at least one IntegrationProject
                returned non-2xx). Shows the count + per-project messages so
                the admin can see which project's search broke and why
                (e.g. "ACME: Validation Failed — listed users and
                repositories cannot be searched"). */}
            {searchFailures.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p>
                    {t("issues.fanOutPartialFailure", {
                      count: searchFailures.length,
                      successCount:
                        (activeIntegrationProjects?.length || 0) -
                        searchFailures.length,
                    })}
                  </p>
                  <ul className="mt-2 list-disc ps-5 space-y-1 text-sm">
                    {searchFailures.map((f) => (
                      <li key={f.projectKey}>
                        <span className="font-medium">{f.projectKey}</span>:{" "}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

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
                      <ExternalLink className="ms-2 h-4 w-4" />
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
                                ? "border-primary bg-primary/5 [&_.text-muted-foreground]:text-foreground cursor-pointer"
                                : "hover:bg-accent hover:text-accent-foreground [&:hover_.text-muted-foreground]:text-accent-foreground cursor-pointer"
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
                                  <span className="ms-auto flex items-center gap-2 shrink-0">
                                    {isAlreadyLinked && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        {t("issues.alreadyLinked")}
                                      </Badge>
                                    )}
                                    {/* Project badge for multi-project results (D-06) */}
                                    {issue.isExternal &&
                                      (issue as ExternalIssue)._projectKey && (
                                        <Badge
                                          variant="secondary"
                                          className="text-xs max-w-24 inline-block overflow-hidden text-ellipsis whitespace-nowrap"
                                          title={
                                            (issue as ExternalIssue)
                                              ._projectName ||
                                            (issue as ExternalIssue)._projectKey
                                          }
                                        >
                                          {(issue as ExternalIssue)
                                            ._projectName ||
                                            (issue as ExternalIssue)
                                              ._projectKey}
                                        </Badge>
                                      )}
                                  </span>
                                </h4>
                              </div>
                              {issue.description && (
                                <p className="text-sm text-muted-foreground line-clamp-4 wrap-break-word">
                                  {stripHtmlTags(issue.description).replace(
                                    /\s+/g,
                                    " "
                                  )}
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                {issue.priority && (
                                  <IssuePriorityDisplay
                                    priority={issue.priority}
                                  />
                                )}
                                {(issue.externalStatus || issue.status) && (
                                  <IssueStatusDisplay
                                    status={
                                      issue.externalStatus || issue.status
                                    }
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
                                  className="h-8 w-8 shrink-0 text-muted-foreground hover:opacity-50 cursor-pointer"
                                  title={t(
                                    "common.ui.issues.openInExternalSystem",
                                    {
                                      provider:
                                        activeIntegration?.integration.name ??
                                        "",
                                    }
                                  )}
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

      {/* Jira always uses the dedicated CreateIssueJiraForm so issue-type
          metadata, dynamic custom fields, and the rich TipTap description
          editor all load correctly. When opened from the "create linked
          Issue" flow (INT-05), the iteration prefill threads through as
          `defaultValues` — the form already accepts a TipTap doc on the
          description field, and the adapter converts to ADF (D-15). */}
      {showCreateDialog &&
        activeIntegration?.integration.provider === "JIRA" && (
          <CreateIssueJiraForm
            open={showCreateDialog}
            onOpenChange={setShowCreateDialog}
            projectId={projectId}
            integrationId={activeIntegration.integrationId}
            projectIntegrationId={activeIntegration.id}
            defaultValues={
              iterationPrefill
                ? {
                    title: iterationPrefill.title,
                    description: iterationPrefill.description as
                      string | Record<string, unknown> | null,
                  }
                : undefined
            }
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
                void pollForCreatedIssue(createdIssue.key);
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
            defaultValues={
              iterationPrefill
                ? {
                    title: iterationPrefill.title,
                    description: iterationPrefill.description as any,
                  }
                : undefined
            }
            onIssueCreated={(createdIssue) => {
              // Close the create dialog
              setShowCreateDialog(false);

              // Set the search query to the newly created issue key or title
              // This will trigger the search and show the new issue
              const searchKey =
                createdIssue.key ||
                createdIssue.externalKey ||
                createdIssue.title ||
                createdIssue.name;
              if (searchKey) {
                setSearchQuery(searchKey);
                if (createdIssue.key || createdIssue.externalKey) {
                  void pollForCreatedIssue(
                    createdIssue.key || createdIssue.externalKey
                  );
                }
              }
            }}
          />
        )}
    </>
  );
}
