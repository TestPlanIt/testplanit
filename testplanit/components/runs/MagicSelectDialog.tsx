"use client";

import LoadingSpinner from "@/components/LoadingSpinner";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  RefreshCw,
  ListTree,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface MagicSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  testRunMetadata: {
    name: string;
    description: string | null;
    docs: string | null;
    linkedIssueIds: number[];
    tags?: string[];
  };
  currentSelection: number[];
  onAccept: (suggestedCaseIds: number[]) => void;
}

interface MagicSelectState {
  status: "idle" | "counting" | "configuring" | "loading" | "success" | "error";
  suggestedCaseIds: number[];
  originalSuggestedCaseIds: number[]; // Original LLM suggestions (before user edits)
  reasoning: string;
  errorMessage: string | null;
  totalCaseCount: number; // Effective count after search filtering
  repositoryTotalCount: number; // Original total in repository
  searchPreFiltered: boolean;
  searchKeywords?: string;
  hitMaxSearchResults: boolean; // True if search results were capped at max
  noSearchMatches: boolean; // True if search was performed but found no matches
  jobId: string | null; // Track active job ID for polling
  truncatedBatches: number[]; // Batch indices with incomplete results (RETRY-05)
  progress: {
    phase: string;
    message: string;
    analyzed: number;
    total: number;
    batchesCompleted: number;
    batchesTotal: number;
    selectedSoFar: number;
  } | null;
  metadata: {
    totalCasesAnalyzed: number;
    suggestedCount: number;
    directlySelected: number;
    linkedCasesAdded: number;
    model: string;
    tokens: { prompt: number; completion: number; total: number };
  } | null;
}

