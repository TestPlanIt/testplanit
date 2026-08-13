import type { MilestoneSegment } from "~/lib/services/milestoneSummary";
import type { MilestoneExternalKind } from "~/zenstack/models";

/**
 * Pure shaping helpers for the milestone export snapshot.
 *
 * This module intentionally has no runtime dependency on Prisma or any
 * server-only module so the response types can be imported by the client
 * export hook (`import type`) without bundling server code. The endpoint at
 * `app/api/milestones/[milestoneId]/export/route.ts` performs the DB reads and
 * feeds the results through these functions.
 */

export type MilestoneExportStatusCount = {
  statusName: string;
  count: number;
  colorValue: string;
};

export type MilestoneExportRollup = {
  totalItems: number;
  executedItems: number;
  completionRate: number;
  totalElapsed: number;
  totalEstimate: number;
  statusCounts: MilestoneExportStatusCount[];
};

export type MilestoneExportRun = {
  id: number;
  name: string;
  totalItems: number;
  executedItems: number;
  /** Total recorded execution time for this run, in seconds. */
  elapsed: number;
  statusCounts: MilestoneExportStatusCount[];
};

export type MilestoneExportSession = {
  id: number;
  name: string;
  statusName: string;
  colorValue: string;
  isPending: boolean;
  /** Recorded execution time for the session's latest result, in seconds. */
  elapsed: number;
};

export type MilestoneExportDescendant = {
  id: number;
  name: string;
  status: string;
};

export type MilestoneExportIssue = {
  key: string;
  title: string;
  status: string | null;
};

export type MilestoneExportMemberIssue = {
  key: string;
  title: string;
  status: string | null;
  source: "SYNCED" | "MANUAL";
  /** Completed-outcome counts per real project status (matrix model). */
  coverageStatuses: { statusName: string; count: number; colorValue: string }[];
  untested: number;
  /** No completed outcome in scope (issue-level gap state). */
  uncovered: boolean;
};

export type MilestoneExportMemberCoverageTotals = {
  statuses: { statusName: string; count: number; colorValue: string }[];
  untested: number;
  uncoveredIssues: number;
};

/**
 * One row of the traceability matrix (READY, D4): a member issue paired with a
 * linked test case and that case's latest in-scope result. Issues with no
 * linked cases appear once with a null `caseName` (a coverage gap); a linked
 * case with no in-scope result has a null `statusName` ("Not run").
 */
export type MilestoneExportTraceabilityRow = {
  issueKey: string;
  issueTitle: string;
  caseName: string | null;
  statusName: string | null;
  statusColor: string | null;
  runName: string | null;
  executedAt: string | null;
};

export type MilestoneExportReviewDecision = {
  entityType: "RUN" | "SESSION";
  entityId: number;
  entityName: string;
  status: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
};

export type MilestoneExportData = {
  milestone: {
    id: number;
    name: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    /** Distinguishes calendar dates from instants; see `hasCalendarDates`. */
    externalKind: MilestoneExternalKind | null;
    ownerName: string | null;
    typeName: string | null;
    parentPath: string[];
  };
  rollup: MilestoneExportRollup;
  testRuns: MilestoneExportRun[];
  sessions: MilestoneExportSession[];
  descendants: MilestoneExportDescendant[];
  issues: MilestoneExportIssue[];
  memberIssues: MilestoneExportMemberIssue[];
  memberCoverageTotals: MilestoneExportMemberCoverageTotals;
  traceability: MilestoneExportTraceabilityRow[];
  reviewDecisions: MilestoneExportReviewDecision[];
  generatedAt: string;
  projectId: number;
};

/** Human-readable status for a milestone given its lifecycle flags. */
export function milestoneStatusLabel(milestone: {
  isCompleted: boolean;
  isStarted: boolean;
}): string {
  if (milestone.isCompleted) return "Completed";
  if (milestone.isStarted) return "In Progress";
  return "Not Started";
}

