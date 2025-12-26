"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Settings2,
  Info,
} from "lucide-react";

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

interface BatchProgress {
  currentBatch: number;
  totalBatches: number;
  casesProcessed: number;
  totalCases: number;
}

interface MagicSelectState {
  status: "idle" | "counting" | "configuring" | "loading" | "success" | "error";
  suggestedCaseIds: number[];
  originalSuggestedCaseIds: number[]; // Original LLM suggestions (before user edits)
  reasoning: string[];
  errorMessage: string | null;
  totalCaseCount: number; // Effective count after search filtering
  repositoryTotalCount: number; // Original total in repository
  searchPreFiltered: boolean;
  searchKeywords?: string;
  hitMaxSearchResults: boolean; // True if search results were capped at max
  noSearchMatches: boolean; // True if search was performed but found no matches
  batchProgress: BatchProgress | null;
  metadata: {
    totalCasesAnalyzed: number;
    suggestedCount: number;
    directlySelected: number;
    linkedCasesAdded: number;
    model: string;
    tokens: { prompt: number; completion: number; total: number };
  } | null;
}

// Percentage options for batch sizes
const BATCH_PERCENTAGES = [10, 20, 30, 40, 50] as const;

// Minimum test case count to enable batching UI
const BATCH_THRESHOLD = 200;

const DEFAULT_BATCH_SIZE = "all";

