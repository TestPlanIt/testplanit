import { emptyEditorContent } from "~/app/constants/backend";
import type { ImpactAutoRun } from "./types";

/** Raw client surface for composing a run from a completed analysis. */
export interface AutoRunDb {
  impactAnalysis: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  impactAnalysisCase: { updateMany: (args: any) => Promise<any> };
  workflows: { findFirst: (args: any) => Promise<any> };
  testRuns: { create: (args: any) => Promise<any> };
  webhookDelivery: { update: (args: any) => Promise<any> };
}

export type AutoRunResult =
  | { created: true; testRunId: number; caseCount: number }
  | {
      created: false;
      reason:
        "already_linked" | "no_cases" | "no_workflow" | "analysis_missing";
    };

const RUN_NAME_MAX = 200;

function runNote(autoRun: ImpactAutoRun) {
  const text = autoRun.url
    ? `${autoRun.label} — ${autoRun.url}`
    : autoRun.label;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/**
 * Compose the test run a repository webhook asked for: every case the
 * completed analysis put in the pinned or affected tier, in score order,
 * under the project's default run workflow state, created by the project's
 * creator. The analysis is linked to the run and its suggestions marked
 * accepted, exactly as the dialog records a reviewer's acceptance. With no
 * affected cases no run is made; the delivery says so.
 */
export async function createRunFromAnalysis(
  db: AutoRunDb,
  analysisId: number,
  autoRun: ImpactAutoRun
): Promise<AutoRunResult> {
  const annotate = async (subjectRef: string | null, error: string | null) => {
    if (!autoRun.deliveryId) return;
    await db.webhookDelivery
      .update({
        where: { id: autoRun.deliveryId },
        data: { ...(subjectRef ? { subjectRef } : {}), error },
      })
      .catch(() => {});
  };

  const analysis = await db.impactAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true,
      projectId: true,
      testRunId: true,
      project: { select: { createdBy: true } },
      cases: {
        where: { suggested: true, tier: { in: ["pinned", "affected"] } },
        orderBy: [{ score: "desc" }, { caseId: "asc" }],
        select: { caseId: true },
      },
    },
  });
  if (!analysis) {
    await annotate(null, "run:analysis_missing");
    return { created: false, reason: "analysis_missing" };
  }
  if (analysis.testRunId) {
    await annotate(`run:${analysis.testRunId}`, null);
    return { created: false, reason: "already_linked" };
  }
  const caseIds: number[] = [
    ...new Set<number>(analysis.cases.map((c: { caseId: number }) => c.caseId)),
  ];
  if (caseIds.length === 0) {
    await annotate(`analysis:${analysisId}`, "run:no_affected_cases");
    return { created: false, reason: "no_cases" };
  }

  const projectId: number = analysis.projectId;
  const workflow =
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isDefault: true,
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      select: { id: true },
    })) ??
    (await db.workflows.findFirst({
      where: {
        scope: "RUNS",
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      orderBy: { order: "asc" },
      select: { id: true },
    }));
  if (!workflow) {
    await annotate(`analysis:${analysisId}`, "run:no_workflow");
    return { created: false, reason: "no_workflow" };
  }

  const run = await db.testRuns.create({
    data: {
      projectId,
      name: autoRun.label.slice(0, RUN_NAME_MAX),
      stateId: workflow.id,
      createdById: analysis.project.createdBy,
      note: runNote(autoRun),
      docs: emptyEditorContent,
      testRunType: "REGULAR",
      testCases: {
        create: caseIds.map((caseId, index) => ({
          repositoryCase: { connect: { id: caseId } },
          order: index,
        })),
      },
    },
    select: { id: true },
  });

  const reviewedAt = new Date();
  await db.impactAnalysis.update({
    where: { id: analysisId },
    data: { testRunId: run.id },
  });
  await db.impactAnalysisCase.updateMany({
    where: { analysisId, suggested: true, caseId: { in: caseIds } },
    data: {
      accepted: true,
      reviewedAt,
      reviewedById: analysis.project.createdBy,
    },
  });
  await db.impactAnalysisCase.updateMany({
    where: { analysisId, suggested: true, caseId: { notIn: caseIds } },
    data: {
      accepted: false,
      reviewedAt,
      reviewedById: analysis.project.createdBy,
    },
  });
  await annotate(`run:${run.id}`, null);
  return { created: true, testRunId: run.id, caseCount: caseIds.length };
}
