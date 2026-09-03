import type { RequirementCoverageStatus } from "~/lib/services/requirementCoverage";
import {
  filterRequirementsToRoots,
  type RequirementNode,
  type RequirementTraceabilityRow,
} from "~/lib/services/requirementTraceabilityExport";

/**
 * Pure shaping for requirement traceability snapshots — the persisted,
 * point-in-time copies of the traceability matrix.
 *
 * A snapshot stores ONE entry per requirement (identity, tree position,
 * classified coverage state, and the covering cases with their latest
 * results as JSON) rather than one row per requirement–case pair. The
 * two shapes are exact inverses of each other here: `groupTraceabilityRows`
 * folds the live matrix rows into entries at capture time, and
 * `expandSnapshotEntries` unfolds them back into the SAME
 * `RequirementTraceabilityRow[]` the traceability report, its CSV, and the
 * PDF exporter already render — so a snapshot flows through every existing
 * consumer untouched. `diffSnapshotEntries` compares two entry sets
 * (a baseline snapshot against a later snapshot or the live matrix) into
 * the coverage-changes report's rows.
 *
 * No runtime dependency on Prisma or any server-only module, matching
 * `requirementTraceabilityExport.ts`'s convention, so the client can
 * `import type` the shapes.
 */

export type SnapshotCaseRecord = {
  caseId: number;
  caseName: string;
  caseProjectId: number | null;
  caseProjectName: string | null;
  caseAutomated: boolean;
  caseSource: string | null;
  caseHasParameters: boolean;
  statusName: string | null;
  statusColor: string | null;
  executedAt: string | null;
};

export type SnapshotEntryRecord = {
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
  requirementCreatedAt: string | null;
  /** Issue.currentVersion at capture — which text revision this baseline
   * saw (null for entries captured before versioning shipped). */
  requirementVersion: number | null;
  coverageStatus: RequirementCoverageStatus;
  linkedCaseCount: number;
  cases: SnapshotCaseRecord[];
};

export type SnapshotSummary = {
  requirementCount: number;
  passedCount: number;
  failedCount: number;
  notRunCount: number;
  uncoveredCount: number;
  /** Requirement–case pairs; a gap row contributes zero. */
  caseLinkCount: number;
};

/**
 * Folds the matrix rows into one entry per requirement, preserving the
 * rows' own order (path order, cases by name) so entries persist and
 * reload in the same sequence. A requirement's single gap row becomes an
 * entry with no cases.
 */
export function groupTraceabilityRows(
  rows: RequirementTraceabilityRow[]
): SnapshotEntryRecord[] {
  const byRequirement = new Map<number, SnapshotEntryRecord>();

  for (const row of rows) {
    let entry = byRequirement.get(row.requirementId);
    if (!entry) {
      entry = {
        requirementId: row.requirementId,
        requirementKey: row.requirementKey,
        requirementTitle: row.requirementTitle,
        requirementPath: row.requirementPath,
        requirementParentPath: row.requirementParentPath,
        requirementParentId: row.requirementParentId ?? null,
        requirementRootId: row.requirementRootId ?? row.requirementId,
        requirementIssueTypeName: row.requirementIssueTypeName ?? null,
        requirementIssueTypeIconUrl: row.requirementIssueTypeIconUrl ?? null,
        requirementPriority: row.requirementPriority ?? null,
        requirementStatus: row.requirementStatus ?? null,
        requirementCreatedAt: row.requirementCreatedAt ?? null,
        requirementVersion: row.requirementVersion ?? null,
        coverageStatus: row.coverageStatus,
        linkedCaseCount: row.linkedCaseCount,
        cases: [],
      };
      byRequirement.set(row.requirementId, entry);
    }
    if (row.caseId !== null) {
      entry.cases.push({
        caseId: row.caseId,
        caseName: row.caseName ?? "",
        caseProjectId: row.caseProjectId,
        caseProjectName: row.caseProjectName,
        caseAutomated: row.caseAutomated ?? false,
        caseSource: row.caseSource ?? null,
        caseHasParameters: row.caseHasParameters ?? false,
        statusName: row.statusName,
        statusColor: row.statusColor,
        executedAt: row.executedAt,
      });
    }
  }

  return [...byRequirement.values()];
}

