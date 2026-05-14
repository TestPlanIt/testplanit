"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";

import { useActiveIterationFromUrl } from "~/hooks/useActiveIterationFromUrl";
import { useSelectedIterationIds } from "~/hooks/useSelectedIterationIds";
import {
  iterationProgressBus,
  type ProgressJob,
} from "~/lib/services/iterationProgressBus";

import { IterationBulkToolbar } from "./IterationBulkToolbar";
import { IterationRow } from "./IterationRow";
import { IterationSidebarGeneratingState } from "./IterationSidebarGeneratingState";
import { IterationStatusLegendPopover } from "./IterationStatusLegendPopover";
import type {
  IterationDTO,
  IterationMenuAction,
  IterationParameterMeta,
} from "./types";

export interface IterationSidebarProps {
  testRunCaseId: number;
  runId: number;
  /** Project ID — used by the status legend to fetch real project statuses. */
  projectId: number;
  iterations: IterationDTO[];
  parametersSchema: IterationParameterMeta[];
  isRunCompleted: boolean;
  onIterationMenuAction: (
    iterationId: number,
    action: IterationMenuAction
  ) => void;
  onBulkSkip: (iterationIds: number[]) => void;
  /** Optional bus subscription override; primarily for tests. */
  initialGeneratingJob?: ProgressJob | undefined;
}

export function IterationSidebar({
  testRunCaseId,
  runId,
  projectId,
  iterations,
  parametersSchema,
  isRunCompleted,
  onIterationMenuAction,
  onBulkSkip,
  initialGeneratingJob,
}: IterationSidebarProps) {
  const t = useTranslations("parameters");
  const containerRef = useRef<HTMLDivElement>(null);

  const { activeRowIndex, setActiveRowIndex } = useActiveIterationFromUrl();
  const { selectedIds, toggle, clear, selectAll, isSelected } =
    useSelectedIterationIds();

  // Find the matching generating job for this run, if any. We pick the bus
  // snapshot directly instead of subscribing — the
  // IterationSidebarGeneratingState component subscribes internally for
  // live updates, so the sidebar only needs the initial existence check.
  const generatingJob = useMemo<ProgressJob | undefined>(() => {
    if (initialGeneratingJob) return initialGeneratingJob;
    return iterationProgressBus
      .snapshot()
      .find(
        (j) =>
          j.runId === runId && (j.state === "queued" || j.state === "active")
      );
  }, [initialGeneratingJob, runId]);

  const completeCount = useMemo(
    () => iterations.filter((it) => it.isCompleted).length,
    [iterations]
  );

  const handleContainerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          clear();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        // Only act when focus is inside the sidebar.
        if (containerRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          selectAll(iterations.map((it) => it.id));
        }
      }
    },
    [clear, iterations, selectAll, selectedIds.size]
  );

  // Keep selection bounded to currently-rendered iterations (e.g., if a
  // late-arriving fan-out removes a row, drop it from the set).
  useEffect(() => {
    const ids = new Set(iterations.map((it) => it.id));
    let dirty = false;
    for (const sel of selectedIds) {
      if (!ids.has(sel)) {
        dirty = true;
        break;
      }
    }
    if (dirty) {
      const next = new Set<number>();
      for (const sel of selectedIds) if (ids.has(sel)) next.add(sel);
      selectAll(Array.from(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iterations]);

  const showGeneratingState = !!generatingJob && iterations.length === 0;

  return (
    <aside
      className="w-full md:w-72 bg-card border-b md:border-b-0 md:border-r flex flex-col h-full md:h-auto"
      aria-label={t("iterationSidebarAria")}
      data-testid="iteration-sidebar"
      data-test-run-case-id={testRunCaseId}
    >
      <div
        ref={containerRef}
        onKeyDown={handleContainerKeyDown}
        className="flex flex-col h-full"
      >
        <header className="sticky top-0 z-10 bg-card border-b px-4 pt-4 pb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t("iterationsHeading")}</h2>
            <IterationStatusLegendPopover projectId={projectId} />
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {showGeneratingState
              ? t("iterationsHeaderCountPending", {
                  total: generatingJob?.total ?? 0,
                })
              : t("iterationsHeaderCount", {
                  complete: completeCount,
                  total: iterations.length,
                })}
          </span>
        </header>

        {showGeneratingState ? (
          <div className="flex-1">
            <IterationSidebarGeneratingState
              jobId={generatingJob!.jobId}
              totalExpected={generatingJob!.total}
              runName={generatingJob!.runName}
              onSkip={() => {
                /* Sidebar stays mounted; nav handled by parent if needed. */
              }}
            />
          </div>
        ) : (
          <>
            <IterationBulkToolbar
              selectedCount={selectedIds.size}
              onSkip={() => onBulkSkip(Array.from(selectedIds))}
              onCancel={clear}
            />
            <div
              role="list"
              className="flex-1 overflow-y-auto"
              data-testid="iteration-sidebar-list"
            >
              {iterations.map((iteration) => (
                <div role="listitem" key={iteration.id}>
                  <IterationRow
                    iteration={iteration}
                    parametersSchema={parametersSchema}
                    isActive={iteration.rowIndex === activeRowIndex}
                    isSelected={isSelected(iteration.id)}
                    isRunCompleted={isRunCompleted}
                    hasSelection={selectedIds.size > 0}
                    onActivate={() => setActiveRowIndex(iteration.rowIndex)}
                    onToggleSelect={() => toggle(iteration.id)}
                    onMenuAction={(action) =>
                      onIterationMenuAction(iteration.id, action)
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export default IterationSidebar;
