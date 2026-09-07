"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WizardStepIndicator } from "@/components/ui/WizardStepIndicator";
import { GitCompareArrows, Radar, Radio, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer } from "react";
import {
  useImpactAnalysis,
  type ImpactAnalysisCaseRow,
} from "~/hooks/useImpactAnalysis";
import type { CommitRef } from "./CommitPicker";
import { AffectedTestsStep } from "./steps/AffectedTestsStep";
import { AnalysisProgressStep } from "./steps/AnalysisProgressStep";
import { CommitPickerStep } from "./steps/CommitPickerStep";
import { DiffReviewStep } from "./steps/DiffReviewStep";

export interface ImpactRepoConfig {
  id: number;
  repositoryId: number;
  branch: string | null;
}

export type CompareFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface CompareFile {
  path: string;
  previousPath?: string;
  status: CompareFileStatus;
  additions: number;
  deletions: number;
  patch?: string;
  patchTruncated?: boolean;
  isBinary: boolean;
}

export interface CompareResponse {
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  files: CompareFile[];
  commits: CommitRef[];
  truncated: boolean;
  aheadBy?: number;
  behindBy?: number;
  cached: boolean;
}

export type CompareErrorCode = "sameCommit" | "refNotFound" | "compareFailed";

export type ImpactStep = "pick" | "diff" | "running" | "review";

export const IMPACT_STEPS: ImpactStep[] = ["pick", "diff", "running", "review"];

export interface ImpactDialogState {
  step: ImpactStep;
  branch: string | null;
  base: CommitRef | null;
  head: CommitRef | null;
  swapped: boolean;
  compare: CompareResponse | null;
  compareError: CompareErrorCode | null;
  expandedFileIndex: number | null;
  aiAvailable: boolean;
  reused: boolean;
  cases: ImpactAnalysisCaseRow[];
  selectedCaseIds: number[];
  pinnedUncovered: Record<string, number>;
}

export type ImpactDialogAction =
  | { type: "SET_BRANCH"; branch: string | null }
  | { type: "SET_BASE"; commit: CommitRef | null }
  | { type: "SET_HEAD"; commit: CommitRef | null }
  | { type: "COMPARE" }
  | { type: "COMPARE_LOADED"; compare: CompareResponse }
  | { type: "COMPARE_FAILED"; error: CompareErrorCode }
  | { type: "TOGGLE_FILE"; index: number }
  | { type: "BACK" }
  | { type: "ANALYSIS_STARTED" }
  | { type: "ANALYSIS_META"; aiAvailable: boolean; reused: boolean }
  | { type: "ANALYSIS_COMPLETED"; cases: ImpactAnalysisCaseRow[] }
  | { type: "TOGGLE_CASE"; caseId: number }
  | { type: "SET_SELECTION"; caseIds: number[] }
  | { type: "PIN_CREATED"; path: string; caseId: number }
  | { type: "RESET" };

export const initialImpactDialogState: ImpactDialogState = {
  step: "pick",
  branch: null,
  base: null,
  head: null,
  swapped: false,
  compare: null,
  compareError: null,
  expandedFileIndex: null,
  aiAvailable: true,
  reused: false,
  cases: [],
  selectedCaseIds: [],
  pinnedUncovered: {},
};

export function isSameCommit(state: ImpactDialogState): boolean {
  return (
    state.base !== null &&
    state.head !== null &&
    state.base.sha === state.head.sha
  );
}

export function canCompare(state: ImpactDialogState): boolean {
  return state.base !== null && state.head !== null && !isSameCommit(state);
}

export function defaultSelection(cases: ImpactAnalysisCaseRow[]): number[] {
  return cases
    .filter((row) => row.tier === "pinned" || row.tier === "affected")
    .map((row) => row.caseId);
}

export function shouldSwap(compare: CompareResponse): boolean {
  return compare.aheadBy === 0 && (compare.behindBy ?? 0) > 0;
}

