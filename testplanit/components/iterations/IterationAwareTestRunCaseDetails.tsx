"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { TestRunCaseDetails } from "@/components/TestRunCaseDetails";
import { useActiveIterationFromUrl } from "~/hooks/useActiveIterationFromUrl";
import {
  useFindManyStatus,
  useFindManyTestRunCaseIteration,
} from "~/lib/hooks";
import type { OverrideParameterSchemaEntry } from "~/lib/schemas/iterationOverrideSchema";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

import { IterationBulkConfirmDialog } from "./IterationBulkConfirmDialog";
import { IterationHeader } from "./IterationHeader";
import { IterationOverrideBanner } from "./IterationOverrideBanner";
import { IterationResultPanel } from "./IterationResultPanel";
import { IterationSidebar } from "./IterationSidebar";
import { IterationValuesStrip } from "./IterationValuesStrip";
import { OverrideValuesDialog } from "./OverrideValuesDialog";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import type {
  IterationDTO,
  IterationMenuAction,
  IterationParameterMeta,
} from "./types";

interface IterationAwareTestRunCaseDetailsProps {
  testRunCaseId: number;
  testRunId: number;
  totalIterations: number;
  isRunCompleted: boolean;
  /** All other props are forwarded to the inner TestRunCaseDetails. */
  innerProps: React.ComponentProps<typeof TestRunCaseDetails>;
}

