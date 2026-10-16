import { webhookActorId } from "~/lib/webhooks/actions/actor";
import { composeRunFromCases } from "~/lib/webhooks/actions/composeRun";
import { logWebhookAction } from "~/lib/webhooks/actions/log";
import { describeCreateRunRule } from "~/lib/webhooks/actions/ruleSummary";
import { executeAutoRun } from "./autoExecute";
import { buildChangesNodes } from "./buildChangesNote";
import type { BuildChanges, ImpactAutoRun, ImpactAutoRunAction } from "./types";

export type AutoRunResult =
  | { created: true; testRunId: number; caseCount: number }
  | {
      created: false;
      reason:
        "already_linked" | "no_cases" | "no_workflow" | "analysis_missing";
      testRunId?: number;
    };

/** Which of the analysis's suggestions the run takes: the rule's minimum score, else the pinned and affected tiers. */
function suggestionFilter(minScore: number | null | undefined) {
  if (typeof minScore === "number" && Number.isFinite(minScore)) {
    return { suggested: true, score: { gte: minScore } };
  }
  return { suggested: true, tier: { in: ["pinned", "affected"] } };
}

/**
 * Compose the test run one Create test run rule asked for: every case the
 * completed analysis put in the pinned or affected tier, or, when the rule
 * sets a minimum score, every case scoring at least that, in score order,
 * created by the System user. The first run made from an analysis is linked
 * to it and its suggestions marked accepted, exactly as the dialog records a
 * reviewer's acceptance. A rule composes one run per analysis, so a repeat
 * of the same change reports the run it already made. `buildChanges`, the
 * pull requests behind a push, is appended to the run's note when given.
 */
export async function createRunFromAnalysis(
  db: any,
  analysisId: number,
  autoRun: ImpactAutoRun,
  action: Pick<ImpactAutoRunAction, "trigger" | "branch" | "autoExecute"> & {
    actionId: string | null;
    minScore?: number | null;
  },
  tenantId?: string,
  buildChanges?: BuildChanges | null
): Promise<AutoRunResult> {
  const analysis = await db.impactAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true,
      projectId: true,
      testRunId: true,
      project: { select: { createdBy: true } },
      cases: {
        where: suggestionFilter(action.minScore),
        orderBy: [{ score: "desc" }, { caseId: "asc" }],
        select: { caseId: true },
      },
    },
  });
  if (!analysis) return { created: false, reason: "analysis_missing" };

  if (action.actionId) {
    const prior = await db.webhookActionLog.findFirst({
      where: {
        webhookActionId: action.actionId,
        analysisId,
        testRunId: { not: null },
      },
      select: { testRunId: true },
    });
    if (prior?.testRunId) {
      return {
        created: false,
        reason: "already_linked",
        testRunId: prior.testRunId,
      };
    }
  }
  // A run someone composed from the analysis by hand stands for every rule;
  // runs other rules composed from it don't.
  if (
    analysis.testRunId &&
    !(
      action.actionId &&
      (await db.webhookActionLog.findFirst({
        where: {
          analysisId,
          testRunId: analysis.testRunId,
          outcome: "run_created",
          webhookActionId: { not: null },
        },
        select: { id: true },
      }))
    )
  ) {
    return {
      created: false,
      reason: "already_linked",
      testRunId: analysis.testRunId,
    };
  }

  const actorId = await webhookActorId(db, analysis.project.createdBy);
  const rule = await describeCreateRunRule(db, action);
  const noteAppendix = buildChangesNodes(buildChanges);
  const composed = await composeRunFromCases(db, {
    projectId: analysis.projectId,
    name: autoRun.label,
    caseIds: analysis.cases.map((c: { caseId: number }) => c.caseId),
    links: [
      ...(autoRun.links && autoRun.links.length > 0
        ? autoRun.links
        : [{ label: autoRun.label, url: autoRun.url ?? null }]),
      ...(rule ? [{ label: rule, url: null }] : []),
    ],
    ...(noteAppendix.length > 0 ? { noteAppendix } : {}),
    createdById: actorId,
    tenantId,
  });
  if (!composed.created) return composed;

  if (!analysis.testRunId) {
    const caseIds = analysis.cases.map((c: { caseId: number }) => c.caseId);
    const reviewedAt = new Date();
    await db.impactAnalysis.update({
      where: { id: analysisId },
      data: { testRunId: composed.testRunId },
    });
    await db.impactAnalysisCase.updateMany({
      where: { analysisId, suggested: true, caseId: { in: caseIds } },
      data: { accepted: true, reviewedAt, reviewedById: actorId },
    });
    await db.impactAnalysisCase.updateMany({
      where: { analysisId, suggested: true, caseId: { notIn: caseIds } },
      data: { accepted: false, reviewedAt, reviewedById: actorId },
    });
  }
  return composed;
}