export function impactDialogReducer(
  state: ImpactDialogState,
  action: ImpactDialogAction
): ImpactDialogState {
  switch (action.type) {
    case "SET_BRANCH":
      return { ...state, branch: action.branch };
    case "SET_BASE":
      return {
        ...state,
        base: action.commit,
        compare: null,
        compareError: null,
        swapped: false,
        expandedFileIndex: null,
      };
    case "SET_HEAD":
      return {
        ...state,
        head: action.commit,
        compare: null,
        compareError: null,
        swapped: false,
        expandedFileIndex: null,
      };
    case "COMPARE":
      if (!canCompare(state)) return state;
      return {
        ...state,
        step: "diff",
        compareError: null,
        expandedFileIndex: null,
      };
    case "COMPARE_LOADED":
      if (!state.swapped && shouldSwap(action.compare)) {
        return {
          ...state,
          base: state.head,
          head: state.base,
          swapped: true,
          compare: null,
          compareError: null,
          expandedFileIndex: null,
        };
      }
      return {
        ...state,
        compare: action.compare,
        compareError: null,
      };
    case "COMPARE_FAILED":
      return { ...state, compare: null, compareError: action.error };
    case "TOGGLE_FILE":
      return {
        ...state,
        expandedFileIndex:
          state.expandedFileIndex === action.index ? null : action.index,
      };
    case "BACK":
      if (state.step === "diff") {
        return { ...state, step: "pick" };
      }
      if (state.step === "review" || state.step === "running") {
        return {
          ...state,
          step: "diff",
          cases: [],
          selectedCaseIds: [],
          pinnedUncovered: {},
          reused: false,
        };
      }
      return state;
    case "ANALYSIS_STARTED":
      return {
        ...state,
        step: "running",
        aiAvailable: true,
        reused: false,
        cases: [],
        selectedCaseIds: [],
        pinnedUncovered: {},
      };
    case "ANALYSIS_META":
      return {
        ...state,
        aiAvailable: action.aiAvailable,
        reused: action.reused,
      };
    case "ANALYSIS_COMPLETED":
      return {
        ...state,
        step: "review",
        cases: action.cases,
        selectedCaseIds: defaultSelection(action.cases),
        pinnedUncovered: {},
      };
    case "TOGGLE_CASE":
      return {
        ...state,
        selectedCaseIds: state.selectedCaseIds.includes(action.caseId)
          ? state.selectedCaseIds.filter((id) => id !== action.caseId)
          : [...state.selectedCaseIds, action.caseId],
      };
    case "SET_SELECTION":
      return { ...state, selectedCaseIds: [...new Set(action.caseIds)] };
    case "PIN_CREATED":
      return {
        ...state,
        pinnedUncovered: {
          ...state.pinnedUncovered,
          [action.path]: action.caseId,
        },
        selectedCaseIds: state.selectedCaseIds.includes(action.caseId)
          ? state.selectedCaseIds
          : [...state.selectedCaseIds, action.caseId],
      };
    case "RESET":
      return initialImpactDialogState;
    default:
      return state;
  }
}

export function compareUrl(
  repositoryId: number,
  configId: number,
  base: string,
  head: string
): string {
  const search = new URLSearchParams({
    configId: String(configId),
    base,
    head,
  });
  return `/api/code-repositories/${repositoryId}/compare?${search.toString()}`;
}

interface ImpactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  config: ImpactRepoConfig;
  currentSelection: number[];
  onAccept: (caseIds: number[], info: { analysisId: number }) => void;
}

