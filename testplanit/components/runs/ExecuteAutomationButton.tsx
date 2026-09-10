"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ActionButtonContent,
  collapsibleActionClass,
  useActionBarCompact,
} from "@/components/ui/action-bar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilePlay } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { listExecutionTargetChoices } from "~/app/actions/execution-targets";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";
import {
  ExecuteAutomationDialog,
  readExecuteError,
} from "./ExecuteAutomationDialog";

export const executionTargetChoicesQueryKey = (projectId: number) => [
  "executionTargetChoices",
  projectId,
];

export function useExecutionTargetChoices(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: executionTargetChoicesQueryKey(projectId),
    queryFn: async () => {
      const result = await listExecutionTargetChoices(projectId);
      return result.success ? result.targets : [];
    },
    enabled: enabled && projectId > 0,
    staleTime: 60_000,
  });
}

interface Props {
  runId: number;
  projectId: number;
  canAddEdit: boolean;
  isCompleted: boolean;
  automatedCaseCount: number;
  activeExecution: TestRunExecutionRow | null;
  onDispatched: () => void;
  /** Externally opened (Retry from the chip). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  retryOf?: TestRunExecutionRow | null;
  /**
   * "action-bar": icon that reveals its label on hover (header action bar).
   * "labelled": a plain small outline button, for the case-list header next
   * to "Start manual testing".
   */
  variant?: "action-bar" | "labelled";
}

/**
 * "Execute automated cases" — a sibling of the run's other header actions
 * (it opens a dialog, so it stays out of the overflow). Hidden when the
 * viewer cannot edit runs or the project has no enabled target; disabled,
 * with the reason in a tooltip, when there is nothing to execute or an
 * execution is already in flight.
 */
export function ExecuteAutomationButton({
  runId,
  projectId,
  canAddEdit,
  isCompleted,
  automatedCaseCount,
  activeExecution,
  onDispatched,
  open,
  onOpenChange,
  retryOf,
  variant = "action-bar",
}: Props) {
  const t = useTranslations("automation.execute");
  const barCompact = useActionBarCompact();
  const collapsed = barCompact ?? true;
  // A labelled button inside a compact ActionBar (narrow case-list header)
  // falls back to the icon-with-hover-label form.
  const showLabel = variant === "labelled" && !barCompact;
  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;

  const { data: targets } = useExecutionTargetChoices(
    projectId,
    canAddEdit && !isCompleted
  );
  const enabledTargets = (targets ?? []).filter((x) => x.isEnabled);

  if (!canAddEdit || isCompleted || enabledTargets.length === 0) return null;

  const reason =
    automatedCaseCount === 0
      ? t("noAutomatedCases")
      : activeExecution
        ? t("activeExecution")
        : null;

  const button = showLabel ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setDialogOpen(true)}
      disabled={Boolean(reason)}
      data-testid="execute-automation-button"
    >
      <FilePlay className="h-4 w-4" />
      {t("button")}
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={variant === "labelled" ? "sm" : undefined}
      onClick={() => setDialogOpen(true)}
      disabled={Boolean(reason)}
      aria-label={t("button")}
      data-testid="execute-automation-button"
      className={collapsibleActionClass(collapsed)}
    >
      <ActionButtonContent icon={FilePlay} label={t("button")} />
    </Button>
  );

  return (
    <>
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <ExecuteAutomationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        targets={enabledTargets}
        caseCount={automatedCaseCount}
        runId={runId}
        initialTargetId={retryOf?.target?.id ?? null}
        initialRef={retryOf?.ref ?? null}
        submit={async ({ targetId, ref }) => {
          const res = await fetch(`/api/test-runs/${runId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetId, ...(ref ? { ref } : {}) }),
          });
          if (res.status === 202) return null;
          return readExecuteError(res, t("dispatchFailed"));
        }}
        onDispatched={onDispatched}
      />
    </>
  );
}
