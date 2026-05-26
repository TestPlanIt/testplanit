"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useFindFirstRepositoryCases,
  useFindFirstTestRuns,
  useFindFirstWorkflows,
  useFindManyStatus,
  useFindManyTemplateResultAssignment,
} from "~/lib/hooks";
import {
  isJustificationRequiredSubmitResultError,
  isPermissionDeniedSubmitResultError,
  submitTestRunResult,
} from "~/lib/test-run-result-submit";

import { AddResultModal } from "@/projects/repository/[projectId]/AddResultModal";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import type { IterationDTO } from "./types";

export interface IterationResultPanelProps {
  testRunId: number;
  testRunCaseId: number;
  caseId: number;
  projectId: number;
  iteration: IterationDTO;
  totalIterations: number;
  /** Disabled when the run/case is completed. */
  isDisabled: boolean;
  /** Whether the current user can submit results in this project. */
  canAddEditResults: boolean;
  /**
   * Effective iteration values formatted as ParameterChipMeta[] — passed
   * through to AddResultModal so step text inside the modal renders chips
   * with this iteration's substituted values (matching the case-detail surface).
   */
  stepParameters?: ParameterChipMeta[];
  /**
   * Called after a successful result submission. Receives whether the
   * submitted status was a success status (so the wrapper can decide whether
   * to advance to the next iteration / case).
   */
  onAfterSubmit?: (args: { wasSuccess: boolean }) => void;
}

/**
 * Surface B (Option B) — iteration-scoped result toolbar mounted directly
 * under IterationHeader. Replaces the case-level toolbar in TestRunCaseDetails
 * when in iteration mode so testers can see exactly which iteration the
 * result is being recorded against.
 *
 * Note: the case-level toolbar still renders for non-parameterized cases
 * (PARAM-07). TestRunCaseDetails hides its toolbar when activeIterationId
 * is set; the wrapper renders this panel in its place.
 */