type SegmentLike = Pick<
  MilestoneSegment,
  "statusName" | "colorValue" | "isPending" | "itemCount"
>;

/**
 * Aggregate a flat list of status segments into per-status counts plus
 * executed/total tallies. Shared by the milestone-wide rollup and per-run
 * breakdowns (a milestone segment carries `itemCount` cases per status).
 */
export function aggregateStatusCounts(segments: SegmentLike[]): {
  statusCounts: MilestoneExportStatusCount[];
  totalItems: number;
  executedItems: number;
} {
  const byStatus = new Map<string, MilestoneExportStatusCount>();
  let totalItems = 0;
  let executedItems = 0;

  for (const seg of segments) {
    const count = seg.itemCount ?? 1;
    totalItems += count;
    if (!seg.isPending) executedItems += count;

    const existing = byStatus.get(seg.statusName);
    if (existing) {
      existing.count += count;
    } else {
      byStatus.set(seg.statusName, {
        statusName: seg.statusName,
        count,
        colorValue: seg.colorValue,
      });
    }
  }

  return {
    statusCounts: Array.from(byStatus.values()),
    totalItems,
    executedItems,
  };
}

/** Group test-run segments into one contributor row per run. */
export function groupTestRunContributors(
  testRunSegments: MilestoneSegment[]
): MilestoneExportRun[] {
  const byRun = new Map<
    number,
    { name: string; segments: MilestoneSegment[] }
  >();

  for (const seg of testRunSegments) {
    const entry = byRun.get(seg.sourceId);
    if (entry) {
      entry.segments.push(seg);
    } else {
      byRun.set(seg.sourceId, { name: seg.sourceName, segments: [seg] });
    }
  }

  return Array.from(byRun.entries()).map(([id, { name, segments }]) => {
    const { statusCounts, totalItems, executedItems } =
      aggregateStatusCounts(segments);
    const elapsed = segments.reduce((sum, seg) => sum + (seg.elapsed ?? 0), 0);
    return { id, name, totalItems, executedItems, elapsed, statusCounts };
  });
}

/** One contributor row per session (sessions carry a single latest status). */
export function mapSessionContributors(
  sessionSegments: MilestoneSegment[]
): MilestoneExportSession[] {
  return sessionSegments.map((seg) => ({
    id: seg.sourceId,
    name: seg.sourceName,
    statusName: seg.statusName,
    colorValue: seg.colorValue,
    isPending: seg.isPending,
    elapsed: seg.elapsed ?? 0,
  }));
}

type ReviewRequestLike = {
  entityType: "RUN" | "SESSION" | "CASE";
  entityId: number;
  status: string;
  decidedAt: Date | string | null;
  decisionComment: string | null;
  decidedBy?: { name: string | null } | null;
};

/**
 * Shape review requests for the contributing runs/sessions into decision rows,
 * resolving each entity's display name from the provided lookup. CASE-scoped
 * requests are dropped (a milestone aggregates runs and sessions only).
 */
export function shapeReviewDecisions(
  reviewRequests: ReviewRequestLike[],
  entityNameByKey: Map<string, string>
): MilestoneExportReviewDecision[] {
  const toIso = (v: Date | string | null) =>
    v == null ? null : v instanceof Date ? v.toISOString() : v;

  return reviewRequests
    .filter((r) => r.entityType === "RUN" || r.entityType === "SESSION")
    .map((r) => {
      const entityType = r.entityType as "RUN" | "SESSION";
      const key = `${entityType}:${r.entityId}`;
      return {
        entityType,
        entityId: r.entityId,
        entityName: entityNameByKey.get(key) ?? `#${r.entityId}`,
        status: r.status,
        decidedByName: r.decidedBy?.name ?? null,
        decidedAt: toIso(r.decidedAt),
        decisionComment: r.decisionComment,
      };
    });
}