/**
 * Perform every Create test run rule that matched a repository webhook's
 * event once its analysis is complete: compose each rule's run, request its
 * automated execution when the rule says to, and record what happened on
 * the rule's log and the delivery. Jobs queued before rules existed compose
 * the single run they asked for, with no execution.
 */
export async function runAnalysisActions(
  db: any,
  analysisId: number,
  projectId: number,
  autoRun: ImpactAutoRun,
  tenantId?: string,
  buildChanges?: BuildChanges | null
): Promise<void> {
  const actions: (
    | ImpactAutoRunAction
    | { actionId: null; minScore?: number | null; autoExecute?: null }
  )[] = autoRun.actions ?? [
    { actionId: null, minScore: autoRun.minScore ?? null, autoExecute: null },
  ];

  let subjectRef: string | null = null;
  // A failure outranks a note that a rule acted on nothing.
  let deliveryError: string | null = null;
  let deliveryNote: string | null = null;
  for (const action of actions) {
    const log = (entry: {
      outcome: string;
      testRunId?: number | null;
      caseCount?: number | null;
      detail?: string | null;
    }) =>
      autoRun.webhookConfigId
        ? logWebhookAction(db, {
            webhookActionId: action.actionId,
            webhookConfigId: autoRun.webhookConfigId,
            deliveryId: autoRun.deliveryId ?? null,
            projectId,
            analysisId,
            ...entry,
          })
        : Promise.resolve();
    try {
      const run = await createRunFromAnalysis(
        db,
        analysisId,
        autoRun,
        action,
        tenantId,
        buildChanges
      );
      if (!run.created) {
        if (run.reason === "already_linked" && run.testRunId) {
          subjectRef ??= `run:${run.testRunId}`;
          await log({ outcome: "already_composed", testRunId: run.testRunId });
        } else {
          if (run.reason === "no_cases") {
            deliveryNote ??= "ignored:no_affected_cases";
          } else {
            deliveryError ??= `run:${run.reason}`;
          }
          await log({ outcome: run.reason });
        }
        continue;
      }
      subjectRef ??= `run:${run.testRunId}`;
      await log({
        outcome: "run_created",
        testRunId: run.testRunId,
        caseCount: run.caseCount,
      });
      if (action.autoExecute) {
        const executed = await executeAutoRun(db, {
          autoExecute: action.autoExecute,
          testRunId: run.testRunId,
          projectId,
          tenantId,
        });
        if (!executed.requested) {
          deliveryError ??= `execute:${executed.code.toLowerCase()}`;
          await log({
            outcome: "execute_failed",
            testRunId: run.testRunId,
            detail: executed.code,
          });
        }
      }
    } catch (error) {
      console.error(
        `[impact] auto-run for analysis ${analysisId} failed:`,
        error
      );
      deliveryError ??= "run:error";
      await log({
        outcome: "error",
        detail: error instanceof Error ? error.message : "failed",
      });
    }
  }

  if (autoRun.deliveryId) {
    await db.webhookDelivery
      .update({
        where: { id: autoRun.deliveryId },
        data: {
          subjectRef: subjectRef ?? `analysis:${analysisId}`,
          error: deliveryError ?? deliveryNote,
        },
      })
      .catch(() => {});
  }
}