export function IterationResultPanel({
  testRunId,
  testRunCaseId,
  caseId,
  projectId,
  iteration,
  totalIterations,
  isDisabled,
  canAddEditResults,
  stepParameters,
  onAfterSubmit,
}: IterationResultPanelProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddResultModal, setShowAddResultModal] = useState(false);
  // Pre-selected status when a quick-status click escalates to the modal.
  const [escalatedStatusId, setEscalatedStatusId] = useState<string>();
  // True when the escalation was triggered by a rejected flip, so the modal
  // shows the justification error on open.
  const [flipErrorOnOpen, setFlipErrorOnOpen] = useState(false);

  // Fetch the case (for name + currentVersion + steps) — React Query
  // dedupes with the same query already running inside TestRunCaseDetails.
  // Steps are passed through to the AddResultModal so per-step result
  // capture works inside an iteration (results.id → step results).
  const { data: testcase } = useFindFirstRepositoryCases(
    {
      where: { id: caseId, isDeleted: false },
      select: {
        id: true,
        name: true,
        currentVersion: true,
        steps: true,
        template: { select: { id: true } },
      },
    },
    { enabled: !!caseId }
  );

  // Quick-status can't capture a required result field; when the case's
  // template requires one, escalate to the full Add Result modal instead.
  const { data: requiredResultFieldAssignments } =
    useFindManyTemplateResultAssignment(
      {
        where: {
          templateId: testcase?.template?.id,
          resultField: { isRequired: true, isEnabled: true, isDeleted: false },
        },
        take: 1,
      },
      { enabled: !!testcase?.template?.id }
    );
  const hasRequiredResultField =
    (requiredResultFieldAssignments?.length ?? 0) > 0;

  // Fetch the test run for its configuration (passed to AddResultModal).
  const { data: testRun } = useFindFirstTestRuns(
    {
      where: { id: testRunId, isDeleted: false },
      select: {
        id: true,
        configuration: { select: { id: true, name: true } },
      },
    },
    { enabled: !!testRunId }
  );

  const { data: statuses } = useFindManyStatus({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        { projects: { some: { projectId: Number(projectId) } } },
        { scope: { some: { scope: { name: "Test Run" } } } },
      ],
    },
    include: { color: { select: { value: true } } },
    orderBy: { order: "asc" },
  });

  const { data: inProgressWorkflow } = useFindFirstWorkflows({
    where: {
      projects: { some: { projectId: Number(projectId) } },
      scope: "RUNS",
      workflowType: "IN_PROGRESS",
      isEnabled: true,
      isDeleted: false,
    },
    orderBy: { order: "asc" },
  });

  const successStatus = statuses?.find((s) => s.isSuccess === true);

  const invalidateAfterSubmit = async () => {
    // Match the AddResultModal pattern — submit-result writes touch
    // multiple models (TestRunResults, TestRunCases, TestRunCaseIteration)
    // and the case-level rollup is read via different queries on different
    // surfaces (run page, repository, test-result-history). A blanket
    // invalidation is what AddResultModal already uses and is the simplest
    // way to keep every consumer fresh.
    await queryClient.invalidateQueries();
  };

  const submitWithStatus = async (statusId: number, wasSuccess: boolean) => {
    if (!canAddEditResults || isDisabled) return;
    if (!testcase?.currentVersion) return;

    if (hasRequiredResultField) {
      setEscalatedStatusId(statusId.toString());
      setShowAddResultModal(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await submitTestRunResult({
        testRunId,
        testRunCaseId,
        statusId,
        notes: { type: "doc", content: [{ type: "paragraph" }] },
        evidence: {},
        attempt: 1,
        testRunCaseVersion: testcase.currentVersion,
        inProgressStateId: inProgressWorkflow?.id ?? null,
        iterationId: iteration.id,
      });
      await invalidateAfterSubmit();
      toast.success(tCommon("actions.resultAdded"), {
        description: tCommon("actions.resultAddedDescription"),
      });
      onAfterSubmit?.({ wasSuccess });
    } catch (error) {
      console.error("Iteration result submit failed", error);
      if (isPermissionDeniedSubmitResultError(error)) {
        toast.error(tCommon("errors.accessDenied"), {
          description: tCommon("errors.resultSubmitPermissionDenied"),
        });
      } else if (isJustificationRequiredSubmitResultError(error)) {
        // Open the full modal pre-set to this status with the justification
        // error shown inline, so the tester can add Result Details and resubmit.
        setEscalatedStatusId(statusId.toString());
        setFlipErrorOnOpen(true);
        setShowAddResultModal(true);
      } else {
        toast.error(tCommon("errors.error"), {
          description: tCommon("errors.somethingWentWrong"),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canAddEditResults) return null;

  return (
    <>
      <div
        data-testid="iteration-result-panel"
        className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-primary/5"
      >
        <span className="text-xs font-medium text-muted-foreground">
          {t("iterationResultPanelHeading", {
            n: String(iteration.rowIndex + 1),
            total: String(totalIterations),
          })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEscalatedStatusId(undefined);
              setFlipErrorOnOpen(false);
              setShowAddResultModal(true);
            }}
            disabled={isDisabled || isSubmitting}
            data-testid="iteration-add-result-button"
          >
            <Plus className="h-4 w-4" />
            {t("iterationAddResult")}
          </Button>
          <div className="flex">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isDisabled || isSubmitting || !successStatus}
              onClick={() =>
                successStatus && submitWithStatus(successStatus.id, true)
              }
              className="rounded-r-none border-r-0"
              data-testid="iteration-pass-and-next-button"
            >
              <CheckCircle className="h-4 w-4" />
              {t("iterationPassAndNext")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={isDisabled || isSubmitting}
                  className="rounded-l-none px-1.5"
                  data-testid="iteration-status-dropdown-trigger"
                  aria-label={t("iterationOtherStatuses")}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                {statuses?.map((status) => (
                  <DropdownMenuItem
                    key={status.id}
                    disabled={isDisabled || isSubmitting}
                    onClick={() =>
                      submitWithStatus(status.id, !!status.isSuccess)
                    }
                    className="flex items-center cursor-pointer"
                    data-testid={`iteration-status-${status.id}`}
                  >
                    <div
                      className="w-3 h-3 rounded-full mr-2 shrink-0"
                      style={{
                        backgroundColor: status.color?.value || "#B1B2B3",
                      }}
                    />
                    <span className="flex-1 text-sm">{status.name}</span>
                    {status.isSuccess && (
                      <CheckCircle className="h-4 w-4 ml-2 text-muted-foreground" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {showAddResultModal && testcase?.name && (
        <AddResultModal
          isOpen={showAddResultModal}
          onClose={() => {
            setShowAddResultModal(false);
            setEscalatedStatusId(undefined);
            setFlipErrorOnOpen(false);
          }}
          testRunId={testRunId}
          testRunCaseId={testRunCaseId}
          caseName={testcase.name}
          projectId={projectId}
          defaultStatusId={escalatedStatusId ?? successStatus?.id?.toString()}
          validateOnOpen={escalatedStatusId != null && !flipErrorOnOpen}
          flipJustificationError={flipErrorOnOpen}
          configuration={testRun?.configuration ?? undefined}
          iterationId={iteration.id}
          iterationLabel={t("iterationResultPanelHeading", {
            n: String(iteration.rowIndex + 1),
            total: String(totalIterations),
          })}
          steps={testcase.steps}
          parameters={stepParameters}
        />
      )}
    </>
  );
}

export default IterationResultPanel;
