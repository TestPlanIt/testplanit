"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AutoTagJobState } from "./types";

interface AutoTagProgressProps {
  status: AutoTagJobState;
  progress: { analyzed: number; total: number; streaming?: boolean; sizing?: number } | null;
  error: string | null;
  onReview: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
}

export function AutoTagProgress({
  status,
  progress,
  error,
  onReview,
  onCancel,
  onDismiss,
}: AutoTagProgressProps) {
  const t = useTranslations("autoTag.progress");
  const tCommon = useTranslations("common");

  if (status === "idle") return null;

  // Processing states: waiting or active
  if (status === "waiting" || status === "active") {
    const hasProgress = progress && progress.total > 0;
    const percent = hasProgress
      ? Math.round((progress.analyzed / progress.total) * 100)
      : 0;

    return (
      <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm">
            {hasProgress
              ? progress.sizing
                ? t("sizing", { size: progress.sizing })
                : progress.streaming
                  ? t("streaming", {
                      analyzed: progress.analyzed,
                      total: progress.total,
                    })
                  : t("analyzed", {
                      analyzed: progress.analyzed,
                      total: progress.total,
                    })
              : t("starting")}
          </p>
          <Progress
            value={hasProgress ? percent : undefined}
            className="h-1.5"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto shrink-0 px-2 py-1 text-xs text-muted-foreground"
        >
          <X className="mr-1 h-3 w-3" />
          {tCommon("cancel")}
        </Button>
      </div>
    );
  }

  // Completed
  if (status === "completed") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-success/30 bg-success/10 px-3 py-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <span className="flex-1 text-sm">{t("complete")}</span>
        <Button
          size="sm"
          onClick={onReview}
          className="h-auto shrink-0 px-3 py-1 text-xs"
        >
          {t("reviewSuggestions")}
        </Button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 rounded-sm bg-destructive p-0.5 text-destructive-foreground hover:bg-destructive/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Failed
  if (status === "failed") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1 text-sm text-destructive">
          {error || t("failed")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto px-2 py-1 text-xs text-muted-foreground"
        >
          {tCommon("dismiss")}
        </Button>
      </div>
    );
  }

  return null;
}
