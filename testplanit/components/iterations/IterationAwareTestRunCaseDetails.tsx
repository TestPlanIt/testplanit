"use client";

import { useMemo } from "react";

import { TestRunCaseDetails } from "@/components/TestRunCaseDetails";
import { useActiveIterationFromUrl } from "~/hooks/useActiveIterationFromUrl";
import { useFindManyTestRunCaseIteration } from "~/lib/hooks";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

import { IterationHeader } from "./IterationHeader";
import { IterationOverrideBanner } from "./IterationOverrideBanner";
import { IterationSidebar } from "./IterationSidebar";
import { IterationValuesStrip } from "./IterationValuesStrip";
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
  defaultValue?: unknown;
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
  const { activeRowIndex } = useActiveIterationFromUrl();

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

  const snapshotRows: Array<Record<string, unknown>> = useMemo(() => {
    if (!snapshot?.rowsJson) return [];
    return (snapshot.rowsJson as Array<Record<string, unknown>>) ?? [];
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
      return {
        id: p.id ?? 0,
        name: p.name,
        type: p.type,
        defaultValue: val,
      };
    });
  }, [activeIteration, parametersSchema]);

  const handleIterationMenuAction = (
    iterationId: number,
    action: IterationMenuAction
  ) => {
    // Wave 5 wires real dialogs. For Wave 4 we no-op visibly so reviewers can
    // confirm menu interactions reach this layer.
    console.log("iteration menu action", {
      iterationId,
      action,
      testRunCaseId,
    });
  };

  const handleBulkSkip = (iterationIds: number[]) => {
    // Wave 5 (Task 13) wires the bulk-skip confirm dialog.
    console.log("bulk-skip clicked", { iterationIds, testRunCaseId });
  };

  return (
    <div className="flex flex-col md:flex-row h-full">
      <IterationSidebar
        testRunCaseId={testRunCaseId}
        runId={testRunId}
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
          </>
        )}
        <div className="flex-1 min-h-0 overflow-auto">
          <TestRunCaseDetails {...innerProps} stepParameters={stepParameters} />
        </div>
      </div>
    </div>
  );
}

export default IterationAwareTestRunCaseDetails;
