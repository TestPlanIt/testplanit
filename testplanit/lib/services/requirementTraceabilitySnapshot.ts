import { baseDb } from "~/lib/db";
import type { LatestResultExecutionScope } from "~/lib/services/latestCaseResults";
import type { RequirementCoverageScope } from "~/lib/services/requirementCoverage";
import {
  loadRequirementTraceability,
  type RequirementTraceabilityData,
} from "~/lib/services/requirementTraceability";
import {
  expandSnapshotEntries,
  groupTraceabilityRows,
  summarizeSnapshotEntries,
  type SnapshotCaseRecord,
  type SnapshotEntryRecord,
  type SnapshotSummary,
} from "~/lib/services/requirementTraceabilitySnapshotShape";

/**
 * Requirement traceability snapshots — persisted, point-in-time copies of
 * the traceability matrix (the audit story: "on this date, these cases
 * covered these requirements with these results").
 *
 * Capture composes the ONE shipped loader (`loadRequirementTraceability`)
 * and folds its rows through the pure shape module; it never derives
 * coverage itself. Loading unfolds the stored entries back into the same
 * `RequirementTraceabilityData` the live route returns, so the report
 * handler, CSV, and PDF exporter render a snapshot through the code they
 * already have. Entries are written with the raw client inside one
 * transaction after the route has authorized the capture — the policy
 * client exposes them read-only.
 */

/** Rows per `createMany` — bounded so a 13k-requirement project writes in
 * a few dozen statements rather than one oversized one. */
const ENTRY_INSERT_CHUNK = 500;

export interface CaptureRequirementTraceabilitySnapshotInput {
  projectId: number;
  name: string;
  note?: string | null;
  /** Requirement roots to confine the capture to (the report's scope
   * semantics); omitted = the whole project. */
  rootIds?: number[];
  /** Execution scope (milestone/configuration) the capture counts under —
   * frozen onto the record so a scoped baseline can only ever be compared
   * within the same frame. Omitted = global. */
  executionScope?: LatestResultExecutionScope;
  capturedById: string;
}

export interface RequirementTraceabilitySnapshotHeader extends SnapshotSummary {
  id: number;
  projectId: number;
  name: string;
  note: string | null;
  capturedById: string;
  capturedAt: Date;
  scopeRequirementIds: number[];
  scopeMilestoneIds: number[];
  scopeConfigIds: number[];
}

const HEADER_SELECT = {
  id: true,
  projectId: true,
  name: true,
  note: true,
  capturedById: true,
  capturedAt: true,
  scopeRequirementIds: true,
  scopeMilestoneIds: true,
  scopeConfigIds: true,
  requirementCount: true,
  passedCount: true,
  failedCount: true,
  notRunCount: true,
  uncoveredCount: true,
  caseLinkCount: true,
} as const;

function parseScopeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is number => typeof id === "number" && Number.isInteger(id)
  );
}

function toHeader(row: {
  id: number;
  projectId: number;
  name: string;
  note: string | null;
  capturedById: string;
  capturedAt: Date;
  scopeRequirementIds: unknown;
  scopeMilestoneIds: unknown;
  scopeConfigIds: unknown;
  requirementCount: number;
  passedCount: number;
  failedCount: number;
  notRunCount: number;
  uncoveredCount: number;
  caseLinkCount: number;
}): RequirementTraceabilitySnapshotHeader {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    note: row.note,
    capturedById: row.capturedById,
    capturedAt: row.capturedAt,
    scopeRequirementIds: parseScopeIds(row.scopeRequirementIds),
    scopeMilestoneIds: parseScopeIds(row.scopeMilestoneIds),
    scopeConfigIds: parseScopeIds(row.scopeConfigIds),
    requirementCount: row.requirementCount,
    passedCount: row.passedCount,
    failedCount: row.failedCount,
    notRunCount: row.notRunCount,
    uncoveredCount: row.uncoveredCount,
    caseLinkCount: row.caseLinkCount,
  };
}

function toEntryRow(snapshotId: number, entry: SnapshotEntryRecord) {
  return {
    snapshotId,
    requirementId: entry.requirementId,
    requirementKey: entry.requirementKey,
    requirementTitle: entry.requirementTitle,
    requirementPath: entry.requirementPath,
    requirementParentPath: entry.requirementParentPath,
    requirementParentId: entry.requirementParentId,
    requirementRootId: entry.requirementRootId,
    requirementIssueTypeName: entry.requirementIssueTypeName,
    requirementIssueTypeIconUrl: entry.requirementIssueTypeIconUrl,
    requirementPriority: entry.requirementPriority,
    requirementStatus: entry.requirementStatus,
    requirementCreatedAt: entry.requirementCreatedAt
      ? new Date(entry.requirementCreatedAt)
      : null,
    coverageStatus: entry.coverageStatus,
    linkedCaseCount: entry.linkedCaseCount,
    cases: entry.cases,
  };
}

