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
import { useMemo, useState } from "react";
import { listExecutionTargetChoices } from "~/app/actions/execution-targets";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";
import { normalizeInputs } from "~/lib/execution/inputs";
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

const NO_IDS: number[] = [];

/** The case ids an execution was requested for; empty for a whole-run execution. */
export function requestedCaseIdsOf(
  execution: Pick<TestRunExecutionRow, "requestedCaseIds"> | null | undefined
): number[] {
  const raw = execution?.requestedCaseIds;
  if (!Array.isArray(raw)) return NO_IDS;
  return raw.filter(
    (id): id is number =>
      typeof id === "number" && Number.isInteger(id) && id > 0
  );
}

interface Props {
  runId: number;
  projectId: number;
  canAddEdit: boolean;
  isCompleted: boolean;
  /** Repository case ids of the run's automated cases, in run order. */
  automatedCaseIds: number[];
  /** Rows selected in the case table, of any kind. */
  selectedCaseCount?: number;
  /** The automated cases of this run among the selected rows. */
  selectedAutomatedCaseIds?: number[];
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
 *
 * With rows selected in the case table the button offers only the automated
 * cases among them ("Execute 3 selected automated cases") and the request
 * names those ids; manual rows in the selection are never sent. A retry
 * replays the subset its execution was requested for.
 */
export function ExecuteAutomationButton({
  runId,
  projectId,
  canAddEdit,
  isCompleted,
  automatedCaseIds,
  selectedCaseCount = 0,
  selectedAutomatedCaseIds = NO_IDS,
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

  const hasSelection = selectedCaseCount > 0;
  // What the dialog will request: a retry's original subset (narrowed to the
  // cases still automated in the run), else the selection's automated cases,
  // else every automated case in the run.
  const subset = useMemo<number[] | null>(() => {
    if (retryOf) {
      const requested = requestedCaseIdsOf(retryOf);
      if (requested.length === 0) return null;
      const automated = new Set(automatedCaseIds);
      return requested.filter((id) => automated.has(id));
    }
    return hasSelection ? selectedAutomatedCaseIds : null;
  }, [retryOf, automatedCaseIds, hasSelection, selectedAutomatedCaseIds]);
  const caseCount = subset ? subset.length : automatedCaseIds.length;
  const retryInputs = useMemo(
    () => (retryOf ? normalizeInputs(retryOf.inputs) : null),
    [retryOf]
  );
  const skippedCount =
    hasSelection && !retryOf
      ? selectedCaseCount - selectedAutomatedCaseIds.length
      : 0;

  if (!canAddEdit || isCompleted || enabledTargets.length === 0) return null;

  const reason =
    automatedCaseIds.length === 0
      ? t("noAutomatedCases")
      : hasSelection && selectedAutomatedCaseIds.length === 0
        ? t("noAutomatedSelected")
        : activeExecution
          ? t("activeExecution")
          : null;
  const label = hasSelection
    ? t("buttonSelected", { count: selectedAutomatedCaseIds.length })
    : t("button");

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
      {label}
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={variant === "labelled" ? "sm" : undefined}
      onClick={() => setDialogOpen(true)}
      disabled={Boolean(reason)}
      aria-label={label}
      data-testid="execute-automation-button"
      className={collapsibleActionClass(collapsed)}
    >
      <ActionButtonContent icon={FilePlay} label={label} />
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
        projectId={projectId}
        targets={enabledTargets}
        caseCount={caseCount}
        subset={subset !== null}
        skippedCount={skippedCount}
        runId={runId}
        initialTargetId={retryOf?.target?.id ?? null}
        initialRef={retryOf?.ref ?? null}
        initialInputs={retryInputs}
        submit={async ({ targetId, ref, inputs }) => {
          const res = await fetch(`/api/test-runs/${runId}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              targetId,
              ...(ref ? { ref } : {}),
              ...(inputs ? { inputs } : {}),
              ...(subset ? { caseIds: subset } : {}),
            }),
          });
          if (res.status === 202) return null;
          return readExecuteError(res, t("dispatchFailed"));
        }}
        onDispatched={onDispatched}
      />
    </>
  );
}
