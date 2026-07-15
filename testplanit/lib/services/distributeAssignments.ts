/**
 * Pure, deterministic distribution of test-run-case assignments across team
 * members. Client-safe (no DB imports) so the run-page modal can preview with
 * the exact function the server action commits with — preview always equals
 * commit.
 *
 * Two strategies map onto the data model (configurations are separate sibling
 * TestRuns joined by configurationGroupId, each with its own TestRunCases rows):
 *   - KEEP_CONFIGS_TOGETHER: a repository case is assigned to ONE user across
 *     all of its config rows (each case is learned once, repeated per config).
 *   - SPLIT_BY_CONFIG: a whole sibling run (one configuration) is assigned to a
 *     user (minimises environment switching).
 *
 * Similarity: cases are ordered by folder-tree position then a tag signature so
 * related cases sit contiguously; whole folder sections stay with one user, and
 * an oversized section is split along tag-cluster boundaries to bound imbalance.
 *
 * Balancing: by summed `estimate` (effort) by default, falling back to the
 * median estimate for cases with none, and to case-count when no case has an
 * estimate. Determinism comes from total, stable ordering — there is no
 * randomness (Math.random is unavailable in the workflow/algorithm contexts).
 */

export type DistributeStrategy = "KEEP_CONFIGS_TOGETHER" | "SPLIT_BY_CONFIG";
export type ReassignMode = "ONLY_UNASSIGNED" | "REASSIGN_ALL";
export type WeightBy = "ESTIMATE" | "COUNT";

/** One TestRunCases row (a case within one sibling/config run). */
export interface AssignableUnit {
  testRunCaseId: number;
  repositoryCaseId: number;
  runId: number;
  folderId: number;
  /** Root→leaf chain of folder `order` values, prefixed with repositoryId. */
  folderOrderPath: number[];
  caseOrder: number;
  estimate: number | null;
  tagIds: number[];
  isCaseCompleted: boolean;
  currentAssigneeId: string | null;
}

export interface DistributeOptions {
  /** Selection order is the deterministic tiebreak when loads are equal. */
  userIds: string[];
  strategy: DistributeStrategy;
  groupBySections: boolean;
  reassignMode: ReassignMode;
  /** Completed cases can never be reassigned; default false. */
  includeCompleted?: boolean;
  /** Default ESTIMATE; degrades to COUNT when no unit has an estimate. */
  weightBy?: WeightBy;
  /** Split a section only when its weight exceeds this × fairShare. */
  splitThreshold?: number;
}

export interface PerUserStat {
  userId: string;
  caseCount: number;
  /** The balancing weight (case count, or effort in seconds when weighted). */
  weight: number;
  /** Estimated effort in seconds, always populated regardless of `weightBy`. */
  effort: number;
}
export interface PerUserConfigStat {
  userId: string;
  runId: number;
  count: number;
}
export type SkipReason = "completed" | "kept-assigned";
export interface SkippedUnit {
  testRunCaseId: number;
  reason: SkipReason;
}

export interface DistributePlan {
  /** Desired final assignee per distributed row (excludes skipped rows). */
  assignments: Array<{ testRunCaseId: number; assignedToId: string }>;
  perUser: PerUserStat[];
  perUserPerConfig: PerUserConfigStat[];
  skipped: SkippedUnit[];
  fairShare: number;
  /** The weighting actually applied (may differ from the requested mode). */
  weightByUsed: WeightBy;
  /** True when at least one distributed case carries an estimate. */
  hasEstimates: boolean;
}

