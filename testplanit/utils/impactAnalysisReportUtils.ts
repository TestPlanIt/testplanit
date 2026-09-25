import { baseDb } from "@/lib/db";
import { resolveRequestDateRange } from "~/lib/reports/dateRangePresets";
import { NextRequest } from "next/server";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import { parseEnumFilter, parseIdListFilter } from "~/utils/reportFilterParams";

export type ImpactTrigger = "manual" | "pull_request" | "push";
export type ImpactRunOutcome = "no_run" | "not_executed" | "passed" | "failed";
export type ImpactTriggerFilter = "all" | ImpactTrigger;
export type ImpactOutcomeFilter = "all" | ImpactRunOutcome;

/** The run an analysis composed, in the shape `TestRunNameDisplay` renders. */
export type ImpactReportTestRun = {
  id: number;
  name: string;
  isDeleted: boolean;
  configurationGroupId: string | null;
  configuration: { id: number; name: string } | null;
  compositionLockedAt: Date | null;
};

export interface ImpactAnalysisReportRow {
  analysisId: number;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  repository: {
    configId: number;
    repositoryId: number;
    name: string;
    provider: string;
    branch: string | null;
  };
  trigger: ImpactTrigger;
  triggerLabel: string | null;
  triggerUrl: string | null;
  baseRef: string;
  headRef: string;
  fileCount: number;
  additions: number;
  deletions: number;
  pinnedCaseCount: number;
  affectedCaseCount: number;
  relatedCaseCount: number;
  acceptedCaseCount: number;
  testRun: ImpactReportTestRun | null;
  runCaseCount: number;
  runExecutedCount: number;
  runPassedCount: number;
  runFailedCount: number;
  outcome: ImpactRunOutcome;
  createdBy: { id: string; name: string | null };
  project?: { id: number; name?: string };
}

export const IMPACT_TRIGGERS: readonly ImpactTrigger[] = [
  "manual",
  "pull_request",
  "push",
];
export const IMPACT_RUN_OUTCOMES: readonly ImpactRunOutcome[] = [
  "failed",
  "passed",
  "not_executed",
  "no_run",
];

/** A run's outcome is read from status flags, never from status names. */
export function classifyRunOutcome(counts: {
  hasRun: boolean;
  executed: number;
  failed: number;
}): ImpactRunOutcome {
  if (!counts.hasRun) return "no_run";
  if (counts.executed === 0) return "not_executed";
  return counts.failed > 0 ? "failed" : "passed";
}

export function triggerOf(value: string | null | undefined): ImpactTrigger {
  return value === "pull_request" || value === "push" ? value : "manual";
}

function shortRef(ref: string | null, sha: string): string {
  return ref ?? sha.slice(0, 7);
}

type AnalysisRecord = {
  id: number;
  createdAt: Date;
  completedAt: Date | null;
  status: string;
  trigger: string | null;
  triggerLabel: string | null;
  triggerUrl: string | null;
  baseRef: string | null;
  headRef: string | null;
  baseSha: string;
  headSha: string;
  fileCount: number;
  additions: number;
  deletions: number;
  pinnedCaseCount: number;
  affectedCaseCount: number;
  config: {
    id: number;
    branch: string | null;
    repository: { id: number; name: string; provider: string };
  };
  cases: Array<{ tier: string; accepted: boolean | null }>;
  testRun: {
    id: number;
    name: string;
    isDeleted: boolean;
    configurationGroupId: string | null;
    configuration: { id: number; name: string } | null;
    compositionLockedAt: Date | null;
    testCases: Array<{
      status: {
        isSuccess: boolean;
        isFailure: boolean;
        isCompleted: boolean;
      } | null;
    }>;
  } | null;
  createdBy: { id: string; name: string | null };
  project: { id: number; name: string };
};

export function toReportRow(
  analysis: AnalysisRecord,
  includeProject: boolean
): ImpactAnalysisReportRow {
  const runCases = analysis.testRun?.testCases ?? [];
  const executed = runCases.filter((c) => c.status?.isCompleted).length;
  const failed = runCases.filter((c) => c.status?.isFailure).length;
  const passed = runCases.filter((c) => c.status?.isSuccess).length;
  const durationMs =
    analysis.completedAt !== null
      ? analysis.completedAt.getTime() - analysis.createdAt.getTime()
      : null;
  return {
    analysisId: analysis.id,
    createdAt: analysis.createdAt.toISOString(),
    completedAt: analysis.completedAt?.toISOString() ?? null,
    durationMs,
    status: analysis.status,
    repository: {
      configId: analysis.config.id,
      repositoryId: analysis.config.repository.id,
      name: analysis.config.repository.name,
      provider: analysis.config.repository.provider,
      branch: analysis.config.branch,
    },
    trigger: triggerOf(analysis.trigger),
    triggerLabel: analysis.triggerLabel,
    triggerUrl: analysis.triggerUrl,
    baseRef: shortRef(analysis.baseRef, analysis.baseSha),
    headRef: shortRef(analysis.headRef, analysis.headSha),
    fileCount: analysis.fileCount,
    additions: analysis.additions,
    deletions: analysis.deletions,
    pinnedCaseCount: analysis.pinnedCaseCount,
    affectedCaseCount: analysis.affectedCaseCount,
    relatedCaseCount: analysis.cases.filter((c) => c.tier === "related").length,
    acceptedCaseCount: analysis.cases.filter((c) => c.accepted === true).length,
    testRun: analysis.testRun
      ? {
          id: analysis.testRun.id,
          name: analysis.testRun.name,
          isDeleted: analysis.testRun.isDeleted,
          configurationGroupId: analysis.testRun.configurationGroupId,
          configuration: analysis.testRun.configuration,
          compositionLockedAt: analysis.testRun.compositionLockedAt,
        }
      : null,
    runCaseCount: runCases.length,
    runExecutedCount: executed,
    runPassedCount: passed,
    runFailedCount: failed,
    outcome: classifyRunOutcome({
      hasRun: analysis.testRun !== null,
      executed,
      failed,
    }),
    createdBy: analysis.createdBy,
    ...(includeProject
      ? { project: { id: analysis.project.id, name: analysis.project.name } }
      : {}),
  };
}

