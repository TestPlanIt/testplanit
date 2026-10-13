"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useMemo } from "react";
import { schema } from "~/zenstack/schema";

/** The header fields the snapshot menus list — no entries are loaded. */
export interface RequirementSnapshotOption {
  id: number;
  name: string;
  capturedAt: Date | string;
  requirementCount: number;
  uncoveredCount: number;
  /** Requirement–case pairs; with `uncoveredCount` this is the matrix row count. */
  caseLinkCount: number;
  /** Execution scope frozen at capture (number[] JSON); non-empty means
   * the snapshot's numbers count only executions inside that frame — the
   * menus badge it (via `isSnapshotExecutionScoped` in
   * `utils/requirementExecutionScope.ts`) so a scoped baseline is never
   * mistaken for a global one. */
  scopeMilestoneIds?: unknown;
  scopeConfigIds?: unknown;
  capturedBy?: { name: string | null } | null;
}

/**
 * The project's live traceability snapshots, newest first — the one
 * query behind every snapshot menu (the reports' pickers and the
 * Requirements page header), so they can never list different sets.
 * A capture or delete invalidates it through the shared predicate.
 */
export function useRequirementSnapshotList(projectId: number): {
  options: RequirementSnapshotOption[];
  isLoading: boolean;
} {
  const { data, isLoading } = useClientQueries(
    schema
  ).requirementTraceabilitySnapshot.useFindMany(
    {
      where: { projectId, isDeleted: false },
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        name: true,
        capturedAt: true,
        requirementCount: true,
        uncoveredCount: true,
        caseLinkCount: true,
        scopeMilestoneIds: true,
        scopeConfigIds: true,
        capturedBy: { select: { name: true } },
      },
    },
    { enabled: Number.isInteger(projectId) && projectId > 0 }
  );
  const options = useMemo(
    () => (data ?? []) as RequirementSnapshotOption[],
    [data]
  );
  return { options, isLoading };
}