export function MagicSelectDialog({
  open,
  onOpenChange,
  projectId,
  testRunMetadata,
  currentSelection,
  onAccept,
}: MagicSelectDialogProps) {
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const t = useTranslations("runs.magicSelect");

  const [state, setState] = useState<MagicSelectState>({
    status: "idle",
    suggestedCaseIds: [],
    originalSuggestedCaseIds: [],
    reasoning: "",
    errorMessage: null,
    totalCaseCount: 0,
    repositoryTotalCount: 0,
    searchPreFiltered: false,
    searchKeywords: undefined,
    hitMaxSearchResults: false,
    noSearchMatches: false,
    jobId: null,
    truncatedBatches: [],
    progress: null,
    metadata: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const [clarification, setClarification] = useState("");

  // Fetch total case count when dialog opens
  const fetchCaseCount = useCallback(async () => {
    // Guard: require a test run name before making API call
    if (!testRunMetadata.name || testRunMetadata.name.trim() === "") {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: t("errors.noTestRunName"),
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: "counting",
      errorMessage: null,
    }));

    try {
      const response = await fetch("/api/llm/magic-select-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          testRunMetadata,
          countOnly: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.details || data.error || "Failed to count test cases"
        );
      }

      setState((prev) => ({
        ...prev,
        status: "configuring",
        totalCaseCount: data.totalCaseCount,
        repositoryTotalCount: data.repositoryTotalCount ?? data.totalCaseCount,
        searchPreFiltered: data.searchPreFiltered ?? false,
        searchKeywords: data.searchKeywords,
        hitMaxSearchResults: data.hitMaxSearchResults ?? false,
        noSearchMatches: data.noSearchMatches ?? false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      }));
    }
  }, [projectId, t, testRunMetadata]);

  // Run magic select (submit job then poll for completion)
  const runMagicSelect = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      status: "loading",
      errorMessage: null,
      suggestedCaseIds: [],
      originalSuggestedCaseIds: [],
      reasoning: "",
      jobId: null,
      truncatedBatches: [],
      progress: null,
    }));

    // Create AbortController for cleanup on dialog close
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Phase 1: Submit job
      const submitResponse = await fetch("/api/llm/magic-select-cases/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          testRunMetadata,
          clarification: clarification || undefined,
          excludeCaseIds:
            currentSelection.length > 0 ? currentSelection : undefined,
        }),
        signal: controller.signal,
      });

      const submitData = await submitResponse.json();

      if (!submitResponse.ok) {
        const errorMessage =
          typeof submitData.details === "string"
            ? submitData.details
            : submitData.error || "Failed to submit magic select job";
        throw new Error(errorMessage);
      }

      const jobId = submitData.jobId;
      setState((prev) => ({ ...prev, jobId }));

      // Phase 2: Poll for completion
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLL_ATTEMPTS = 300; // 10 minutes max (300 * 2s)
      let attempts = 0;

      while (attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;

        const statusResponse = await fetch(
          `/api/llm/magic-select-cases/status/${jobId}`,
          { signal: controller.signal }
        );
        const statusData = await statusResponse.json();

        if (!statusResponse.ok) {
          throw new Error(statusData.error || "Failed to check job status");
        }

        // Update progress if available
        if (statusData.progress) {
          setState((prev) => ({
            ...prev,
            progress: {
              phase: statusData.progress.phase ?? "setup",
              message: statusData.progress.message ?? "",
              analyzed: statusData.progress.analyzed ?? 0,
              total: statusData.progress.total ?? 0,
              batchesCompleted: statusData.progress.batchesCompleted ?? 0,
              batchesTotal: statusData.progress.batchesTotal ?? 0,
              selectedSoFar: statusData.progress.selectedSoFar ?? 0,
            },
          }));
        }

        if (statusData.state === "completed" && statusData.result) {
          const result = statusData.result;
          const suggestedIds = result.suggestedCaseIds ?? [];

          setState((prev) => ({
            ...prev,
            status: "success",
            suggestedCaseIds: suggestedIds,
            originalSuggestedCaseIds: suggestedIds,
            reasoning: result.reasoning || "",
            truncatedBatches: result.truncatedBatches ?? [],
            errorMessage: null,
            progress: null,
            metadata: result.metadata
              ? {
                  totalCasesAnalyzed: result.metadata.totalCasesAnalyzed,
                  suggestedCount: result.metadata.suggestedCount,
                  directlySelected: result.metadata.directlySelected || 0,
                  linkedCasesAdded: result.metadata.linkedCasesAdded || 0,
                  model: result.metadata.model || "",
                  tokens: result.metadata.tokens || {
                    prompt: 0,
                    completion: 0,
                    total: 0,
                  },
                }
              : null,
          }));
          return; // Done
        }

        if (statusData.state === "failed") {
          throw new Error(statusData.failedReason || "Magic select job failed");
        }
      }

      // Timed out
      throw new Error("Magic select job timed out after 10 minutes");
    } catch (error) {
      // Ignore abort errors from dialog close
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setState((prev) => ({
        ...prev,
        status: "error",
        progress: null,
        errorMessage:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      }));
    }
  }, [projectId, testRunMetadata, clarification, currentSelection]);

  // Auto-fetch count when dialog opens
  useEffect(() => {
    if (open) {
      fetchCaseCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cleanup: abort any in-flight polling when component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        // Abort any active polling when dialog closes
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        // Cancel the background job if one is active
        if (state.jobId && state.status === "loading") {
          fetch(`/api/llm/magic-select-cases/cancel/${state.jobId}`, {
            method: "POST",
          }).catch(() => {
            // Best-effort cancel — ignore errors
          });
        }
        // Reset state when closing
        setState({
          status: "idle",
          suggestedCaseIds: [],
          originalSuggestedCaseIds: [],
          reasoning: "",
          errorMessage: null,
          totalCaseCount: 0,
          repositoryTotalCount: 0,
          searchPreFiltered: false,
          searchKeywords: undefined,
          hitMaxSearchResults: false,
          noSearchMatches: false,
          jobId: null,
          truncatedBatches: [],
          progress: null,
          metadata: null,
        });
        setClarification("");
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, state.jobId, state.status]
  );

  const handleAccept = useCallback(() => {
    onAccept(state.suggestedCaseIds);
    handleOpenChange(false);
  }, [state.suggestedCaseIds, onAccept, handleOpenChange]);

  const handleRefine = useCallback(() => {
    // Go back to configuring state to allow re-running
    setState((prev) => ({
      ...prev,
      status: "configuring",
    }));
  }, []);

  // Handle selection changes from the drawer
  const handleSelectionChange = useCallback((newSelection: number[]) => {
    setState((prev) => ({
      ...prev,
      suggestedCaseIds: newSelection,
    }));
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Counting State */}
          {state.status === "counting" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <LoadingSpinner className="h-8 w-8" />
              <p className="text-sm text-muted-foreground">{t("counting")}</p>
            </div>
          )}

          {/* Configuring State - Show settings */}
          {state.status === "configuring" && (
            <div className="space-y-4">
              <Alert>
                <div className="flex gap-1">
                  <ListTree className="h-4 w-4" />
                  <AlertTitle>{t("configure.title")}</AlertTitle>
                </div>
                <AlertDescription>
                  {state.searchPreFiltered ? (
                    <>
                      {t("configure.descriptionFiltered", {
                        count: state.totalCaseCount,
                        total: state.repositoryTotalCount,
                      })}
                    </>
                  ) : (
                    t("configure.description", { count: state.totalCaseCount })
                  )}
                </AlertDescription>
              </Alert>

              {/* Warning: No search matches - need more context */}
              {state.noSearchMatches && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>{t("configure.noMatchesTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("configure.noMatchesDescription")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Warning: Hit max search results - too broad */}
              {state.hitMaxSearchResults && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>{t("configure.maxResultsTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("configure.maxResultsDescription")}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-3">
                {/* Clarification Input */}
                <div className="space-y-2">
                  <Label htmlFor="clarification">
                    {t("clarification.label")}
                  </Label>
                  <Textarea
                    id="clarification"
                    value={clarification}
                    onChange={(e) => setClarification(e.target.value)}
                    placeholder={t("clarification.placeholder")}
                    className="min-h-[80px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {state.status === "loading" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              {state.progress?.phase === "ai" && state.progress.total > 0 ? (
                <div className="w-full max-w-xs space-y-3">
                  {state.progress.analyzed > 0 ? (
                    <Progress
                      value={Math.round(
                        (state.progress.analyzed / state.progress.total) * 100
                      )}
                    />
                  ) : (
                    <Progress className="animate-pulse" />
                  )}
                  <div className="text-center space-y-1">
                    {state.progress.analyzed > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("loading.progress", {
                          analyzed: state.progress.analyzed,
                          total: state.progress.total,
                        })}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("loading.analyzing")}
                      </p>
                    )}
                    {state.progress.selectedSoFar > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("loading.selectedSoFar", {
                          count: state.progress.selectedSoFar,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ) : state.progress?.phase === "setup" ? (
                <div className="w-full max-w-xs space-y-3">
                  <Progress className="animate-pulse" />
                  <p className="text-sm text-muted-foreground text-center">
                    {state.progress.message === "resolving_integration"
                      ? t("loading.resolving_integration")
                      : state.progress.message === "fetching_cases"
                        ? t("loading.fetching_cases")
                        : t("loading.analyzing")}
                  </p>
                </div>
              ) : (
                <div className="w-full max-w-xs space-y-3">
                  <Progress className="animate-pulse" />
                  <p className="text-sm text-muted-foreground text-center">
                    {t("loading.analyzing")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {state.status === "error" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("errors.title")}</AlertTitle>
              <AlertDescription>
                {state.errorMessage || t("errors.generic")}
              </AlertDescription>
            </Alert>
          )}

          {/* Success State */}
          {state.status === "success" && (
            <>
              {state.suggestedCaseIds.length > 0 ? (
                <div className="space-y-4">
                  {/* Success Summary */}
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle className="flex items-center gap-2">
                      {t("success.title")}
                      <Badge variant="secondary">
                        {state.suggestedCaseIds.length}
                      </Badge>
                    </AlertTitle>
                    <AlertDescription>
                      {t("success.description", {
                        count: state.suggestedCaseIds.length,
                      })}
                      {state.metadata &&
                        state.metadata.linkedCasesAdded > 0 && (
                          <span className="block mt-1 text-xs">
                            {t("success.linkedCasesAdded", {
                              count: state.metadata.linkedCasesAdded,
                            })}
                          </span>
                        )}
                    </AlertDescription>
                  </Alert>

                  {/* Reasoning */}
                  {state.reasoning && (
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-32 overflow-y-auto">
                      <Label className="text-xs font-medium">
                        {t("reasoning")}
                      </Label>
                      <p className="mt-1">{state.reasoning}</p>
                    </div>
                  )}

                  {/* Review Drawer - uses checkboxes so users can toggle selections */}
                  <div className="flex justify-between items-center">
                    <Label>{t("reviewSelection")}</Label>
                    <SelectedTestCasesDrawer
                      selectedTestCases={state.suggestedCaseIds}
                      onSelectionChange={handleSelectionChange}
                      projectId={projectId}
                      isEditMode={true}
                      useCheckboxes={true}
                      allAvailableCases={state.originalSuggestedCaseIds}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Badge className="border border-primary-foreground">
                            {state.suggestedCaseIds.length}
                          </Badge>
                          {t("viewSuggested")}
                        </Button>
                      }
                    />
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("noSuggestions.title")}</AlertTitle>
                  <AlertDescription>
                    {t("noSuggestions.description")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Truncation warning */}
              {state.truncatedBatches.length > 0 && (
                <Alert variant="default" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t("success.truncationWarningTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("success.truncationWarning", {
                      count: state.truncatedBatches.length,
                    })}
                  </AlertDescription>
                </Alert>
              )}

              {/* Refine option */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleRefine}>
                  <RefreshCw className="h-4 w-4" />
                  {t("clarification.refine")}
                </Button>
              </div>

              {/* Token Usage */}
              {state.metadata && (
                <p className="text-xs text-muted-foreground">
                  {t("tokenUsage", { total: state.metadata.tokens.total })}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          {state.status === "configuring" && (
            <Button onClick={runMagicSelect}>
              <Sparkles className="h-4 w-4" />
              {t("actions.start")}
            </Button>
          )}
          {state.status === "success" && state.suggestedCaseIds.length > 0 && (
            <Button onClick={handleAccept}>
              <Sparkles className="h-4 w-4" />
              {t("actions.accept")}
            </Button>
          )}
          {state.status === "error" && (
            <Button onClick={fetchCaseCount}>
              <RefreshCw className="h-4 w-4" />
              {tGlobal("search.errors.tryAgain")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
