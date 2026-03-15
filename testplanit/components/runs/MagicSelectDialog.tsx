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
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle, CheckCircle2, Info, RefreshCw, Settings2, Sparkles
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

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
    metadata: null,
  });

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

  // Run magic select (single request — server handles batching internally)
  const runMagicSelect = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      status: "loading",
      errorMessage: null,
      suggestedCaseIds: [],
      originalSuggestedCaseIds: [],
      reasoning: "",
    }));

    try {
      const response = await fetch("/api/llm/magic-select-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          testRunMetadata,
          clarification: clarification || undefined,
          excludeCaseIds:
            currentSelection.length > 0 ? currentSelection : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.details || data.error || "Failed to select test cases"
        );
      }

      const suggestedIds = data.suggestedCaseIds ?? [];

      setState((prev) => ({
        ...prev,
        status: "success",
        suggestedCaseIds: suggestedIds,
        originalSuggestedCaseIds: suggestedIds,
        reasoning: data.reasoning || "",
        errorMessage: null,
        metadata: data.metadata
          ? {
              totalCasesAnalyzed: data.metadata.totalCasesAnalyzed,
              suggestedCount: data.metadata.suggestedCount,
              directlySelected: data.metadata.directlySelected || 0,
              linkedCasesAdded: data.metadata.linkedCasesAdded || 0,
              model: data.metadata.model || "",
              tokens: data.metadata.tokens || { prompt: 0, completion: 0, total: 0 },
            }
          : null,
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
  }, [
    projectId,
    testRunMetadata,
    clarification,
    currentSelection,
  ]);

  // Auto-fetch count when dialog opens
  useEffect(() => {
    if (open) {
      fetchCaseCount();
    }
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
          reasoning: "",
          errorMessage: null,
          totalCaseCount: 0,
          repositoryTotalCount: 0,
          searchPreFiltered: false,
          searchKeywords: undefined,
          hitMaxSearchResults: false,
          noSearchMatches: false,
          metadata: null,
        });
        setClarification("");
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
              <LoadingSpinner className="h-8 w-8" />
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
