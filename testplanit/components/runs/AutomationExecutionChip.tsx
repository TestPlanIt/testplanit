"use client";

import { DateFormatter } from "@/components/DateFormatter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Ban,
  Bot,
  ExternalLink,
  History,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ACTIVE_EXECUTION_STATUSES } from "~/lib/execution/types";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";
import { AutomationExecutionsSheet } from "./AutomationExecutionsSheet";

export function executionBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "SUCCEEDED":
      return "default";
    case "FAILED":
    case "DISPATCH_FAILED":
    case "TIMED_OUT":
      return "destructive";
    case "CANCELLED":
      return "secondary";
    default:
      return "secondary";
  }
}

interface Props {
  runId: number;
  executions: TestRunExecutionRow[];
  canAddEdit: boolean;
  isCompleted: boolean;
  onChanged: () => void;
  onRetry: (execution: TestRunExecutionRow) => void;
}

/**
 * The latest execution of this run: status, provider link, who asked and
 * when, plus Cancel (while in flight), Retry (after a failure) and the
 * history sheet. Renders nothing until the run has been executed once.
 */
export function AutomationExecutionChip({
  runId,
  executions,
  canAddEdit,
  isCompleted,
  onChanged,
  onRetry,
}: Props) {
  const t = useTranslations("automation.execute");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const latest = executions[0];
  if (!latest) return null;

  const isActive = ACTIVE_EXECUTION_STATUSES.includes(latest.status as never);
  const timeoutMinutes = latest.target?.timeoutMinutes;
  const timesOutAt =
    timeoutMinutes && (latest.dispatchedAt ?? latest.createdAt)
      ? new Date(
          new Date(latest.dispatchedAt ?? latest.createdAt).getTime() +
            timeoutMinutes * 60_000
        )
      : null;
  const isRetryable =
    !isActive && latest.status !== "SUCCEEDED" && !isCompleted && canAddEdit;
  const providerLabel = tGlobal(
    `enums.ExecutionProvider.${latest.provider as "GITHUB_ACTIONS"}`
  );
  const statusLabel = tGlobal(
    `enums.TestRunExecutionStatus.${latest.status as "PENDING"}`
  );

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(
        `/api/test-runs/${runId}/executions/${latest.id}/cancel`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? t("dispatchFailed"));
        return;
      }
      toast.success(t("cancelled"));
      onChanged();
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  };

  const detail = (
    <div className="space-y-1 text-xs">
      {latest.requestedBy && (
        <div>
          {t("requestedBy", {
            name: latest.requestedBy.name ?? latest.requestedBy.email ?? "",
          })}
        </div>
      )}
      {latest.dispatchedAt && (
        <div>
          <DateFormatter date={latest.dispatchedAt} />
        </div>
      )}
      {latest.externalStatus && (
        <div>{t("externalStatus", { status: latest.externalStatus })}</div>
      )}
      {latest.resultsReceivedAt ? (
        <div>{t("resultsReceived")}</div>
      ) : isActive ? (
        <div>{t("awaitingResults")}</div>
      ) : null}
      {isActive && timesOutAt && (
        <div>
          {t("timesOutAt")} <DateFormatter date={timesOutAt} />
        </div>
      )}
      {latest.error && (
        <div className="text-destructive">
          {t("error")}: {latest.error}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="flex h-9 items-center gap-2 rounded-md border bg-secondary px-3 text-secondary-foreground"
      data-testid="automation-execution-chip"
    >
      <Bot className="h-4 w-4 shrink-0" aria-hidden />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-2">
            <span className="text-sm">
              {latest.target?.name ?? providerLabel}
            </span>
            <Badge
              variant={executionBadgeVariant(latest.status)}
              data-testid="automation-execution-status"
            >
              {isActive && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
              {statusLabel}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{detail}</TooltipContent>
      </Tooltip>
      {latest.externalUrl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={latest.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
              aria-label={t("openInProvider", { provider: providerLabel })}
              data-testid="automation-execution-external-link"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </TooltipTrigger>
          <TooltipContent>
            {t("openInProvider", { provider: providerLabel })}
          </TooltipContent>
        </Tooltip>
      )}
      {isActive && canAddEdit && !isCompleted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCancelOpen(true)}
              aria-label={t("cancel")}
              data-testid="automation-execution-cancel"
            >
              <Ban className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("cancel")}</TooltipContent>
        </Tooltip>
      )}
      {isRetryable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onRetry(latest)}
              aria-label={t("retry")}
              data-testid="automation-execution-retry"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("retry")}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setHistoryOpen(true)}
            aria-label={t("history")}
            data-testid="automation-execution-history"
          >
            <History className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("history")}</TooltipContent>
      </Tooltip>

      <AutomationExecutionsSheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        executions={executions}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent data-testid="automation-execution-cancel-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cancelConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="automation-execution-cancel-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault();
                void handleCancel();
              }}
              className={buttonVariants({ variant: "destructive" })}
              data-testid="automation-execution-cancel-dialog-confirm"
            >
              {t("cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