/**
 * Unfolds entries back into matrix rows — the exact inverse of
 * `groupTraceabilityRows`, including `buildTraceabilityRows`'s final
 * path-then-case ordering, so a snapshot renders through the same table,
 * CSV, and PDF code as the live matrix.
 */
export function expandSnapshotEntries(
  entries: SnapshotEntryRecord[],
  /**
   * The snapshot's own project, restored onto every row. A snapshot is
   * always captured from exactly one project, so this is not persisted per
   * entry — but the live loader stamps it on every row, and this function
   * is that loader's exact inverse, so it has to be restored here or a
   * snapshot's rows would differ from the live rows they were folded from.
   */
  project?: { id: number; name: string } | null
): RequirementTraceabilityRow[] {
  const rows: RequirementTraceabilityRow[] = [];

  for (const entry of entries) {
    const base = {
      requirementId: entry.requirementId,
      requirementKey: entry.requirementKey,
      requirementTitle: entry.requirementTitle,
      requirementPath: entry.requirementPath,
      requirementParentPath: entry.requirementParentPath,
      requirementIssueTypeName: entry.requirementIssueTypeName,
      requirementIssueTypeIconUrl: entry.requirementIssueTypeIconUrl,
      // Always emitted, null when the caller supplied no project: the live
      // builder always sets both keys, and this function is its exact
      // inverse -- a missing key is not the same shape as a null one.
      requirementProjectId: project?.id ?? null,
      requirementProjectName: project?.name ?? null,
      requirementPriority: entry.requirementPriority,
      requirementStatus: entry.requirementStatus,
      requirementCreatedAt: entry.requirementCreatedAt,
      requirementVersion: entry.requirementVersion,
      requirementRootId: entry.requirementRootId,
      requirementParentId: entry.requirementParentId,
      linkedCaseCount: entry.linkedCaseCount,
      coverageStatus: entry.coverageStatus,
    };

    if (entry.cases.length === 0) {
      rows.push({
        ...base,
        caseId: null,
        caseName: null,
        caseProjectId: null,
        caseProjectName: null,
        statusName: null,
        statusColor: null,
        executedAt: null,
      });
      continue;
    }

    for (const coveringCase of entry.cases) {
      rows.push({
        ...base,
        caseId: coveringCase.caseId,
        caseName: coveringCase.caseName,
        caseAutomated: coveringCase.caseAutomated,
        caseSource: coveringCase.caseSource,
        caseHasParameters: coveringCase.caseHasParameters,
        caseProjectId: coveringCase.caseProjectId,
        caseProjectName: coveringCase.caseProjectName,
        statusName: coveringCase.statusName,
        statusColor: coveringCase.statusColor,
        executedAt: coveringCase.executedAt,
      });
    }
  }

  rows.sort((a, b) => {
    const pathCompare = a.requirementPath.localeCompare(b.requirementPath);
    if (pathCompare !== 0) return pathCompare;
    return (a.caseName ?? "").localeCompare(b.caseName ?? "");
  });

  return rows;
}

/** The header counts a snapshot list renders without loading entries. */
export function summarizeSnapshotEntries(
  entries: SnapshotEntryRecord[]
): SnapshotSummary {
  const summary: SnapshotSummary = {
    requirementCount: entries.length,
    passedCount: 0,
    failedCount: 0,
    notRunCount: 0,
    uncoveredCount: 0,
    caseLinkCount: 0,
  };
  for (const entry of entries) {
    switch (entry.coverageStatus) {
      case "PASSED":
        summary.passedCount += 1;
        break;
      case "FAILED":
        summary.failedCount += 1;
        break;
      case "NOT_RUN":
        summary.notRunCount += 1;
        break;
      default:
        summary.uncoveredCount += 1;
    }
    summary.caseLinkCount += entry.cases.length;
  }
  return summary;
}

/**
 * Confines a snapshot's entries to the subtrees of `rootIds`, using the
 * SAME requirement-only forest walk the live report uses
 * (`filterRequirementsToRoots`) over the parent ids frozen at capture.
 * Paths stay as captured — they were built relative to the capture's own
 * scope, and rewriting them would misrepresent the record.
 */