const DEFAULT_SPLIT_THRESHOLD = 1.5;

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function compareNumberArrays(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** Stable per-case signature: sorted tag ids joined; "" for untagged. */
function tagSignature(tagIds: number[]): string {
  return [...tagIds].sort((a, b) => a - b).join(",");
}

/** A repository case collapsed across its sibling/config rows (KEEP mode). */
interface LogicalUnit {
  repositoryCaseId: number;
  rowIds: number[];
  weight: number;
  folderId: number;
  folderOrderPath: number[];
  caseOrder: number;
  tagSig: string;
}

function compareLogical(a: LogicalUnit, b: LogicalUnit): number {
  const p = compareNumberArrays(a.folderOrderPath, b.folderOrderPath);
  if (p !== 0) return p;
  if (a.folderId !== b.folderId) return a.folderId - b.folderId;
  if (a.tagSig !== b.tagSig) return a.tagSig < b.tagSig ? -1 : 1;
  if (a.caseOrder !== b.caseOrder) return a.caseOrder - b.caseOrder;
  return a.repositoryCaseId - b.repositoryCaseId;
}

export function buildDistributionPlan(
  units: AssignableUnit[],
  options: DistributeOptions
): DistributePlan {
  const {
    userIds,
    strategy,
    groupBySections,
    reassignMode,
    includeCompleted = false,
    weightBy = "ESTIMATE",
    splitThreshold = DEFAULT_SPLIT_THRESHOLD,
  } = options;

  const skipped: SkippedUnit[] = [];

  // 1. Drop completed rows (they can never be reassigned).
  const active: AssignableUnit[] = [];
  for (const u of units) {
    if (u.isCaseCompleted && !includeCompleted) {
      skipped.push({ testRunCaseId: u.testRunCaseId, reason: "completed" });
    } else {
      active.push(u);
    }
  }

  // 2. Resolve weighting: ESTIMATE only when at least one active row has one.
  const presentEstimates = active
    .map((u) => u.estimate)
    .filter((e): e is number => e != null);
  const hasEstimates = presentEstimates.length > 0;
  const weightByUsed: WeightBy =
    weightBy === "ESTIMATE" && hasEstimates ? "ESTIMATE" : "COUNT";
  const estimateMedian = median(presentEstimates);
  const weightOf = (u: AssignableUnit): number =>
    weightByUsed === "COUNT" ? 1 : (u.estimate ?? estimateMedian);
  // Effort (seconds) is reported regardless of the balancing weight so the UI
  // can show estimated time even when distributing by case count. Missing
  // estimates borrow the median; zero when no case has an estimate.
  const effortMedian = hasEstimates ? estimateMedian : 0;
  const effortOf = (u: AssignableUnit): number => u.estimate ?? effortMedian;

  const assignments = new Map<number, string>();
  const load = new Map<string, number>();
  for (const id of userIds) load.set(id, 0);

  // No users → nothing to assign; only completed rows are already skipped.
  if (userIds.length === 0) {
    return finalize(
      active,
      assignments,
      skipped,
      0,
      weightByUsed,
      weightOf,
      effortOf,
      hasEstimates
    );
  }

  const seed = (userId: string | null, w: number) => {
    if (userId != null && load.has(userId)) {
      load.set(userId, (load.get(userId) ?? 0) + w);
    }
  };

  if (strategy === "SPLIT_BY_CONFIG") {
    distributeByConfig(active, {
      reassignMode,
      userIds,
      load,
      assignments,
      skipped,
      seed,
      weightOf,
    });
    const fairShare =
      totalWeight(active, assignments, weightOf) / userIds.length;
    return finalize(
      active,
      assignments,
      skipped,
      fairShare,
      weightByUsed,
      weightOf,
      effortOf,
      hasEstimates
    );
  }

  // KEEP_CONFIGS_TOGETHER — collapse sibling rows into one logical unit/case.
  const byCase = new Map<number, AssignableUnit[]>();
  for (const u of active) {
    const list = byCase.get(u.repositoryCaseId);
    if (list) list.push(u);
    else byCase.set(u.repositoryCaseId, [u]);
  }

  const assignable: LogicalUnit[] = [];
  for (const [repositoryCaseId, rows] of byCase) {
    const anyAssigned = rows.some((r) => r.currentAssigneeId != null);
    // Conservative: a case with any already-assigned config is left entirely
    // alone in ONLY_UNASSIGNED mode (its rows are seeded so balancing accounts
    // for the existing owner).
    if (reassignMode === "ONLY_UNASSIGNED" && anyAssigned) {
      for (const r of rows) {
        skipped.push({
          testRunCaseId: r.testRunCaseId,
          reason: "kept-assigned",
        });
        seed(r.currentAssigneeId, weightOf(r));
      }
      continue;
    }
    const first = rows[0];
    assignable.push({
      repositoryCaseId,
      rowIds: rows.map((r) => r.testRunCaseId),
      weight: rows.reduce((s, r) => s + weightOf(r), 0),
      folderId: first.folderId,
      folderOrderPath: first.folderOrderPath,
      caseOrder: first.caseOrder,
      tagSig: tagSignature(first.tagIds),
    });
  }

  assignable.sort(compareLogical);

  const totalToDistribute = assignable.reduce((s, lu) => s + lu.weight, 0);
  const fairShare = totalToDistribute / userIds.length;
  const splitCap = splitThreshold * fairShare;

  const leastLoaded = (): string => {
    let best = userIds[0];
    let bestLoad = load.get(best) ?? 0;
    for (let i = 1; i < userIds.length; i++) {
      const l = load.get(userIds[i]) ?? 0;
      if (l < bestLoad) {
        best = userIds[i];
        bestLoad = l;
      }
    }
    return best;
  };

  const assignUnit = (lu: LogicalUnit, userId: string) => {
    for (const id of lu.rowIds) assignments.set(id, userId);
    load.set(userId, (load.get(userId) ?? 0) + lu.weight);
  };

  if (!groupBySections) {
    // Grouping off — pure greedy longest-processing-time over cases.
    for (const lu of [...assignable].sort(
      (a, b) => b.weight - a.weight || compareLogical(a, b)
    )) {
      assignUnit(lu, leastLoaded());
    }
    return finalize(
      active,
      assignments,
      skipped,
      fairShare,
      weightByUsed,
      weightOf,
      effortOf,
      hasEstimates
    );
  }

  // Grouping on — keep folder sections (and, when split, tag-clusters) intact.
  for (const section of contiguousGroups(assignable, (lu) => lu.folderId)) {
    const sectionWeight = section.reduce((s, lu) => s + lu.weight, 0);
    if (sectionWeight <= splitCap) {
      const owner = leastLoaded();
      for (const lu of section) assignUnit(lu, owner);
      continue;
    }
    // Oversized section: assign whole tag-clusters greedily; split a cluster
    // that is itself oversized into contiguous blocks per user.
    for (const cluster of contiguousGroups(section, (lu) => lu.tagSig)) {
      const clusterWeight = cluster.reduce((s, lu) => s + lu.weight, 0);
      if (clusterWeight <= splitCap) {
        const owner = leastLoaded();
        for (const lu of cluster) assignUnit(lu, owner);
      } else {
        let target = leastLoaded();
        for (const lu of cluster) {
          if ((load.get(target) ?? 0) >= fairShare) {
            const lightest = leastLoaded();
            if ((load.get(lightest) ?? 0) < (load.get(target) ?? 0)) {
              target = lightest;
            }
          }
          assignUnit(lu, target);
        }
      }
    }
  }

  return finalize(
    active,
    assignments,
    skipped,
    fairShare,
    weightByUsed,
    weightOf,
    effortOf,
    hasEstimates
  );
}

interface ConfigCtx {
  reassignMode: ReassignMode;
  userIds: string[];
  load: Map<string, number>;
  assignments: Map<number, string>;
  skipped: SkippedUnit[];
  seed: (userId: string | null, w: number) => void;
  weightOf: (u: AssignableUnit) => number;
}

/** SPLIT_BY_CONFIG: assign each sibling run (config) wholesale to one user. */
function distributeByConfig(active: AssignableUnit[], ctx: ConfigCtx): void {
  const { reassignMode, userIds, load, assignments, skipped, seed, weightOf } =
    ctx;

  const byRun = new Map<number, AssignableUnit[]>();
  for (const u of active) {
    const list = byRun.get(u.runId);
    if (list) list.push(u);
    else byRun.set(u.runId, [u]);
  }

  const runUnits: Array<{ runId: number; rowIds: number[]; weight: number }> =
    [];
  for (const [runId, rows] of byRun) {
    const assignableRows =
      reassignMode === "ONLY_UNASSIGNED"
        ? rows.filter((r) => r.currentAssigneeId == null)
        : rows;
    if (reassignMode === "ONLY_UNASSIGNED") {
      for (const r of rows) {
        if (r.currentAssigneeId != null) {
          skipped.push({
            testRunCaseId: r.testRunCaseId,
            reason: "kept-assigned",
          });
          seed(r.currentAssigneeId, weightOf(r));
        }
      }
    }
    if (assignableRows.length === 0) continue;
    runUnits.push({
      runId,
      rowIds: assignableRows.map((r) => r.testRunCaseId),
      weight: assignableRows.reduce((s, r) => s + weightOf(r), 0),
    });
  }

  const leastLoaded = (): string => {
    let best = userIds[0];
    let bestLoad = load.get(best) ?? 0;
    for (let i = 1; i < userIds.length; i++) {
      const l = load.get(userIds[i]) ?? 0;
      if (l < bestLoad) {
        best = userIds[i];
        bestLoad = l;
      }
    }
    return best;
  };

  for (const ru of runUnits.sort(
    (a, b) => b.weight - a.weight || a.runId - b.runId
  )) {
    const owner = leastLoaded();
    for (const id of ru.rowIds) assignments.set(id, owner);
    load.set(owner, (load.get(owner) ?? 0) + ru.weight);
  }
}

/** Split a pre-sorted list into maximal contiguous runs sharing a key. */
function contiguousGroups<T, K>(items: T[], keyOf: (item: T) => K): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let currentKey: K | undefined;
  for (const item of items) {
    const key = keyOf(item);
    if (current.length === 0 || key === currentKey) {
      current.push(item);
    } else {
      groups.push(current);
      current = [item];
    }
    currentKey = key;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function totalWeight(
  active: AssignableUnit[],
  assignments: Map<number, string>,
  weightOf: (u: AssignableUnit) => number
): number {
  let total = 0;
  for (const u of active) {
    if (assignments.has(u.testRunCaseId)) total += weightOf(u);
  }
  return total;
}

function finalize(
  active: AssignableUnit[],
  assignments: Map<number, string>,
  skipped: SkippedUnit[],
  fairShare: number,
  weightByUsed: WeightBy,
  weightOf: (u: AssignableUnit) => number,
  effortOf: (u: AssignableUnit) => number,
  hasEstimates: boolean
): DistributePlan {
  const perUserMap = new Map<
    string,
    { caseCount: number; weight: number; effort: number }
  >();
  const perUserConfigMap = new Map<string, PerUserConfigStat>();
  const out: Array<{ testRunCaseId: number; assignedToId: string }> = [];

  for (const u of active) {
    const assignedToId = assignments.get(u.testRunCaseId);
    if (assignedToId == null) continue;
    out.push({ testRunCaseId: u.testRunCaseId, assignedToId });

    const pu = perUserMap.get(assignedToId) ?? {
      caseCount: 0,
      weight: 0,
      effort: 0,
    };
    pu.caseCount += 1;
    pu.weight += weightOf(u);
    pu.effort += effortOf(u);
    perUserMap.set(assignedToId, pu);

    const key = `${assignedToId}:${u.runId}`;
    const pc =
      perUserConfigMap.get(key) ??
      ({ userId: assignedToId, runId: u.runId, count: 0 } as PerUserConfigStat);
    pc.count += 1;
    perUserConfigMap.set(key, pc);
  }

  return {
    assignments: out,
    perUser: [...perUserMap.entries()].map(([userId, s]) => ({
      userId,
      caseCount: s.caseCount,
      weight: s.weight,
      effort: s.effort,
    })),
    perUserPerConfig: [...perUserConfigMap.values()],
    skipped,
    fairShare,
    weightByUsed,
    hasEstimates,
  };
}