interface SnapshotParameter {
  id?: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  order?: number;
  sensitive?: boolean;
  required?: boolean;
  defaultValue?: unknown;
  allowedValuesJson?: unknown;
  allowedValues?: unknown;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Wraps the existing TestRunCaseDetails surface with the Phase 3 iteration
 * UI: sidebar (Surface A), header (B.2), values strip (B.3), and override
 * banner (B.4). Mounted only when the active test-run case has
 * `totalIterations > 0` (PARAM-07 invariant).
 *
 * Override / Skip / Reset menu actions are stubbed for Wave 4 — Task 12
 * wires the Override dialog, Task 13 wires bulk-skip + single-iteration
 * skip + reset.
 */
export function IterationAwareTestRunCaseDetails({
  testRunCaseId,
  testRunId,
  totalIterations,
  isRunCompleted,
  innerProps,
}: IterationAwareTestRunCaseDetailsProps) {
  const { activeRowIndex, setActiveRowIndex } = useActiveIterationFromUrl();
  const { data: session } = useSession();
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();

  // Dialog state: Override (Task 12), BulkConfirm (Task 13).
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTargetId, setOverrideTargetId] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIterationIds, setBulkIterationIds] = useState<number[]>([]);

  // Conservative client-side default: only system ADMINs see sensitive
  // plaintext in the dialog. Non-admin users get the redacted/disabled
  // input. The server enforces the real RolePermission.canReadSensitive
  // check at the audit boundary; this client toggle is purely UX.
  const viewerCanReadSensitive =
    (session?.user as { access?: string } | undefined)?.access === "ADMIN";

  // Project Test-Run statuses (deduped via React Query with the same call
   // in IterationResultPanel / IterationStatusLegendPopover). Used by
   // handleResetIteration to find a target status without a custom endpoint.
  const { data: projectStatuses } = useFindManyStatus({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        { projects: { some: { projectId: innerProps.projectId } } },
        { scope: { some: { scope: { name: "Test Run" } } } },
      ],
    },
    orderBy: { order: "asc" },
  });

  const { data: iterationsRaw } = useFindManyTestRunCaseIteration(
    {
      where: { testRunCaseId, isDeleted: false },
      include: {
        status: {
          include: {
            color: { select: { value: true } },
          },
        },
        dataSetSnapshot: true,
      },
      orderBy: { rowIndex: "asc" },
    },
    { enabled: !!testRunCaseId }
  );

  const iterations: IterationDTO[] = useMemo(() => {
    const list = (iterationsRaw ?? []) as Array<{
      id: number;
      rowIndex: number;
      valuesJson: unknown;
      isCompleted: boolean;
      status?: {
        id: number;
        name: string;
        color?: { value: string } | null;
        isSuccess: boolean;
        isFailure: boolean;
        isCompleted: boolean;
        systemName?: string | null;
      } | null;
    }>;
    return list.map((it) => ({
      id: it.id,
      rowIndex: it.rowIndex,
      valuesJson: (it.valuesJson as Record<string, unknown>) ?? {},
      isCompleted: it.isCompleted,
      status: it.status ?? null,
    }));
  }, [iterationsRaw]);

  // Snapshot lives on every iteration row but is identical across rows for a
  // given testRunCase (single TestRunCaseDataSetSnapshot per case).
  const snapshot = useMemo(() => {
    const first = (iterationsRaw ?? [])[0] as
      | {
          dataSetSnapshot?: {
            parametersJson: unknown;
            rowsJson: unknown;
          } | null;
        }
      | undefined;
    return first?.dataSetSnapshot ?? null;
  }, [iterationsRaw]);

  const parametersSchema: IterationParameterMeta[] = useMemo(() => {
    if (!snapshot?.parametersJson) return [];
    const arr = (snapshot.parametersJson as SnapshotParameter[]) ?? [];
    return arr.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      order: p.order,
      sensitive: !!p.sensitive,
    }));
  }, [snapshot]);

  // Richer per-parameter schema for the OverrideValuesDialog — carries
  // `required` and `allowedValues` from the snapshot. The dialog's Zod
  // factory needs these to validate SELECT values and decide optionality.
  const overrideParamsSchema: OverrideParameterSchemaEntry[] = useMemo(() => {
    if (!snapshot?.parametersJson) return [];
    const arr = (snapshot.parametersJson as SnapshotParameter[]) ?? [];
    return arr.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required !== false,
      sensitive: !!p.sensitive,
      allowedValues: Array.isArray(p.allowedValuesJson)
        ? (p.allowedValuesJson as unknown[])
            .filter((v) => typeof v === "string")
            .map((v) => v as string)
        : Array.isArray(p.allowedValues)
          ? (p.allowedValues as unknown[])
              .filter((v) => typeof v === "string")
              .map((v) => v as string)
          : null,
    }));
  }, [snapshot]);

  const snapshotRows: Array<Record<string, unknown>> = useMemo(() => {
    if (!snapshot?.rowsJson) return [];
    // Snapshot rows are wrapped as { sourceRowId, rowIndex, label, valuesJson }.
    // Unwrap so consumers see a flat { paramName: value } map keyed by param.
    const raw = (snapshot.rowsJson as Array<Record<string, unknown>>) ?? [];
    return raw.map((row) => {
      const inner = row?.valuesJson;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
      return row;
    });
  }, [snapshot]);

  const activeIteration = useMemo(
    () => iterations.find((it) => it.rowIndex === activeRowIndex) ?? null,
    [iterations, activeRowIndex]
  );

  const activeSnapshotRow = useMemo(
    () => (activeIteration ? snapshotRows[activeIteration.rowIndex] : null),
    [activeIteration, snapshotRows]
  );

  const anyOverridden = useMemo(() => {
    if (!activeIteration || !activeSnapshotRow) return false;
    return parametersSchema.some(
      (p) =>
        !deepEqual(
          activeIteration.valuesJson?.[p.name],
          activeSnapshotRow?.[p.name]
        )
    );
  }, [activeIteration, activeSnapshotRow, parametersSchema]);

  /**
   * Build the iteration-aware `stepParameters` shape passed into the inner
   * TestRunCaseDetails. Phase 2 plumbed `parameters` through the step
   * renderer; we set each parameter's `defaultValue` to the active
   * iteration's actual value so Tiptap chips substitute correctly.
   */
  const stepParameters: ParameterChipMeta[] | undefined = useMemo(() => {
    if (!activeIteration) return undefined;
    return parametersSchema.map((p) => {
      const raw = activeIteration.valuesJson?.[p.name];
      let val: string | null;
      if (raw === null || raw === undefined) {
        val = null;
      } else if (typeof raw === "string") {
        val = raw;
      } else {
        try {
          val = JSON.stringify(raw);
        } catch {
          val = String(raw);
        }
      }
      // Permission gate for sensitive params: when the viewer can't read them,
      // pass `null` as the value so the chip falls back to `@name` (unsubstituted).
      // Server-side audit redaction is the source of truth — this is defence
      // in depth for the rendered DOM.
      if (p.sensitive && !viewerCanReadSensitive) {
        val = null;
      }
      return {
        id: p.id ?? 0,
        name: p.name,
        type: p.type,
        defaultValue: val,
        sensitive: !!p.sensitive,
      };
    });
  }, [activeIteration, parametersSchema, viewerCanReadSensitive]);

  // Permission for the iteration result panel — checked here in the wrapper
  // so the panel itself stays presentational and dedupes the project-perm fetch.
  const projectId = innerProps.projectId;
  const { permissions: testRunResultsPermissions } = useProjectPermissions(
    projectId,
    "TestRunResults"
  );
  const canAddEditResults = testRunResultsPermissions?.canAddEdit ?? false;

  /**
   * Iteration-aware advance after any result submission from the result
   * panel. Walks iterations sequentially by rowIndex (1, 2, 3, …); once
   * past the last iteration, falls back to the case-level Next behavior.
   *
   * Every status pick in the panel (the Pass button AND any item in the
   * status dropdown) is a deliberate user action to record + move on, so
   * we don't gate on success-only.
   *
   * Uses `totalIterations` (the schema counter on TestRunCases) rather than
   * inspecting the local `iterations` array so the post-submit advance is
   * not blocked by closure-stale data after `await invalidateQueries`.
   */
  const handleAdvanceAfterResult = (_args: { wasSuccess: boolean }) => {
    if (!activeIteration) return;
    const nextRowIndex = activeIteration.rowIndex + 1;
    if (nextRowIndex < totalIterations) {
      setActiveRowIndex(nextRowIndex);
      return;
    }
    // Past the last iteration → fall through to the case-level "next case"
    // handler if one is wired in innerProps.
    const onNextCase = innerProps.onNextCase;
    const testRunCasesData = innerProps.testRunCasesData;
    const caseId = innerProps.caseId;
    if (onNextCase && testRunCasesData) {
      const currentCase = testRunCasesData.find(
        (trc) => trc.repositoryCaseId === caseId
      );
      if (currentCase) {
        const nextCase = testRunCasesData
          .filter((trc) => trc.order > currentCase.order)
          .sort((a, b) => a.order - b.order)[0];
        if (nextCase) onNextCase(nextCase.repositoryCaseId);
      }
    }
  };

  const handleResetIteration = async (iterationId: number) => {
    try {
      // Reset writes a new TestRunResults row with a "starting" status via
      // the existing submit-result endpoint. Preserves the audit chain
      // rather than destructively deleting the iteration's history.
      //
      // Status selection (no hardcoding): prefer a project status with
      // systemName === "untested"; otherwise fall back to the first
      // status in the project's configured order. If no statuses are
      // available at all, surface an actionable error.
      const list = projectStatuses ?? [];
      const target =
        list.find(
          (s: { systemName?: string | null }) => s?.systemName === "untested",
        ) ?? list[0];
      if (!target) {
        toast.error(t("overrideError"), {
          description: t("iterationResetUntestedMissing"),
        });
        return;
      }
      const res = await fetch(`/api/test-runs/submit-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testRunId,
          testRunCaseId,
          iterationId,
          statusId: target.id,
          attempt: 1,
          testRunCaseVersion: 1,
        }),
      });
      if (!res.ok) {
        toast.error(t("overrideError"));
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCaseIteration"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCases"],
      });
    } catch {
      toast.error(t("overrideError"));
    }
  };

  const handleIterationMenuAction = (
    iterationId: number,
    action: IterationMenuAction
  ) => {
    if (action === "override") {
      setOverrideTargetId(iterationId);
      setOverrideOpen(true);
      return;
    }
    if (action === "skip") {
      // Single-iteration skip reuses the bulk-skip path with one element.
      setBulkIterationIds([iterationId]);
      setBulkOpen(true);
      return;
    }
    if (action === "reset") {
      void handleResetIteration(iterationId);
      return;
    }
  };

  const handleBulkSkip = (iterationIds: number[]) => {
    setBulkIterationIds(iterationIds);
    setBulkOpen(true);
  };

  const overrideTargetIteration = useMemo(
    () => iterations.find((it) => it.id === overrideTargetId) ?? null,
    [iterations, overrideTargetId]
  );

  const overrideTargetSnapshotRow = useMemo(() => {
    if (!overrideTargetIteration) return null;
    return snapshotRows[overrideTargetIteration.rowIndex] ?? null;
  }, [overrideTargetIteration, snapshotRows]);

  const alreadyCompletedInBulk = useMemo(
    () =>
      iterations.filter(
        (it) => bulkIterationIds.includes(it.id) && it.isCompleted
      ).length,
    [iterations, bulkIterationIds]
  );

  return (
    <div className="flex flex-col md:flex-row h-full">
      <IterationSidebar
        testRunCaseId={testRunCaseId}
        runId={testRunId}
        projectId={projectId}
        iterations={iterations}
        parametersSchema={parametersSchema}
        isRunCompleted={isRunCompleted}
        onIterationMenuAction={handleIterationMenuAction}
        onBulkSkip={handleBulkSkip}
      />
      <div className="flex flex-col flex-1 min-w-0">
        {activeIteration && (
          <>
            <IterationHeader
              rowIndex={activeIteration.rowIndex}
              total={totalIterations}
              status={activeIteration.status}
              hasResult={activeIteration.isCompleted}
              isRunCompleted={isRunCompleted}
              onMenuAction={(action) =>
                handleIterationMenuAction(activeIteration.id, action)
              }
            />
            <IterationValuesStrip
              valuesJson={activeIteration.valuesJson}
              snapshotRow={activeSnapshotRow}
              parametersSchema={parametersSchema}
            />
            {anyOverridden && <IterationOverrideBanner />}
            <IterationResultPanel
              testRunId={testRunId}
              testRunCaseId={testRunCaseId}
              caseId={innerProps.caseId}
              projectId={projectId}
              iteration={activeIteration}
              totalIterations={totalIterations}
              isDisabled={isRunCompleted}
              canAddEditResults={canAddEditResults}
              stepParameters={stepParameters}
              onAfterSubmit={handleAdvanceAfterResult}
            />
          </>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          <TestRunCaseDetails
            {...innerProps}
            stepParameters={stepParameters}
            activeIterationId={activeIteration?.id}
            activeIterationLabel={
              activeIteration
                ? t("iterationResultPanelHeading", {
                    n: String(activeIteration.rowIndex + 1),
                    total: String(totalIterations),
                  })
                : undefined
            }
          />
        </div>
      </div>

      {overrideTargetIteration && overrideTargetSnapshotRow && (
        <OverrideValuesDialog
          open={overrideOpen}
          onOpenChange={(next) => {
            setOverrideOpen(next);
            if (!next) setOverrideTargetId(null);
          }}
          runId={testRunId}
          caseId={testRunCaseId}
          iterationId={overrideTargetIteration.id}
          rowIndex={overrideTargetIteration.rowIndex}
          parametersSchema={overrideParamsSchema}
          snapshotRow={overrideTargetSnapshotRow}
          currentValues={overrideTargetIteration.valuesJson}
          viewerCanReadSensitive={viewerCanReadSensitive}
        />
      )}

      <IterationBulkConfirmDialog
        open={bulkOpen}
        onOpenChange={(next) => {
          setBulkOpen(next);
          if (!next) setBulkIterationIds([]);
        }}
        iterationIds={bulkIterationIds}
        runId={testRunId}
        caseId={testRunCaseId}
        projectId={projectId}
        alreadyCompletedCount={alreadyCompletedInBulk}
      />
    </div>
  );
}

export default IterationAwareTestRunCaseDetails;