/**
 * One row per Impact analysis in the window: what started it, what it
 * changed, how many cases it selected, and how the run it composed turned
 * out. Cross-project callers must be admins and may add the project column.
 */
export async function handleImpactAnalysisReportPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    const body = await req.json();
    const authz = await authorizeReportRequest(req, {
      requiresAdmin: isCrossProject,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;

    const { startDate, endDate } = resolveRequestDateRange(body);
    const {
      projectId,
      lookbackDays = 90,
      triggerFilter = "all",
      outcomeFilter = "all",
      configId,
      dimensions = [],
    } = body as {
      projectId?: number | string;
      lookbackDays?: number | string;
      // Lists of accepted values; the single-value form is also accepted.
      triggerFilter?: ImpactTriggerFilter | ImpactTrigger[];
      outcomeFilter?: ImpactOutcomeFilter | ImpactRunOutcome[];
      configId?: number | string | null | Array<number | string>;
      dimensions?: string[];
    };

    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }
    const includeProject = isCrossProject && dimensions.includes("project");
    // 0 means all time.
    const lookback =
      Number(lookbackDays) === 0
        ? 0
        : Math.min(Math.max(Number(lookbackDays) || 90, 7), 365);

    const from: Date[] = [];
    if (lookback > 0) {
      const d = new Date();
      d.setDate(d.getDate() - lookback);
      from.push(d);
    }
    if (startDate) from.push(new Date(startDate));
    const gte = from.length ? new Date(Math.max(...from.map((d) => +d))) : null;
    const lte = endDate ? new Date(endDate) : null;

    const triggers = parseEnumFilter(triggerFilter, IMPACT_TRIGGERS);
    const outcomes = parseEnumFilter(outcomeFilter, IMPACT_RUN_OUTCOMES);
    const configIds = parseIdListFilter(configId);
    // A manual analysis stores no trigger.
    const namedTriggers = triggers?.filter((t) => t !== "manual") ?? [];

    const analyses = (await baseDb.impactAnalysis.findMany({
      where: {
        isDeleted: false,
        ...(isCrossProject
          ? { project: { isDeleted: false, impactEnabled: true } }
          : { projectId: Number(projectId) }),
        ...(configIds ? { configId: { in: configIds } } : {}),
        ...(triggers
          ? {
              OR: [
                ...(triggers.includes("manual") ? [{ trigger: null }] : []),
                ...(namedTriggers.length > 0
                  ? [{ trigger: { in: namedTriggers } }]
                  : []),
              ],
            }
          : {}),
        ...(gte || lte
          ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
          : {}),
      },
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        status: true,
        trigger: true,
        triggerLabel: true,
        triggerUrl: true,
        baseRef: true,
        headRef: true,
        baseSha: true,
        headSha: true,
        fileCount: true,
        additions: true,
        deletions: true,
        pinnedCaseCount: true,
        affectedCaseCount: true,
        config: {
          select: {
            id: true,
            branch: true,
            repository: { select: { id: true, name: true, provider: true } },
          },
        },
        cases: { select: { tier: true, accepted: true } },
        testRun: {
          select: {
            id: true,
            name: true,
            isDeleted: true,
            configurationGroupId: true,
            configuration: { select: { id: true, name: true } },
            compositionLockedAt: true,
            testCases: {
              where: { isDeleted: false },
              select: {
                status: {
                  select: {
                    isSuccess: true,
                    isFailure: true,
                    isCompleted: true,
                  },
                },
              },
            },
          },
        },
        createdBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })) as unknown as AnalysisRecord[];

    const rows = analyses
      .map((analysis) => toReportRow(analysis, includeProject))
      .filter((row) => outcomes === null || outcomes.includes(row.outcome));

    return Response.json({
      data: rows,
      total: rows.length,
      lookbackDays: lookback,
    });
  } catch (e: unknown) {
    console.error("Impact analysis report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