function fromEntryRow(row: {
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  requirementParentPath: string;
  requirementParentId: number | null;
  requirementRootId: number;
  requirementIssueTypeName: string | null;
  requirementIssueTypeIconUrl: string | null;
  requirementPriority: string | null;
  requirementStatus: string | null;
  requirementCreatedAt: Date | null;
  coverageStatus: string;
  linkedCaseCount: number;
  cases: unknown;
}): SnapshotEntryRecord {
  return {
    requirementId: row.requirementId,
    requirementKey: row.requirementKey,
    requirementTitle: row.requirementTitle,
    requirementPath: row.requirementPath,
    requirementParentPath: row.requirementParentPath,
    requirementParentId: row.requirementParentId,
    requirementRootId: row.requirementRootId,
    requirementIssueTypeName: row.requirementIssueTypeName,
    requirementIssueTypeIconUrl: row.requirementIssueTypeIconUrl,
    requirementPriority: row.requirementPriority,
    requirementStatus: row.requirementStatus,
    requirementCreatedAt: row.requirementCreatedAt
      ? row.requirementCreatedAt.toISOString()
      : null,
    coverageStatus: row.coverageStatus as SnapshotEntryRecord["coverageStatus"],
    linkedCaseCount: row.linkedCaseCount,
    cases: Array.isArray(row.cases) ? (row.cases as SnapshotCaseRecord[]) : [],
  };
}

/**
 * Loads the live matrix (whole project, or `rootIds`' subtrees) and
 * persists it as a snapshot: one header row with the summary counts, one
 * entry per requirement. Header and entries land in one transaction, so
 * a failed capture leaves nothing behind.
 */
export async function captureRequirementTraceabilitySnapshot(
  input: CaptureRequirementTraceabilitySnapshotInput,
  scope: RequirementCoverageScope,
  db: typeof baseDb = baseDb
): Promise<RequirementTraceabilitySnapshotHeader> {
  const data = await loadRequirementTraceability(input.projectId, scope, db, {
    rootIds: input.rootIds,
    executionScope: input.executionScope,
  });
  const entries = groupTraceabilityRows(data.rows);
  const summary = summarizeSnapshotEntries(entries);
  const scopeRequirementIds = input.rootIds ?? [];

  const created = await db.$transaction(async (tx) => {
    const snapshot = await tx.requirementTraceabilitySnapshot.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        note: input.note ?? null,
        capturedById: input.capturedById,
        capturedAt: new Date(data.generatedAt),
        scopeRequirementIds,
        scopeMilestoneIds: input.executionScope?.milestoneIds ?? [],
        scopeConfigIds: input.executionScope?.configIds ?? [],
        ...summary,
      },
      select: HEADER_SELECT,
    });

    for (
      let offset = 0;
      offset < entries.length;
      offset += ENTRY_INSERT_CHUNK
    ) {
      await tx.requirementTraceabilitySnapshotEntry.createMany({
        data: entries
          .slice(offset, offset + ENTRY_INSERT_CHUNK)
          .map((entry) => toEntryRow(snapshot.id, entry)),
      });
    }

    return snapshot;
  });

  return toHeader(created);
}

export interface LoadedRequirementTraceabilitySnapshot {
  snapshot: RequirementTraceabilitySnapshotHeader;
  projectName: string;
  entries: SnapshotEntryRecord[];
}

/**
 * Loads a live (non-deleted) snapshot that belongs to `projectId` with
 * its entries in stored order. `null` when no such snapshot exists — a
 * caller-supplied id from another project resolves to nothing rather
 * than to that project's record.
 */
export async function loadRequirementTraceabilitySnapshot(
  snapshotId: number,
  projectId: number,
  db: typeof baseDb = baseDb
): Promise<LoadedRequirementTraceabilitySnapshot | null> {
  const row = await db.requirementTraceabilitySnapshot.findFirst({
    where: { id: snapshotId, projectId, isDeleted: false },
    select: { ...HEADER_SELECT, project: { select: { name: true } } },
  });
  if (!row) return null;

  const entryRows = await db.requirementTraceabilitySnapshotEntry.findMany({
    where: { snapshotId },
    orderBy: { id: "asc" },
  });

  return {
    snapshot: toHeader(row),
    projectName: row.project?.name ?? "",
    entries: entryRows.map(fromEntryRow),
  };
}

/**
 * The snapshot as the live route's own response shape — `generatedAt` is
 * the capture instant and `snapshot` names the record — so the PDF
 * exporter and the report handler consume it exactly like a live load.
 */
export function toSnapshotTraceabilityData(
  loaded: LoadedRequirementTraceabilitySnapshot,
  entries: SnapshotEntryRecord[] = loaded.entries
): RequirementTraceabilityData {
  return {
    projectId: loaded.snapshot.projectId,
    projectName: loaded.projectName,
    generatedAt: loaded.snapshot.capturedAt.toISOString(),
    snapshot: {
      id: loaded.snapshot.id,
      name: loaded.snapshot.name,
      capturedAt: loaded.snapshot.capturedAt.toISOString(),
    },
    rows: expandSnapshotEntries(entries, {
      id: loaded.snapshot.projectId,
      name: loaded.projectName,
    }),
  };
}
