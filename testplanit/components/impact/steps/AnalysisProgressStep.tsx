"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  ImpactAnalysisError,
  ImpactAnalysisStatus,
} from "~/hooks/useImpactAnalysis";
import {
  IMPACT_PHASES,
  type ImpactProgress,
} from "~/lib/services/impact/types";

const KNOWN_MESSAGES = new Set<string>([...IMPACT_PHASES, "analyzing"]);

type Translator = (
  key: string,
  values?: Record<string, string | number | Date>
) => string;

export function impactErrorMessage(
  t: Translator,
  error: ImpactAnalysisError
): string {
  switch (error.code) {
    case "disabled":
      return t("errors.disabled");
    case "noConfig":
      return t("errors.noConfig");
    case "timeout":
      return t("errors.timeout");
    case "cancelled":
      return t("errors.cancelled");
    case "analysisFailed":
      return error.message
        ? t("errors.analysisFailed", { error: error.message })
        : t("errors.generic");
    default:
      return error.message || t("errors.generic");
  }
}

export function progressValue(
  progress: ImpactProgress | null
): number | undefined {
  if (!progress) return undefined;
  const phaseIndex = IMPACT_PHASES.indexOf(progress.phase);
  if (phaseIndex < 0) return undefined;
  const span = 100 / IMPACT_PHASES.length;
  const within =
    progress.casesToRank && progress.casesToRank > 0
      ? (progress.casesRanked ?? 0) / progress.casesToRank
      : 0;
  return Math.min(99, Math.round(phaseIndex * span + within * span));
}

interface AnalysisProgressStepProps {
  status: ImpactAnalysisStatus | null;
  progress: ImpactProgress | null;
  reused: boolean;
  aiAvailable: boolean;
  error: ImpactAnalysisError | null;
}

export function AnalysisProgressStep({
  status,
  progress,
  reused,
  aiAvailable,
  error,
}: AnalysisProgressStepProps) {
  const t = useTranslations("runs.impact");

  if (error && status !== "PENDING" && status !== "RUNNING") {
    return (
      <Alert variant="destructive" className="my-2" data-testid="impact-error">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t("errors.title")}</AlertTitle>
        <AlertDescription>{impactErrorMessage(t, error)}</AlertDescription>
      </Alert>
    );
  }

  const messageKey =
    progress && KNOWN_MESSAGES.has(progress.message)
      ? progress.message
      : progress && KNOWN_MESSAGES.has(progress.phase)
        ? progress.phase
        : "analyzing";
  const value = progressValue(progress);
  const hasRankingProgress =
    progress !== null &&
    typeof progress.casesToRank === "number" &&
    progress.casesToRank > 0;

  return (
    <div
      className="flex flex-col items-center justify-center space-y-4 py-10"
      data-testid="impact-progress"
    >
      <div className="w-full max-w-md space-y-3">
        <Progress
          value={value}
          className={value === undefined ? "animate-pulse" : undefined}
        />
        <div className="space-y-1 text-center">
          <p className="text-sm text-muted-foreground">
            {t(`loading.${messageKey}`)}
          </p>
          {hasRankingProgress && (
            <p className="text-xs text-muted-foreground">
              {t("loading.ranking", {
                current: progress?.casesRanked ?? 0,
                total: progress?.casesToRank ?? 0,
              })}
            </p>
          )}
          {reused && (
            <p className="text-xs text-muted-foreground">
              {t("loading.reused")}
            </p>
          )}
        </div>
      </div>
      {!aiAvailable && (
        <p
          className="flex max-w-md items-start gap-2 text-xs text-muted-foreground"
          data-testid="impact-ai-unavailable"
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("aiUnavailable")}</span>
        </p>
      )}
    </div>
  );
}
