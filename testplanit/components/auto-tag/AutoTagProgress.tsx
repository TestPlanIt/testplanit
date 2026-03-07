"use client";

import { CheckCircle2, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { AutoTagJobState } from "./types";

interface AutoTagProgressProps {
  status: AutoTagJobState;
  progress: { analyzed: number; total: number } | null;
  error: string | null;
  onReview: () => void;
  onCancel: () => void;
}

export function AutoTagProgress({
  status,
  progress,
  error,
  onReview,
  onCancel,
}: AutoTagProgressProps) {
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
              ? `Analyzed ${progress.analyzed}/${progress.total} entities`
              : "Starting analysis..."}
          </p>
          <Progress value={hasProgress ? percent : undefined} className="h-1.5" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto shrink-0 px-2 py-1 text-xs text-muted-foreground"
        >
          <X className="mr-1 h-3 w-3" />
          Cancel
        </Button>
      </div>
    );
  }

  // Completed
  if (status === "completed") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-900 dark:bg-green-950/30">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
        <span className="flex-1 text-sm">Analysis complete</span>
        <Button size="sm" onClick={onReview} className="h-auto px-3 py-1 text-xs">
          Review Suggestions
        </Button>
      </div>
    );
  }

  // Failed
  if (status === "failed") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/30">
        <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <span className="flex-1 text-sm text-red-700 dark:text-red-300">
          {error || "Analysis failed"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto px-2 py-1 text-xs text-muted-foreground"
        >
          Dismiss
        </Button>
      </div>
    );
  }

  return null;
}
