/**
 * The requirement reports' visualization numbers, computed once over the
 * full row set: the traceability panel's state counts and top-level
 * hierarchy groups, its tiles, and the coverage-gaps (debt) panel's
 * counts, hierarchy groups and age buckets. The server returns the
 * matching summary beside a page of rows; the panels fall back to
 * computing it from the rows they have (payloads captured before the
 * summary existed).
 *
 * The arithmetic here is the panels' own, moved verbatim. Pure apart from
 * the requirement label helper; no database or framework imports.
 */
import { formatRequirementCellText } from "~/utils/issueDisplayText";

export interface HierarchyGroup {
  label: string;
  counts: Record<string, number>;
  total: number;
  /** The root requirement's own id, when known, so the bar's label can
   * link to the requirement. */
  requirementId?: number;
}

export const TOP_HIERARCHY_LIMIT = 10;

interface RequirementLikeRow {
  requirementId: number;
  coverageStatus?: string;
  requirementParentPath?: string;
  requirementKey?: string;
  requirementTitle?: string | null;
  requirementRootId?: number;
}

function rootOf(row: RequirementLikeRow): { root: string; rootId?: number } {
  const isRoot = !row.requirementParentPath;
  return {
    root: isRoot
      ? formatRequirementCellText(row)
      : row.requirementParentPath!.split(" > ")[0],
    rootId: row.requirementRootId ?? (isRoot ? row.requirementId : undefined),
  };
}

function rankGroups(groupsByRoot: Map<string, HierarchyGroup>) {
  const ranked = [...groupsByRoot.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label)
  );
  return {
    top: ranked.slice(0, TOP_HIERARCHY_LIMIT),
    folded: ranked.slice(TOP_HIERARCHY_LIMIT),
  };
}

// ---------------------------------------------------------------------
// Traceability: tiles + coverage panel
// ---------------------------------------------------------------------

export interface RequirementCoverageTilesSummary {
  /** Distinct requirements. */
  total: number;
  /** Requirements in any state but UNCOVERED. */
  covered: number;
  counts: Record<string, number>;
}

export interface RequirementTraceabilitySummary {
  tiles: RequirementCoverageTilesSummary;
  /** Distinct requirements per coverage state. */
  stateCounts: Record<string, number>;
  /** The top hierarchy groups, plus one with an empty label folding the
   * rest when there are more than TOP_HIERARCHY_LIMIT. */
  groups: HierarchyGroup[];
  /** How many groups the empty-label entry folds. */
  foldedCount: number;
}