export function scopeSnapshotEntries(
  entries: SnapshotEntryRecord[],
  rootIds: number[]
): SnapshotEntryRecord[] {
  const nodes: RequirementNode[] = entries.map((entry) => ({
    id: entry.requirementId,
    name: entry.requirementKey,
    title: entry.requirementTitle,
    externalUrl: null,
    parentId: entry.requirementParentId,
  }));
  const keep = new Set(
    filterRequirementsToRoots(nodes, rootIds).map((node) => node.id)
  );
  return entries.filter((entry) => keep.has(entry.requirementId));
}

export const REQUIREMENT_COVERAGE_CHANGE_KINDS = [
  "ADDED",
  "REMOVED",
  "COVERAGE_CHANGED",
  "LINKS_CHANGED",
  "RESULTS_CHANGED",
  "UNCHANGED",
] as const;

export type RequirementCoverageChangeKind =
  (typeof REQUIREMENT_COVERAGE_CHANGE_KINDS)[number];

/**
 * One requirement's row in the coverage-changes report: what its
 * coverage looked like in the baseline snapshot versus the comparison
 * (a later snapshot, or the live matrix), with the change classified by
 * precedence — REMOVED / ADDED (present on one side only), then
 * COVERAGE_CHANGED (classified state differs), then LINKS_CHANGED (the
 * covering-case set or link count differs), then RESULTS_CHANGED (same
 * cases, but a latest result or execution time moved), else UNCHANGED.
 */
export type RequirementCoverageChangeRow = {
  requirementId: number;
  requirementKey: string;
  requirementTitle: string | null;
  requirementPath: string;
  requirementParentPath: string;
  requirementIssueTypeName: string | null;
  requirementIssueTypeIconUrl: string | null;
  requirementRootId: number;
  changeKind: RequirementCoverageChangeKind;
  /** Null exactly when the requirement is ADDED (absent from the baseline). */
  previousCoverageStatus: RequirementCoverageStatus | null;
  /** Null exactly when the requirement is REMOVED (absent from the comparison). */
  currentCoverageStatus: RequirementCoverageStatus | null;
  previousLinkedCaseCount: number | null;
  currentLinkedCaseCount: number | null;
  casesAdded: number;
  casesRemoved: number;
  /** Cases present on both sides whose latest result or execution time differs. */
  resultsChanged: number;
};

function identityOf(entry: SnapshotEntryRecord) {
  return {
    requirementId: entry.requirementId,
    requirementKey: entry.requirementKey,
    requirementTitle: entry.requirementTitle,
    requirementPath: entry.requirementPath,
    requirementParentPath: entry.requirementParentPath,
    requirementIssueTypeName: entry.requirementIssueTypeName,
    requirementIssueTypeIconUrl: entry.requirementIssueTypeIconUrl,
    requirementRootId: entry.requirementRootId,
  };
}

function compareEntries(
  before: SnapshotEntryRecord,
  after: SnapshotEntryRecord
): RequirementCoverageChangeRow {
  const beforeCases = new Map(before.cases.map((c) => [c.caseId, c]));
  const afterCases = new Map(after.cases.map((c) => [c.caseId, c]));

  let casesAdded = 0;
  let casesRemoved = 0;
  let resultsChanged = 0;
  for (const [caseId, current] of afterCases) {
    const previous = beforeCases.get(caseId);
    if (!previous) {
      casesAdded += 1;
    } else if (
      previous.statusName !== current.statusName ||
      previous.executedAt !== current.executedAt
    ) {
      resultsChanged += 1;
    }
  }
  for (const caseId of beforeCases.keys()) {
    if (!afterCases.has(caseId)) casesRemoved += 1;
  }

  const changeKind: RequirementCoverageChangeKind =
    before.coverageStatus !== after.coverageStatus
      ? "COVERAGE_CHANGED"
      : casesAdded > 0 ||
          casesRemoved > 0 ||
          before.linkedCaseCount !== after.linkedCaseCount
        ? "LINKS_CHANGED"
        : resultsChanged > 0
          ? "RESULTS_CHANGED"
          : "UNCHANGED";

  return {
    ...identityOf(after),
    changeKind,
    previousCoverageStatus: before.coverageStatus,
    currentCoverageStatus: after.coverageStatus,
    previousLinkedCaseCount: before.linkedCaseCount,
    currentLinkedCaseCount: after.linkedCaseCount,
    casesAdded,
    casesRemoved,
    resultsChanged,
  };
}