// Generate dynamic batch size options based on total case count
function getBatchSizeOptions(
  totalCaseCount: number
): Array<{ value: string; count: number; percent?: number }> {
  const options: Array<{ value: string; count: number; percent?: number }> = [
    { value: "all", count: totalCaseCount },
  ];

  // Add percentage-based options
  for (const percent of BATCH_PERCENTAGES) {
    const count = Math.ceil(totalCaseCount * (percent / 100));
    // Only add if it results in more than 1 batch and count is reasonable (at least 10)
    if (count < totalCaseCount && count >= 10) {
      options.push({ value: String(count), count, percent });
    }
  }

  return options;
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
    reasoning: [],
    errorMessage: null,
    totalCaseCount: 0,
    repositoryTotalCount: 0,
    searchPreFiltered: false,
    searchKeywords: undefined,
    hitMaxSearchResults: false,
    noSearchMatches: false,
    batchProgress: null,
    metadata: null,
  });

  const [clarification, setClarification] = useState("");
  const [batchSize, setBatchSize] = useState<string>(DEFAULT_BATCH_SIZE);

  // Get effective batch size as number (for "all", use total count)
  const getEffectiveBatchSize = useCallback(
    (total: number) => (batchSize === "all" ? total : parseInt(batchSize, 10)),
    [batchSize]
  );

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

  // Run magic select with batching
  const runMagicSelect = useCallback(async () => {
    const effectiveBatchSize = getEffectiveBatchSize(state.totalCaseCount);
    const totalBatches = Math.ceil(state.totalCaseCount / effectiveBatchSize);

    setState((prev) => ({
      ...prev,
      status: "loading",
      errorMessage: null,
      suggestedCaseIds: [],
      originalSuggestedCaseIds: [],
      reasoning: [],
      batchProgress: {
        currentBatch: 0,
        totalBatches,
        casesProcessed: 0,
        totalCases: state.totalCaseCount,
      },
    }));

    const allSuggestedIds: number[] = [];
    const allReasonings: string[] = [];
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let model = "";
    let directlySelected = 0;
    let linkedCasesAdded = 0;

    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // Update progress
        setState((prev) => ({
          ...prev,
          batchProgress: {
            currentBatch: batchIndex + 1,
            totalBatches,
            casesProcessed: batchIndex * effectiveBatchSize,
            totalCases: state.totalCaseCount,
          },
        }));

        // For "all" mode, don't send batchSize/batchIndex (no pagination)
        const requestBody: Record<string, unknown> = {
          projectId,
          testRunMetadata,
          clarification: clarification || undefined,
          excludeCaseIds:
            currentSelection.length > 0 ? currentSelection : undefined,
        };

        // Only add pagination params if batching
        if (batchSize !== "all") {
          requestBody.batchSize = effectiveBatchSize;
          requestBody.batchIndex = batchIndex;
        }

        const response = await fetch("/api/llm/magic-select-cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.details || data.error || "Failed to select test cases"
          );
        }

        // Aggregate results
        if (data.suggestedCaseIds?.length > 0) {
          allSuggestedIds.push(...data.suggestedCaseIds);
        }
        if (data.reasoning) {
          allReasonings.push(data.reasoning);
        }
        if (data.metadata) {
          totalTokens.prompt += data.metadata.tokens?.prompt || 0;
          totalTokens.completion += data.metadata.tokens?.completion || 0;
          totalTokens.total += data.metadata.tokens?.total || 0;
          model = data.metadata.model || model;
          directlySelected += data.metadata.directlySelected || 0;
          linkedCasesAdded += data.metadata.linkedCasesAdded || 0;
        }
      }

      // Deduplicate suggested IDs
      const uniqueSuggestedIds = [...new Set(allSuggestedIds)];

      setState((prev) => ({
        ...prev,
        status: "success",
        suggestedCaseIds: uniqueSuggestedIds,
        originalSuggestedCaseIds: uniqueSuggestedIds, // Keep original for checkbox display
        reasoning: allReasonings,
        errorMessage: null,
        batchProgress: null,
        metadata: {
          totalCasesAnalyzed: prev.totalCaseCount,
          suggestedCount: uniqueSuggestedIds.length,
          directlySelected,
          linkedCasesAdded,
          model,
          tokens: totalTokens,
        },
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        batchProgress: null,
      }));
    }
  }, [
    projectId,
    testRunMetadata,
    clarification,
    currentSelection,
    batchSize,
    state.totalCaseCount,
    getEffectiveBatchSize,
  ]);

  // Auto-fetch count when dialog opens
  // We track the previous open state to detect when it transitions from closed to open
  useEffect(() => {
    if (open) {
      // Always fetch when dialog opens (state will be idle after reset)
      fetchCaseCount();
    }
    // Only depend on `open` - we want to fetch every time dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        // Reset state when closing
        setState({
          status: "idle",
          suggestedCaseIds: [],
          originalSuggestedCaseIds: [],
          reasoning: [],
          errorMessage: null,
          totalCaseCount: 0,
          repositoryTotalCount: 0,
          searchPreFiltered: false,
          searchKeywords: undefined,
          hitMaxSearchResults: false,
          noSearchMatches: false,
          batchProgress: null,
          metadata: null,
        });
        setClarification("");
        setBatchSize(DEFAULT_BATCH_SIZE);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
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

  const batchesNeeded =
    batchSize === "all"
      ? 1
      : Math.ceil(state.totalCaseCount / parseInt(batchSize, 10));
  const progressPercent = state.batchProgress
    ? (state.batchProgress.currentBatch / state.batchProgress.totalBatches) *
      100
    : 0;

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

          {/* Configuring State - Show batch settings */}
          {state.status === "configuring" && (
            <div className="space-y-4">
              <Alert>
                <Settings2 className="h-4 w-4" />
                <AlertTitle>{t("configure.title")}</AlertTitle>
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
                {/* Only show batch size selector when there are many test cases */}
                {state.totalCaseCount > BATCH_THRESHOLD && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="batchSize">
                        {t("configure.batchSize")}
                      </Label>
                      <Select value={batchSize} onValueChange={setBatchSize}>
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getBatchSizeOptions(state.totalCaseCount).map(
                            (option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.value === "all"
                                  ? t("configure.batchSizeAll")
                                  : t("configure.batchSizePercent", {
                                      percent: option.percent ?? 0,
                                      count: option.count,
                                    })}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                      <p>
                        {t("configure.requestsNeeded", {
                          count: batchesNeeded,
                        })}
                      </p>
                      {batchesNeeded > 1 && (
                        <p className="mt-1 text-xs">
                          {t("configure.batchNote")}
                        </p>
                      )}
                    </div>
                  </>
                )}

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

          {/* Loading State with Progress */}
          {state.status === "loading" && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <LoadingSpinner className="h-8 w-8" />
              {state.batchProgress && state.batchProgress.totalBatches > 1 && (
                <>
                  <div className="w-full max-w-xs space-y-2">
                    <Progress value={progressPercent} className="h-2" />
                    <p className="text-sm text-muted-foreground text-center">
                      {t("loading.batch", {
                        current: state.batchProgress.currentBatch,
                        total: state.batchProgress.totalBatches,
                      })}
                    </p>
                  </div>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                {t("loading.analyzing")}
              </p>
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
                  {state.reasoning.length > 0 && (
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 max-h-32 overflow-y-auto">
                      <Label className="text-xs font-medium">
                        {t("reasoning")}
                      </Label>
                      {state.reasoning.map((r, i) => (
                        <p key={i} className="mt-1">
                          {state.reasoning.length > 1 && `Batch ${i + 1}: `}
                          {r}
                        </p>
                      ))}
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
                          <Badge variant="outline" className="mr-2">
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
              {batchesNeeded > 1
                ? t("actions.startBatched", { count: batchesNeeded })
                : t("actions.start")}
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