export function summarizeRequirementCoverageTiles(
  rows: ReadonlyArray<
    Pick<RequirementLikeRow, "requirementId" | "coverageStatus">
  >
): RequirementCoverageTilesSummary {
  const statusById = new Map<number, string>();
  for (const row of rows) {
    if (!statusById.has(row.requirementId)) {
      statusById.set(row.requirementId, row.coverageStatus ?? "UNCOVERED");
    }
  }
  const counts: Record<string, number> = {
    PASSED: 0,
    FAILED: 0,
    NOT_RUN: 0,
    UNCOVERED: 0,
  };
  for (const status of statusById.values()) {
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const total = statusById.size;
  return { total, covered: total - counts.UNCOVERED, counts };
}

export function summarizeRequirementTraceability(
  rows: ReadonlyArray<RequirementLikeRow>
): RequirementTraceabilitySummary {
  // Dedupe to one entry per requirement; its root is the first segment
  // of the ancestors-only parent path, or the requirement itself when
  // it IS top-level.
  const byRequirement = new Map<
    number,
    { status: string; root: string; rootId?: number }
  >();
  for (const row of rows) {
    if (byRequirement.has(row.requirementId)) continue;
    const { root, rootId } = rootOf(row);
    byRequirement.set(row.requirementId, {
      status: row.coverageStatus ?? "UNCOVERED",
      root,
      rootId,
    });
  }

  const stateCounts: Record<string, number> = {};
  const groupsByRoot = new Map<string, HierarchyGroup>();
  for (const { status, root, rootId } of byRequirement.values()) {
    stateCounts[status] = (stateCounts[status] ?? 0) + 1;
    let group = groupsByRoot.get(root);
    if (!group) {
      group = { label: root, counts: {}, total: 0 };
      groupsByRoot.set(root, group);
    }
    if (group.requirementId == null && rootId != null) {
      group.requirementId = rootId;
    }
    group.counts[status] = (group.counts[status] ?? 0) + 1;
    group.total += 1;
  }

  const { top, folded } = rankGroups(groupsByRoot);
  if (folded.length > 0) {
    const other: HierarchyGroup = { label: "", counts: {}, total: 0 };
    for (const group of folded) {
      for (const [status, count] of Object.entries(group.counts)) {
        other.counts[status] = (other.counts[status] ?? 0) + count;
      }
      other.total += group.total;
    }
    top.push(other);
  }

  return {
    tiles: summarizeRequirementCoverageTiles(rows),
    stateCounts,
    groups: top,
    foldedCount: folded.length,
  };
}

// ---------------------------------------------------------------------
// Coverage gaps: debt panel
// ---------------------------------------------------------------------

interface DebtLikeRow extends RequirementLikeRow {
  requirementStatus?: string | null;
  requirementCreatedAt?: string | null;
}

/**
 * Display heuristic ONLY (a stat tile, never a gate): statuses are
 * free-text per project/tracker, so "closed" has no canonical flag in the
 * data model. This set covers the standard closed-ish vocabulary of the
 * supported trackers; a project with its own vocabulary simply counts 0
 * here and loses nothing but the tile's insight.
 */
export const CLOSED_STATUS_HEURISTIC = new Set([
  "closed",
  "done",
  "resolved",
  "completed",
  "complete",
  "rejected",
  "cancelled",
  "canceled",
  "won't do",
  "wont do",
  "wontfix",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

// Half-open ranges checked in order: [0,30) [30,90) [90,180) [180,365)
// [365,∞) — an item exactly on a boundary lands in the HIGHER bucket.
export const DEBT_AGE_BUCKETS = [
  { key: "ageUnder30", max: 30 },
  { key: "age30to90", max: 90 },
  { key: "age90to180", max: 180 },
  { key: "age180to365", max: 365 },
  { key: "ageOver365", max: Infinity },
] as const;

export interface RequirementDebtSummary {
  counts: {
    total: number;
    uncovered: number;
    notRun: number;
    onClosed: number;
  };
  hierarchyGroups: HierarchyGroup[];
  foldedCount: number;
  otherTotal: number;
  /** One group per DEBT_AGE_BUCKETS entry, labelled by its key. */
  ageBuckets: HierarchyGroup[];
}

export function summarizeRequirementDebt(
  rows: ReadonlyArray<DebtLikeRow>,
  now: number = Date.now()
): RequirementDebtSummary {
  const counts = {
    total: rows.length,
    uncovered: 0,
    notRun: 0,
    onClosed: 0,
  };
  const groupsByRoot = new Map<string, HierarchyGroup>();
  const ageCounts = DEBT_AGE_BUCKETS.map(() => ({
    UNCOVERED: 0,
    NOT_RUN: 0,
  })) as Array<Record<string, number>>;

  for (const row of rows) {
    const status = row.coverageStatus === "NOT_RUN" ? "NOT_RUN" : "UNCOVERED";
    if (status === "NOT_RUN") counts.notRun += 1;
    else counts.uncovered += 1;

    if (
      CLOSED_STATUS_HEURISTIC.has(
        (row.requirementStatus ?? "").trim().toLowerCase()
      )
    ) {
      counts.onClosed += 1;
    }

    const { root, rootId } = rootOf(row);
    let group = groupsByRoot.get(root);
    if (!group) {
      group = { label: root, counts: {}, total: 0 };
      groupsByRoot.set(root, group);
    }
    if (group.requirementId == null && rootId != null) {
      group.requirementId = rootId;
    }
    group.counts[status] = (group.counts[status] ?? 0) + 1;
    group.total += 1;

    const createdMs = row.requirementCreatedAt
      ? Date.parse(row.requirementCreatedAt)
      : NaN;
    if (Number.isFinite(createdMs)) {
      const ageDays = Math.max(0, (now - createdMs) / DAY_MS);
      const bucket = DEBT_AGE_BUCKETS.findIndex((def) => ageDays < def.max);
      const target =
        ageCounts[bucket === -1 ? DEBT_AGE_BUCKETS.length - 1 : bucket];
      target[status] = (target[status] ?? 0) + 1;
    }
  }

  const { top, folded } = rankGroups(groupsByRoot);
  return {
    counts,
    hierarchyGroups: top,
    foldedCount: folded.length,
    otherTotal: folded.reduce((sum, group) => sum + group.total, 0),
    ageBuckets: DEBT_AGE_BUCKETS.map((def, index) => ({
      label: def.key,
      counts: ageCounts[index],
      total:
        (ageCounts[index].UNCOVERED ?? 0) + (ageCounts[index].NOT_RUN ?? 0),
    })),
  };
}
