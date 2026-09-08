import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getMemberCoverage } from "~/lib/services/milestoneMemberCoverage";
import { aggregateMilestoneReadiness } from "~/app/[locale]/projects/milestones/[projectId]/[milestoneId]/milestoneReadiness";
import { authOptions } from "~/server/auth";
import { isMilestoneInDateRange, milestoneDate } from "./milestoneDateRange";

/**
 * Milestone Readiness report (fast-follow READY, R5). One row per milestone,
 * surfacing the same release-readiness rollup the Issues panel shows (R1):
 * % of in-scope issues fully passing, plus the per-state counts.
 *
 * Unlike the Prisma-groupBy report routes, readiness can't be expressed as a
 * single aggregate — it's computed per milestone from `getMemberCoverage`
 * (this-milestone membership, descendant-inclusive results) folded through
 * `aggregateMilestoneReadiness`. So this route builds the standard report row
 * shape (`{ milestone: {name,id,icon}, [metricLabel]: number }`) directly
 * rather than via the shared handleReport machinery.
 *
 * Auth: the milestone list is drawn through the policy-scoped enhanced client,
 * so a caller only ever sees (and computes readiness for) milestones their
 * project access permits; the raw coverage query then runs on those ids only.
 */

interface ReadinessMetric {
  id: string;
  /** English label — doubles as the report row key and the picker fallback. */
  label: string;
  value: (r: {
    total: number;
    passed: number;
    failed: number;
    inProgress: number;
    notRun: number;
    uncovered: number;
    percentReady: number;
  }) => number;
}

// The "%" in the ready label makes the results table/chart format it as a
// percentage automatically (useReportColumns keys formatting off the label).
const METRICS: ReadinessMetric[] = [
  { id: "percentReady", label: "Ready (%)", value: (r) => r.percentReady },
  { id: "passed", label: "Passed", value: (r) => r.passed },
  { id: "failed", label: "Failed", value: (r) => r.failed },
  { id: "inProgress", label: "In Progress", value: (r) => r.inProgress },
  { id: "notRun", label: "Not Run", value: (r) => r.notRun },
  { id: "uncovered", label: "Uncovered", value: (r) => r.uncovered },
  { id: "totalIssues", label: "Total Issues", value: (r) => r.total },
];

const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

/**
 * Milestones the caller may see in this project (name, type icon, and window
 * dates for the Date dimension). Every visible milestone is returned; the date
 * filter is applied afterwards on each milestone's effective plotting date (see
 * `isMilestoneInDateRange`), so the filter and the chart stay consistent.
 */
async function listVisibleMilestones(session: any, projectId: number) {
  const db = await getEnhancedDb(session);
  return db.milestones.findMany({
    where: {
      projectId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      // Fields the shared MilestoneIconAndName renders (type icon + tracker
      // source glyph) so the results table matches the rest of the app.
      milestoneType: { select: { icon: { select: { name: true } } } },
      integrationId: true,
      externalKind: true,
      detachedAt: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const projectId = Number(req.nextUrl.searchParams.get("projectId"));
  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  const milestones = await listVisibleMilestones(session, projectId);

  return Response.json({
    dimensions: [
      {
        id: "milestone",
        label: "Milestone",
        values: milestones.map((m: any) => ({
          id: m.id,
          name: m.name,
          milestoneType: m.milestoneType,
        })),
      },
      // Milestones are inherently time-based; the Date dimension exposes each
      // milestone's start date so results can be grouped/plotted chronologically.
      { id: "date", label: "Start Date", values: [] },
    ],
    metrics: METRICS.map((m) => ({ id: m.id, label: m.label })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, dimensions, metrics, startDate, endDate } =
    await req.json();
  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }
  if (!Array.isArray(dimensions) || !dimensions.includes("milestone")) {
    return Response.json(
      { error: "The Milestone dimension is required" },
      { status: 400 }
    );
  }
  const unknownDim = dimensions.find(
    (id: string) => id !== "milestone" && id !== "date"
  );
  if (unknownDim) {
    return Response.json(
      { error: `Unsupported dimension: ${unknownDim}` },
      { status: 400 }
    );
  }
  const withDate = dimensions.includes("date");
  const selected: string[] =
    Array.isArray(metrics) && metrics.length > 0
      ? metrics
      : METRICS.map((m) => m.id);
  const unknown = selected.find((id) => !METRIC_BY_ID.has(id));
  if (unknown) {
    return Response.json(
      { error: `Unsupported metric: ${unknown}` },
      { status: 400 }
    );
  }

  // Filter on each milestone's effective plotting date (the same date the chart
  // renders), not a start/end window — so an undated milestone can't pass the
  // filter yet plot outside the visible range.
  const milestones = (
    await listVisibleMilestones(session, Number(projectId))
  ).filter((m: any) => isMilestoneInDateRange(m, { startDate, endDate }));
  const milestoneIds = milestones.map((m: any) => m.id);

  // Skip the (expensive) coverage query for milestones with no in-scope issues:
  // readiness is only meaningful once a milestone has member issues.
  const withIssues =
    milestoneIds.length > 0
      ? await baseDb.milestoneIssue.findMany({
          where: { milestoneId: { in: milestoneIds } },
          select: { milestoneId: true },
          distinct: ["milestoneId"],
        })
      : [];
  const scopedIds = new Set(withIssues.map((r) => r.milestoneId));

  // Readiness is a per-milestone query (getMemberCoverage), so fan out in
  // bounded chunks — serial is slow on projects with many milestones, all-at-
  // once would exhaust the connection pool. Chunking preserves the name order.
  const accessibleProjectIds = await resolveViewerProjectScope(session.user.id);
  const scoped = milestones.filter((m: any) => scopedIds.has(m.id));
  const CONCURRENCY = 8;
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < scoped.length; i += CONCURRENCY) {
    const rows = await Promise.all(
      scoped.slice(i, i + CONCURRENCY).map(async (milestone: any) => {
        const coverage = await getMemberCoverage(milestone.id, {
          projectId: Number(projectId),
          accessibleProjectIds,
        });
        const readiness = aggregateMilestoneReadiness(
          coverage,
          Object.keys(coverage).map(Number)
        );
        const mDate = milestoneDate(milestone);
        const row: Record<string, unknown> = {
          milestone: {
            id: milestone.id,
            name: milestone.name,
            // Nested shape the results table's MilestoneIconAndName expects, so
            // the milestone renders with the same icon + source glyph as elsewhere.
            milestoneType: milestone.milestoneType,
            integrationId: milestone.integrationId,
            externalKind: milestone.externalKind,
            detachedAt: milestone.detachedAt,
            // Window dates feed the milestone name's date-range tooltip.
            startedAt: milestone.startedAt,
            completedAt: milestone.completedAt,
            // Carry the milestone's date so time-based visualizations can plot
            // milestones chronologically on the X axis.
            date: mDate,
          },
        };
        // Date dimension: the milestone's date as its own groupable cell.
        if (withDate) {
          row.date = mDate ? { executedAt: mDate } : null;
        }
        for (const id of selected) {
          const metric = METRIC_BY_ID.get(id);
          if (metric) row[metric.label] = metric.value(readiness);
        }
        return row;
      })
    );
    results.push(...rows);
  }

  return Response.json({ results });
}