/**
 * Diffs a baseline entry set against a comparison set, one row per
 * requirement present on either side, in path order. Identity fields
 * (key, title, path, icon) come from the comparison side when the
 * requirement is still present — the current name is what a reader
 * recognises — and from the baseline for a REMOVED requirement.
 */
export function diffSnapshotEntries(
  baseline: SnapshotEntryRecord[],
  comparison: SnapshotEntryRecord[]
): RequirementCoverageChangeRow[] {
  const baselineById = new Map(
    baseline.map((entry) => [entry.requirementId, entry])
  );
  const comparisonIds = new Set(comparison.map((entry) => entry.requirementId));

  const rows: RequirementCoverageChangeRow[] = [];
  for (const entry of comparison) {
    const before = baselineById.get(entry.requirementId);
    rows.push(
      before
        ? compareEntries(before, entry)
        : {
            ...identityOf(entry),
            changeKind: "ADDED",
            previousCoverageStatus: null,
            currentCoverageStatus: entry.coverageStatus,
            previousLinkedCaseCount: null,
            currentLinkedCaseCount: entry.linkedCaseCount,
            casesAdded: entry.cases.length,
            casesRemoved: 0,
            resultsChanged: 0,
          }
    );
  }
  for (const entry of baseline) {
    if (comparisonIds.has(entry.requirementId)) continue;
    rows.push({
      ...identityOf(entry),
      changeKind: "REMOVED",
      previousCoverageStatus: entry.coverageStatus,
      currentCoverageStatus: null,
      previousLinkedCaseCount: entry.linkedCaseCount,
      currentLinkedCaseCount: null,
      casesAdded: 0,
      casesRemoved: entry.cases.length,
      resultsChanged: 0,
    });
  }

  rows.sort((a, b) => a.requirementPath.localeCompare(b.requirementPath));
  return rows;
}

export type RequirementCoverageChangeSummary = {
  byKind: Record<RequirementCoverageChangeKind, number>;
  /** Was UNCOVERED, now has coverage (any covered state). */
  newlyCovered: number;
  /** Had coverage, now UNCOVERED. */
  newlyUncovered: number;
  /** Was not FAILED (or absent), now FAILED. */
  nowFailing: number;
  /** Was FAILED, now any other state. */
  noLongerFailing: number;
};

/**
 * The headline tiles for the coverage-changes report, derived from the
 * SAME rows the table shows. The four transition counters are not a
 * partition of the rows (an UNCOVERED → FAILED requirement is both newly
 * covered and now failing); the per-kind counts are.
 */
export function summarizeCoverageChanges(
  rows: RequirementCoverageChangeRow[]
): RequirementCoverageChangeSummary {
  const byKind = Object.fromEntries(
    REQUIREMENT_COVERAGE_CHANGE_KINDS.map((kind) => [kind, 0])
  ) as Record<RequirementCoverageChangeKind, number>;
  const summary: RequirementCoverageChangeSummary = {
    byKind,
    newlyCovered: 0,
    newlyUncovered: 0,
    nowFailing: 0,
    noLongerFailing: 0,
  };

  for (const row of rows) {
    byKind[row.changeKind] += 1;
    const previous = row.previousCoverageStatus;
    const current = row.currentCoverageStatus;
    const wasCovered = previous !== null && previous !== "UNCOVERED";
    const isCovered = current !== null && current !== "UNCOVERED";
    if (!wasCovered && isCovered) summary.newlyCovered += 1;
    if (wasCovered && current !== null && !isCovered) {
      summary.newlyUncovered += 1;
    }
    if (previous !== "FAILED" && current === "FAILED") summary.nowFailing += 1;
    if (previous === "FAILED" && current !== null && current !== "FAILED") {
      summary.noLongerFailing += 1;
    }
  }

  return summary;
}