export function ImpactDialog({
  open,
  onOpenChange,
  projectId,
  config,
  currentSelection,
  onAccept,
}: ImpactDialogProps) {
  const t = useTranslations("runs.impact");
  const tCommon = useTranslations("common");
  const [state, dispatch] = useReducer(
    impactDialogReducer,
    initialImpactDialogState
  );
  const analysis = useImpactAnalysis(projectId);
  const { start, cancel, reset } = analysis;

  const baseSha = state.base?.sha ?? null;
  const headSha = state.head?.sha ?? null;

  useEffect(() => {
    if (
      !open ||
      state.step !== "diff" ||
      state.compare !== null ||
      state.compareError !== null ||
      baseSha === null ||
      headSha === null
    ) {
      return;
    }
    const controller = new AbortController();
    fetch(compareUrl(config.repositoryId, config.id, baseSha, headSha), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok) {
          dispatch({
            type: "COMPARE_LOADED",
            compare: data as CompareResponse,
          });
          return;
        }
        dispatch({
          type: "COMPARE_FAILED",
          error:
            response.status === 400
              ? "sameCommit"
              : response.status === 404
                ? "refNotFound"
                : "compareFailed",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        dispatch({ type: "COMPARE_FAILED", error: "compareFailed" });
      });
    return () => controller.abort();
  }, [
    open,
    state.step,
    state.compare,
    state.compareError,
    baseSha,
    headSha,
    config.repositoryId,
    config.id,
  ]);

  useEffect(() => {
    if (state.step !== "running") return;
    if (analysis.status === "COMPLETED" && analysis.result) {
      dispatch({ type: "ANALYSIS_COMPLETED", cases: analysis.result.cases });
    }
  }, [state.step, analysis.status, analysis.result]);

  const isAnalysisActive =
    analysis.status === "PENDING" || analysis.status === "RUNNING";

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        if (state.step === "running" && isAnalysisActive) {
          cancel();
        }
        reset();
        dispatch({ type: "RESET" });
      }
      onOpenChange(nextOpen);
    },
    [state.step, isAnalysisActive, cancel, reset, onOpenChange]
  );

  const handleAnalyze = useCallback(() => {
    if (!state.compare) return;
    const { baseSha: base, headSha: head } = state.compare;
    dispatch({ type: "ANALYSIS_STARTED" });
    start({
      base,
      head,
      excludeCaseIds: currentSelection,
      force: analysis.analysisId !== null,
    })
      .then((meta) => {
        dispatch({
          type: "ANALYSIS_META",
          aiAvailable: meta.aiAvailable,
          reused: meta.reused,
        });
      })
      .catch(() => {});
  }, [state.compare, start, currentSelection, analysis.analysisId]);

  const handleCancelAnalysis = useCallback(() => {
    cancel();
  }, [cancel]);

  const handleBack = useCallback(() => {
    if (state.step === "running") {
      if (isAnalysisActive) cancel();
      reset();
    }
    if (state.step === "review") {
      reset();
    }
    dispatch({ type: "BACK" });
  }, [state.step, isAnalysisActive, cancel, reset]);

  const handleAccept = useCallback(() => {
    if (analysis.analysisId === null) return;
    onAccept(state.selectedCaseIds, { analysisId: analysis.analysisId });
    handleOpenChange(false);
  }, [analysis.analysisId, state.selectedCaseIds, onAccept, handleOpenChange]);

  const stepIndex = IMPACT_STEPS.indexOf(state.step);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[960px] max-h-[90vh] flex flex-col"
        data-testid="impact-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <WizardStepIndicator
          currentStep={stepIndex + 1}
          totalSteps={IMPACT_STEPS.length}
          labels={[
            t("steps.pick"),
            t("steps.diff"),
            t("steps.analyze"),
            t("steps.review"),
          ]}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          {state.step === "pick" && (
            <CommitPickerStep
              projectId={projectId}
              config={config}
              branch={state.branch}
              base={state.base}
              head={state.head}
              sameCommit={isSameCommit(state)}
              onBranchChange={(branch) =>
                dispatch({ type: "SET_BRANCH", branch })
              }
              onBaseChange={(commit) => dispatch({ type: "SET_BASE", commit })}
              onHeadChange={(commit) => dispatch({ type: "SET_HEAD", commit })}
            />
          )}
          {state.step === "diff" && (
            <DiffReviewStep
              compare={state.compare}
              loading={state.compare === null && state.compareError === null}
              error={state.compareError}
              swapped={state.swapped}
              base={state.base}
              head={state.head}
              expandedIndex={state.expandedFileIndex}
              onToggleFile={(index) => dispatch({ type: "TOGGLE_FILE", index })}
            />
          )}
          {state.step === "running" && (
            <AnalysisProgressStep
              status={analysis.status}
              progress={analysis.progress}
              reused={state.reused}
              aiAvailable={state.aiAvailable}
              error={analysis.error}
            />
          )}
          {state.step === "review" && (
            <AffectedTestsStep
              projectId={projectId}
              config={config}
              cases={state.cases}
              result={analysis.result?.analysis.result ?? null}
              selectedCaseIds={state.selectedCaseIds}
              onToggleCase={(caseId) =>
                dispatch({ type: "TOGGLE_CASE", caseId })
              }
              onSetSelection={(caseIds) =>
                dispatch({ type: "SET_SELECTION", caseIds })
              }
              pinnedUncovered={state.pinnedUncovered}
              onPinCreated={(path, caseId) =>
                dispatch({ type: "PIN_CREATED", path, caseId })
              }
            />
          )}
        </div>

        <DialogFooter className="items-center gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            {state.step === "pick" && (
              <Button
                onClick={() => dispatch({ type: "COMPARE" })}
                disabled={!canCompare(state)}
                data-testid="impact-compare"
              >
                <GitCompareArrows className="h-4 w-4" />
                {t("actions.compare")}
              </Button>
            )}
            {state.step === "diff" && (
              <>
                <Button variant="outline" onClick={handleBack}>
                  {t("actions.back")}
                </Button>
                <Button
                  onClick={handleAnalyze}
                  disabled={
                    state.compare === null || state.compare.files.length === 0
                  }
                  data-testid="impact-analyze"
                >
                  <Radar className="h-4 w-4" />
                  {t("actions.analyze")}
                </Button>
              </>
            )}
            {state.step === "running" &&
              (isAnalysisActive ? (
                <Button
                  variant="outline"
                  onClick={handleCancelAnalysis}
                  data-testid="impact-cancel-analysis"
                >
                  <XCircle className="h-4 w-4" />
                  {t("actions.cancelAnalysis")}
                </Button>
              ) : (
                <Button variant="outline" onClick={handleBack}>
                  {t("actions.back")}
                </Button>
              ))}
            {state.step === "review" && (
              <>
                <Button variant="outline" onClick={handleBack}>
                  {t("actions.refine")}
                </Button>
                <Button
                  onClick={handleAccept}
                  disabled={state.selectedCaseIds.length === 0}
                  data-testid="impact-accept"
                >
                  {t("actions.accept", { count: state.selectedCaseIds.length })}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
