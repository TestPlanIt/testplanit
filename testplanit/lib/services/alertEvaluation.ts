/**
 * Alert rule evaluation (#651).
 *
 * The worker hands this service a committed subject (a result, an automated
 * result, a run, or "the daily pass") and it decides which rules fire. It
 * follows the budget-alert service shape: a pure-ish service that reads
 * state, decides, records what fired and hands off to the notification
 * pipeline. BullMQ-unaware so it can be tested with a mocked client.
 *
 * Status semantics come from the Status row's flags, never its name:
 * passed = isSuccess, failed = isFailure, finished = isCompleted. Automated
 * results fall back to the reporter's verdict only when no status is mapped
 * (`COALESCE(s.flag, jr.type = ...)`), the same rule latestTestResults uses.
 *
 * Writes go through the raw client on purpose: AlertEvent is locked at
 * the policy layer and `lastFiredAt` is deny-updated, so the enhanced client
 * could not write them.
 */

import {
  AlertEvaluateOn,
  AlertMetric,
  AlertResultSource,
  AlertScopeType,
  AlertSubjectType,
} from "~/zenstack/models";
import { NotificationService } from "~/lib/services/notificationService";
import { resolveAlertRecipients } from "~/lib/services/alertRecipients";
import {
  caseEventAlertMetrics,
  executionEventAlertMetrics,
  metricUsesField,
  runEventAlertMetrics,
  scheduledAlertMetrics,
  sessionEventAlertMetrics,
  type AlertSchedule,
} from "~/lib/alerts/catalogue";
import {
  cooldownElapsed,
  evaluateConsecutiveFailures,
  evaluateCountAbove,
  evaluateDurationDeviation,
  evaluateFailureCount,
  evaluateFailureRate,
  evaluateFlakiness,
  evaluateIssueCount,
  evaluateMilestoneBehind,
  evaluateMilestoneOverdue,
  evaluateNotProgressing,
  evaluatePassRate,
  evaluateRecovery,
  evaluateRegression,
  evaluateSessionOverrun,
  evaluateShareBelow,
  evaluateUntestedShare,
  type ResultSample,
  type RunCounts,
} from "~/lib/alerts/metrics";
import { webhookEvents } from "~/lib/webhooks/events";
import { getMilestoneCaseCompletion } from "~/lib/services/effectiveCaseStatus";
import { getRequirementCoverage } from "~/lib/services/requirementCoverage";
import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { subjectPath } from "~/lib/alerts/subjectPath";

export const ALERT_WEBHOOK_EVENT = "alert.triggered";

/** Upper bound on history read per case; no rule window exceeds it. */
const MAX_HISTORY = 200;

export interface AlertRuleRow {
  id: number;
  projectId: number;
  name: string;
  metric: AlertMetric;
  scopeType: AlertScopeType;
  scopeId: number | null;
  scopeText: string | null;
  thresholdValue: number;
  secondaryValue: number | null;
  direction: "ABOVE" | "BELOW" | "EITHER";
  baselineType: "MEAN" | "MEDIAN";
  baselineWindow: number;
  minSamples: number;
  resultSource: AlertResultSource;
  evaluateOn: AlertEvaluateOn;
  coverageBasis: "LINKED" | "PASSING";
  cooldownMinutes: number;
  emitWebhook: boolean;
}

export interface FiredAlert {
  ruleId: number;
  subjectType: AlertSubjectType;
  subjectId: number;
  eventId: number;
  notified: number;
}

interface CaseSubject {
  caseId: number;
  caseName: string;
  folderId: number;
  projectId: number;
  projectName: string;
  testRunId: number;
  current: ResultSample;
  /** Ordering key of the triggering result; history is strictly older. */
  executedAt: Date;
  source: "MANUAL" | "AUTOMATED";
  /** Primary key of the triggering row, excluded from its own history. */
  sourceRowId: number;
}

interface RunSubject {
  runId: number;
  runName: string;
  projectId: number;
  projectName: string;
  testRunType: string;
  isCompleted: boolean;
  elapsed: number | null;
}

interface MilestoneSubject {
  milestoneId: number;
  milestoneName: string;
  projectId: number;
  projectName: string;
  dueAt: Date;
}

export interface AlertEvaluationOptions {
  now?: () => Date;
}

export class AlertEvaluationService {
  private readonly now: () => Date;

  constructor(
    private db: any,
    options: AlertEvaluationOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------------
  // Entry points
  // ---------------------------------------------------------------------

  /** A manual result (TestRunResults row) was recorded. */
  async evaluateResult(
    resultId: number,
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const rows: any[] = await this.db.$queryRaw`
      SELECT r.id, r.elapsed, r."executedAt", r."testRunId",
             trc."repositoryCaseId" AS "caseId", rc.name AS "caseName",
             rc."folderId", tr."projectId", p.name AS "projectName",
             s."isSuccess", s."isFailure"
      FROM "TestRunResults" r
      JOIN "TestRunCases" trc ON trc.id = r."testRunCaseId"
      JOIN "RepositoryCases" rc ON rc.id = trc."repositoryCaseId"
      JOIN "TestRuns" tr ON tr.id = r."testRunId"
      JOIN "Projects" p ON p.id = tr."projectId"
      JOIN "Status" s ON s.id = r."statusId"
      WHERE r.id = ${resultId} AND r."isDeleted" = false
    `;
    const row = rows[0];
    if (!row) return [];
    return this.evaluateCaseSubject(
      {
        caseId: Number(row.caseId),
        caseName: row.caseName,
        folderId: Number(row.folderId),
        projectId: Number(row.projectId),
        projectName: row.projectName,
        testRunId: Number(row.testRunId),
        current: {
          elapsed: row.elapsed == null ? null : Number(row.elapsed),
          isSuccess: Boolean(row.isSuccess),
          isFailure: Boolean(row.isFailure),
        },
        executedAt: new Date(row.executedAt),
        source: "MANUAL",
        sourceRowId: Number(row.id),
      },
      tenantId
    );
  }

  /** An automated result (JUnitTestResult row) was recorded. */
  async evaluateJUnitResult(
    junitResultId: number,
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const rows: any[] = await this.db.$queryRaw`
      SELECT jr.id, jr.time AS elapsed,
             COALESCE(jr."executedAt", jr."createdAt") AS "executedAt",
             tr.id AS "testRunId", jr."repositoryCaseId" AS "caseId",
             rc.name AS "caseName", rc."folderId", tr."projectId",
             p.name AS "projectName",
             COALESCE(s."isSuccess", jr.type = 'PASSED') AS "isSuccess",
             COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) AS "isFailure"
      FROM "JUnitTestResult" jr
      JOIN "JUnitTestSuite" ts ON ts.id = jr."testSuiteId"
      JOIN "TestRuns" tr ON tr.id = ts."testRunId"
      JOIN "Projects" p ON p.id = tr."projectId"
      JOIN "RepositoryCases" rc ON rc.id = jr."repositoryCaseId"
      LEFT JOIN "Status" s ON s.id = jr."statusId"
      WHERE jr.id = ${junitResultId}
    `;
    const row = rows[0];
    if (!row) return [];
    return this.evaluateCaseSubject(
      {
        caseId: Number(row.caseId),
        caseName: row.caseName,
        folderId: Number(row.folderId),
        projectId: Number(row.projectId),
        projectName: row.projectName,
        testRunId: Number(row.testRunId),
        current: {
          elapsed: row.elapsed == null ? null : Number(row.elapsed),
          isSuccess: Boolean(row.isSuccess),
          isFailure: Boolean(row.isFailure),
        },
        executedAt: new Date(row.executedAt),
        source: "AUTOMATED",
        sourceRowId: Number(row.id),
      },
      tenantId
    );
  }

  /** Results arrived on a run, or the run was completed. */
  async evaluateRun(
    runId: number,
    trigger: "result" | "completion",
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const run = await this.db.testRuns.findUnique({
      where: { id: runId },
      select: {
        id: true,
        name: true,
        projectId: true,
        testRunType: true,
        isCompleted: true,
        isDeleted: true,
        elapsed: true,
        project: { select: { name: true } },
      },
    });
    if (!run || run.isDeleted) return [];

    const rules = (await this.loadRules(run.projectId, runEventAlertMetrics()))
      // A completion-time rule waits for the run to finish; an as-results-arrive
      // rule evaluates on every trigger. Metrics without the choice (run
      // duration) only make sense once the run is done.
      .filter(
        (rule) =>
          trigger === "completion" ||
          (metricUsesField(rule.metric, "evaluateOn") &&
            rule.evaluateOn === AlertEvaluateOn.AS_RESULTS_ARRIVE)
      );
    if (rules.length === 0) return [];

    const subject: RunSubject = {
      runId: run.id,
      runName: run.name,
      projectId: run.projectId,
      projectName: run.project?.name ?? "",
      testRunType: run.testRunType,
      isCompleted: run.isCompleted,
      elapsed: run.elapsed == null ? null : Number(run.elapsed),
    };

    const matching: AlertRuleRow[] = [];
    for (const rule of rules) {
      if (await this.runMatchesScope(rule, subject)) matching.push(rule);
    }
    if (matching.length === 0) return [];

    let counts: RunCounts | null = null;
    let issues: number | null = null;
    const fired: FiredAlert[] = [];
    for (const rule of matching) {
      let outcome: {
        observed: number;
        baseline?: number | null;
        details: Record<string, unknown>;
      } | null = null;
      if (rule.metric === AlertMetric.RUN_DURATION_DEVIATION) {
        const previous = await this.loadPreviousRunDurations(rule, subject);
        const verdict = evaluateDurationDeviation({
          current: subject.elapsed,
          previous,
          window: rule.baselineWindow,
          minSamples: rule.minSamples,
          baselineType: rule.baselineType,
          thresholdPercent: rule.thresholdValue,
          direction: rule.direction,
        });
        if (verdict.fired) {
          outcome = {
            observed: verdict.deviationPercent,
            baseline: verdict.baseline,
            details: {
              elapsed: subject.elapsed,
              baselineSeconds: verdict.baseline,
              baselineType: rule.baselineType,
              sampleCount: verdict.sampleCount,
            },
          };
        }
      } else if (rule.metric === AlertMetric.RUN_ISSUES_OPENED) {
        issues ??= await this.loadRunIssueCount(subject.runId);
        const verdict = evaluateIssueCount({
          issues,
          count: rule.thresholdValue,
        });
        if (verdict.fired) {
          outcome = { observed: verdict.issues, details: { issues } };
        }
      } else {
        counts ??= await this.loadRunCounts(subject);
        outcome = this.evaluateRunRule(rule, counts);
      }
      if (!outcome) continue;
      const event = await this.fire({
        rule,
        subjectType: AlertSubjectType.RUN,
        subjectId: subject.runId,
        subjectName: subject.runName,
        projectId: subject.projectId,
        projectName: subject.projectName,
        observedValue: outcome.observed,
        baselineValue: outcome.baseline ?? null,
        thresholdValue: rule.thresholdValue,
        details: { ...outcome.details, trigger, testRunId: subject.runId },
        testRunId: subject.runId,
        tenantId,
      });
      if (event) fired.push(event);
    }
    return fired;
  }

  /** An automated execution reached a terminal failure, dispatch failure or timeout. */
  async evaluateExecution(
    executionId: number,
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const execution = await this.db.testRunExecution.findUnique({
      where: { id: executionId },
      select: {
        id: true,
        status: true,
        error: true,
        testRunId: true,
        projectId: true,
        target: { select: { name: true } },
        testRun: {
          select: {
            id: true,
            name: true,
            testRunType: true,
            isCompleted: true,
            isDeleted: true,
            elapsed: true,
            project: { select: { name: true } },
          },
        },
      },
    });
    if (!execution || !execution.testRun || execution.testRun.isDeleted) {
      return [];
    }
    if (
      execution.status !== "FAILED" &&
      execution.status !== "DISPATCH_FAILED" &&
      execution.status !== "TIMED_OUT"
    ) {
      return [];
    }
    const rules = await this.loadRules(
      execution.projectId,
      executionEventAlertMetrics()
    );
    if (rules.length === 0) return [];

    const run = execution.testRun;
    const subject: RunSubject = {
      runId: run.id,
      runName: run.name,
      projectId: execution.projectId,
      projectName: run.project?.name ?? "",
      testRunType: run.testRunType,
      isCompleted: run.isCompleted,
      elapsed: run.elapsed == null ? null : Number(run.elapsed),
    };
    const fired: FiredAlert[] = [];
    for (const rule of rules) {
      if (!(await this.runMatchesScope(rule, subject))) continue;
      const event = await this.fire({
        rule,
        subjectType: AlertSubjectType.RUN,
        subjectId: subject.runId,
        subjectName: subject.runName,
        projectId: subject.projectId,
        projectName: subject.projectName,
        observedValue: 1,
        baselineValue: null,
        thresholdValue: 0,
        details: {
          executionId: execution.id,
          status: execution.status,
          error: execution.error ?? null,
          targetName: execution.target?.name ?? null,
          testRunId: subject.runId,
        },
        testRunId: subject.runId,
        tenantId,
      });
      if (event) fired.push(event);
    }
    return fired;
  }

  /** A session was completed. */
  async evaluateSession(
    sessionId: number,
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const session = await this.db.sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        name: true,
        projectId: true,
        elapsed: true,
        estimate: true,
        isDeleted: true,
        project: { select: { name: true } },
      },
    });
    if (!session || session.isDeleted) return [];
    const rules = await this.loadRules(
      session.projectId,
      sessionEventAlertMetrics()
    );
    if (rules.length === 0) return [];

    const fired: FiredAlert[] = [];
    for (const rule of rules) {
      if (rule.scopeType === AlertScopeType.TAG) {
        if (rule.scopeId == null) continue;
        const rows: any[] = await this.db.$queryRaw`
          SELECT 1 FROM "_SessionsToTags" WHERE "A" = ${session.id} AND "B" = ${rule.scopeId} LIMIT 1
        `;
        if (rows.length === 0) continue;
      } else if (rule.scopeType !== AlertScopeType.PROJECT) {
        continue;
      }
      const verdict = evaluateSessionOverrun({
        elapsed: session.elapsed == null ? null : Number(session.elapsed),
        estimate: session.estimate == null ? null : Number(session.estimate),
        thresholdPercent: rule.thresholdValue,
      });
      if (!verdict.fired) continue;
      const event = await this.fire({
        rule,
        subjectType: AlertSubjectType.SESSION,
        subjectId: session.id,
        subjectName: session.name,
        projectId: session.projectId,
        projectName: session.project?.name ?? "",
        observedValue: verdict.overrunPercent,
        baselineValue: Number(session.estimate),
        thresholdValue: rule.thresholdValue,
        details: {
          elapsed: Number(session.elapsed),
          estimate: Number(session.estimate),
          overrunPercent: verdict.overrunPercent,
        },
        tenantId,
      });
      if (event) fired.push(event);
    }
    return fired;
  }

  /**
   * The scheduled pass, every project at once: milestone metrics daily,
   * stalled runs and webhook failure rates hourly, project-wide health daily.
   */
  async evaluateScheduled(
    tenantId?: string,
    schedule: AlertSchedule = "daily"
  ): Promise<FiredAlert[]> {
    const rules = await this.loadRules(
      undefined,
      scheduledAlertMetrics(schedule)
    );
    if (rules.length === 0) return [];

    const byProject = new Map<number, AlertRuleRow[]>();
    for (const rule of rules) {
      const list = byProject.get(rule.projectId) ?? [];
      list.push(rule);
      byProject.set(rule.projectId, list);
    }

    const fired: FiredAlert[] = [];
    for (const [projectId, projectRules] of byProject) {
      const milestoneRules = projectRules.filter(
        (r) =>
          r.metric === AlertMetric.MILESTONE_BEHIND ||
          r.metric === AlertMetric.MILESTONE_OVERDUE
      );
      const runRules = projectRules.filter(
        (r) =>
          r.metric === AlertMetric.RUN_NOT_PROGRESSING ||
          r.metric === AlertMetric.RUN_UNTESTED_SHARE
      );
      const projectRulesOnly = projectRules.filter(
        (r) =>
          r.metric === AlertMetric.REQUIREMENT_COVERAGE_BELOW ||
          r.metric === AlertMetric.STALE_CASES ||
          r.metric === AlertMetric.AUTOMATION_SHARE_BELOW
      );
      const webhookRules = projectRules.filter(
        (r) => r.metric === AlertMetric.WEBHOOK_FAILURE_RATE
      );
      if (runRules.length > 0) {
        fired.push(...(await this.evaluateScheduledRuns(runRules, tenantId)));
      }
      if (projectRulesOnly.length > 0) {
        fired.push(
          ...(await this.evaluateProjectRules(
            projectId,
            projectRulesOnly,
            tenantId
          ))
        );
      }
      if (webhookRules.length > 0) {
        fired.push(
          ...(await this.evaluateWebhookRules(
            projectId,
            webhookRules,
            tenantId
          ))
        );
      }
      if (milestoneRules.length === 0) continue;
      const milestones: any[] = await this.db.milestones.findMany({
        where: {
          projectId,
          isCompleted: false,
          isDeleted: false,
          completedAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          completedAt: true,
          project: { select: { name: true } },
        },
      });
      for (const milestone of milestones) {
        const subject: MilestoneSubject = {
          milestoneId: milestone.id,
          milestoneName: milestone.name,
          projectId,
          projectName: milestone.project?.name ?? "",
          dueAt: new Date(milestone.completedAt),
        };
        let completion: { completed: number; total: number } | null = null;
        for (const rule of milestoneRules) {
          if (
            rule.scopeType === AlertScopeType.MILESTONE &&
            rule.scopeId !== subject.milestoneId
          ) {
            continue;
          }
          let outcome: {
            observed: number;
            details: Record<string, unknown>;
          } | null = null;
          if (rule.metric === AlertMetric.MILESTONE_OVERDUE) {
            const verdict = evaluateMilestoneOverdue({
              dueAt: subject.dueAt,
              now: this.now(),
            });
            if (verdict.fired) {
              outcome = {
                observed: verdict.daysOverdue,
                details: { daysOverdue: verdict.daysOverdue },
              };
            }
          } else if (rule.metric === AlertMetric.MILESTONE_BEHIND) {
            completion ??= await this.loadMilestoneCompletion(
              subject.milestoneId
            );
            const verdict = evaluateMilestoneBehind({
              completed: completion.completed,
              total: completion.total,
              dueAt: subject.dueAt,
              now: this.now(),
              thresholdPercent: rule.thresholdValue,
              daysRemaining: rule.secondaryValue ?? 0,
            });
            if (verdict.fired) {
              outcome = {
                observed: verdict.completionPercent,
                details: {
                  completionPercent: verdict.completionPercent,
                  daysRemaining: verdict.daysRemaining,
                  completed: completion.completed,
                  total: completion.total,
                },
              };
            }
          }
          if (!outcome) continue;
          const event = await this.fire({
            rule,
            subjectType: AlertSubjectType.MILESTONE,
            subjectId: subject.milestoneId,
            subjectName: subject.milestoneName,
            projectId: subject.projectId,
            projectName: subject.projectName,
            observedValue: outcome.observed,
            baselineValue: null,
            thresholdValue: rule.thresholdValue,
            details: { ...outcome.details, dueAt: subject.dueAt.toISOString() },
            tenantId,
          });
          if (event) fired.push(event);
        }
      }
    }
    return fired;
  }

  // ---------------------------------------------------------------------
  // Case metrics
  // ---------------------------------------------------------------------

  private async evaluateCaseSubject(
    subject: CaseSubject,
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const rules = (
      await this.loadRules(subject.projectId, caseEventAlertMetrics())
    ).filter((rule) => sourceAccepts(rule.resultSource, subject.source));
    if (rules.length === 0) return [];

    const matching: AlertRuleRow[] = [];
    let folderDescendants: Map<number, Set<number>> | null = null;
    for (const rule of rules) {
      switch (rule.scopeType) {
        case AlertScopeType.PROJECT:
          matching.push(rule);
          break;
        case AlertScopeType.CASE:
          if (rule.scopeId === subject.caseId) matching.push(rule);
          break;
        case AlertScopeType.FOLDER: {
          if (rule.scopeId == null) break;
          folderDescendants ??= new Map();
          let set = folderDescendants.get(rule.scopeId);
          if (!set) {
            set = await this.loadFolderSubtree(rule.scopeId);
            folderDescendants.set(rule.scopeId, set);
          }
          if (set.has(subject.folderId)) matching.push(rule);
          break;
        }
        case AlertScopeType.TAG: {
          if (rule.scopeId == null) break;
          const tagged = await this.db.repositoryCaseTag.count({
            where: { caseId: subject.caseId, tagId: rule.scopeId },
          });
          if (tagged > 0) matching.push(rule);
          break;
        }
        default:
          break;
      }
    }
    if (matching.length === 0) return [];

    // One history read serves every matching rule; a rule that accepts only
    // one source filters it down.
    const history = await this.loadCaseHistory(subject);
    const fired: FiredAlert[] = [];
    for (const rule of matching) {
      const previous =
        rule.resultSource === AlertResultSource.BOTH
          ? history
          : history.filter((h) => h.source === rule.resultSource);
      const outcome = this.evaluateCaseRule(rule, subject.current, previous);
      if (!outcome) continue;
      const event = await this.fire({
        rule,
        subjectType: AlertSubjectType.CASE,
        subjectId: subject.caseId,
        subjectName: subject.caseName,
        projectId: subject.projectId,
        projectName: subject.projectName,
        observedValue: outcome.observed,
        baselineValue: outcome.baseline,
        thresholdValue: rule.thresholdValue,
        details: {
          ...outcome.details,
          source: subject.source,
          testRunId: subject.testRunId,
          resultId: subject.sourceRowId,
        },
        testRunId: subject.testRunId,
        tenantId,
      });
      if (event) fired.push(event);
    }
    return fired;
  }

  private evaluateCaseRule(
    rule: AlertRuleRow,
    current: ResultSample,
    previous: readonly ResultSample[]
  ): {
    observed: number;
    baseline: number | null;
    details: Record<string, unknown>;
  } | null {
    switch (rule.metric) {
      case AlertMetric.RESULT_DURATION_DEVIATION: {
        const verdict = evaluateDurationDeviation({
          current: current.elapsed,
          previous,
          window: rule.baselineWindow,
          minSamples: rule.minSamples,
          baselineType: rule.baselineType,
          thresholdPercent: rule.thresholdValue,
          direction: rule.direction,
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.deviationPercent,
          baseline: verdict.baseline,
          details: {
            elapsed: current.elapsed,
            baselineSeconds: verdict.baseline,
            baselineType: rule.baselineType,
            sampleCount: verdict.sampleCount,
          },
        };
      }
      case AlertMetric.CASE_REGRESSED: {
        const verdict = evaluateRegression({
          current,
          previous,
          window: rule.baselineWindow,
          minSamples: Math.min(rule.minSamples, rule.baselineWindow),
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.passedBefore,
          baseline: null,
          details: { passedBefore: verdict.passedBefore },
        };
      }
      case AlertMetric.CASE_RECOVERED: {
        const verdict = evaluateRecovery({
          current,
          previous,
          window: rule.baselineWindow,
          minSamples: Math.min(rule.minSamples, rule.baselineWindow),
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.failedBefore,
          baseline: null,
          details: { failedBefore: verdict.failedBefore },
        };
      }
      case AlertMetric.CONSECUTIVE_FAILURES: {
        const verdict = evaluateConsecutiveFailures({
          current,
          previous,
          count: rule.thresholdValue,
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.streak,
          baseline: null,
          details: { streak: verdict.streak },
        };
      }
      case AlertMetric.CASE_FLAKY: {
        const verdict = evaluateFlakiness({
          current,
          previous,
          window: rule.baselineWindow,
          minSamples: Math.min(rule.minSamples, rule.baselineWindow),
          flipThreshold: rule.thresholdValue,
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.flips,
          baseline: null,
          details: { flips: verdict.flips, sampleCount: verdict.sampleCount },
        };
      }
      default:
        return null;
    }
  }

  /**
   * The case's earlier results across both tables, newest first, excluding
   * the triggering row. Untested rows (no verdict, no duration) fall out in
   * the metrics; deleted rows and deleted runs never make it in.
   */
  private async loadCaseHistory(
    subject: CaseSubject
  ): Promise<Array<ResultSample & { source: "MANUAL" | "AUTOMATED" }>> {
    const manualExclude =
      subject.source === "MANUAL" ? subject.sourceRowId : -1;
    const junitExclude =
      subject.source === "AUTOMATED" ? subject.sourceRowId : -1;
    const rows: any[] = await this.db.$queryRaw`
      SELECT * FROM (
        SELECT r."executedAt" AS "at", r.elapsed::double precision AS elapsed,
               s."isSuccess", s."isFailure", 'MANUAL'::text AS source
        FROM "TestRunResults" r
        JOIN "TestRunCases" trc ON trc.id = r."testRunCaseId"
        JOIN "TestRuns" tr ON tr.id = r."testRunId"
        JOIN "Status" s ON s.id = r."statusId"
        WHERE trc."repositoryCaseId" = ${subject.caseId}
          AND r."isDeleted" = false
          AND tr."isDeleted" = false
          AND r.id <> ${manualExclude}
          AND r."executedAt" <= ${subject.executedAt}
        UNION ALL
        SELECT COALESCE(jr."executedAt", jr."createdAt") AS "at",
               jr.time::double precision AS elapsed,
               COALESCE(s."isSuccess", jr.type = 'PASSED') AS "isSuccess",
               COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) AS "isFailure",
               'AUTOMATED'::text AS source
        FROM "JUnitTestResult" jr
        JOIN "JUnitTestSuite" ts ON ts.id = jr."testSuiteId"
        JOIN "TestRuns" tr ON tr.id = ts."testRunId"
        LEFT JOIN "Status" s ON s.id = jr."statusId"
        WHERE jr."repositoryCaseId" = ${subject.caseId}
          AND tr."isDeleted" = false
          AND jr.id <> ${junitExclude}
          AND COALESCE(jr."executedAt", jr."createdAt") <= ${subject.executedAt}
      ) h
      ORDER BY h."at" DESC
      LIMIT ${MAX_HISTORY}
    `;
    return rows.map((r) => ({
      elapsed: r.elapsed == null ? null : Number(r.elapsed),
      isSuccess: Boolean(r.isSuccess),
      isFailure: Boolean(r.isFailure),
      source: r.source === "AUTOMATED" ? "AUTOMATED" : "MANUAL",
    }));
  }

  /** The folder and every live descendant, as a set of ids. */
  private async loadFolderSubtree(folderId: number): Promise<Set<number>> {
    const rows: any[] = await this.db.$queryRaw`
      WITH RECURSIVE tree AS (
        SELECT id FROM "RepositoryFolders" WHERE id = ${folderId}
        UNION ALL
        SELECT f.id FROM "RepositoryFolders" f
        JOIN tree ON f."parentId" = tree.id
        WHERE f."isDeleted" = false
      )
      SELECT id FROM tree
    `;
    return new Set(rows.map((r) => Number(r.id)));
  }

  // ---------------------------------------------------------------------
  // Run metrics
  // ---------------------------------------------------------------------

  private async runMatchesScope(
    rule: AlertRuleRow,
    run: RunSubject
  ): Promise<boolean> {
    switch (rule.scopeType) {
      case AlertScopeType.PROJECT:
        return true;
      case AlertScopeType.RUN_NAME: {
        const fragment = (rule.scopeText ?? "").trim().toLowerCase();
        return (
          fragment.length > 0 && run.runName.toLowerCase().includes(fragment)
        );
      }
      case AlertScopeType.TAG: {
        if (rule.scopeId == null) return false;
        const rows: any[] = await this.db.$queryRaw`
          SELECT 1 FROM "_TagsToTestRuns" WHERE "A" = ${rule.scopeId} AND "B" = ${run.runId} LIMIT 1
        `;
        return rows.length > 0;
      }
      default:
        return false;
    }
  }

  /**
   * Passed/failed counts for the run, one per live run case, read through
   * the EffectiveCaseStatus view so manual, hybrid and reporter-SDK runs
   * all resolve to the right source (issue #591).
   */
  private async loadRunCounts(run: RunSubject): Promise<RunCounts> {
    const rows: any[] = await this.db.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE s."isSuccess")::int AS passed,
        COUNT(*) FILTER (WHERE s."isFailure")::int AS failed
      FROM "EffectiveCaseStatus" e
      LEFT JOIN "Status" s ON s.id = e."statusId"
      WHERE e."testRunId" = ${run.runId}
    `;
    return {
      passed: Number(rows?.[0]?.passed ?? 0),
      failed: Number(rows?.[0]?.failed ?? 0),
    };
  }

  /**
   * Durations of the earlier completed runs the rule's scope groups together
   * (same tag, same name fragment, or every run), newest first.
   */
  private async loadPreviousRunDurations(
    rule: AlertRuleRow,
    run: RunSubject
  ): Promise<ResultSample[]> {
    const fragment =
      rule.scopeType === AlertScopeType.RUN_NAME
        ? `%${(rule.scopeText ?? "").trim()}%`
        : null;
    const tagId = rule.scopeType === AlertScopeType.TAG ? rule.scopeId : null;
    const rows: any[] = await this.db.$queryRaw`
      SELECT tr.elapsed::double precision AS elapsed
      FROM "TestRuns" tr
      WHERE tr."projectId" = ${run.projectId}
        AND tr.id <> ${run.runId}
        AND tr."isCompleted" = true
        AND tr."isDeleted" = false
        AND tr.elapsed IS NOT NULL
        AND (${fragment == null} OR tr.name ILIKE ${fragment ?? ""})
        AND (${tagId == null} OR EXISTS (
          SELECT 1 FROM "_TagsToTestRuns" x WHERE x."A" = ${tagId ?? -1} AND x."B" = tr.id))
      ORDER BY tr."completedAt" DESC NULLS LAST, tr.id DESC
      LIMIT ${MAX_HISTORY}
    `;
    return rows.map((r) => ({
      elapsed: r.elapsed == null ? null : Number(r.elapsed),
      isSuccess: false,
      isFailure: false,
    }));
  }

  /** Distinct live defects linked to any result in the run. */
  private async loadRunIssueCount(runId: number): Promise<number> {
    return this.db.issue.count({
      where: {
        ...DEFECT_SCOPE_WHERE,
        isDeleted: false,
        testRunResults: { some: { testRunId: runId, isDeleted: false } },
      },
    });
  }

  private evaluateRunRule(
    rule: AlertRuleRow,
    counts: RunCounts
  ): { observed: number; details: Record<string, unknown> } | null {
    switch (rule.metric) {
      case AlertMetric.RUN_PASS_RATE_BELOW: {
        const verdict = evaluatePassRate({
          counts,
          thresholdPercent: rule.thresholdValue,
          minSamples: rule.minSamples,
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.passRate,
          details: {
            passRate: verdict.passRate,
            passed: counts.passed,
            failed: counts.failed,
            sampleCount: verdict.sampleCount,
          },
        };
      }
      case AlertMetric.RUN_FAILURE_COUNT: {
        const verdict = evaluateFailureCount({
          counts,
          count: rule.thresholdValue,
        });
        if (!verdict.fired) return null;
        return {
          observed: verdict.failed,
          details: { failed: counts.failed, passed: counts.passed },
        };
      }
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------
  // Milestone metrics
  // ---------------------------------------------------------------------

  /**
   * Completion of a milestone, counted the way the milestone page counts it
   * (`getMilestoneCaseCompletion`): run cases with a finished status over
   * the run cases in its live runs.
   */
  private async loadMilestoneCompletion(
    milestoneId: number
  ): Promise<{ completed: number; total: number }> {
    const counts = await getMilestoneCaseCompletion([milestoneId], this.db);
    return counts.get(milestoneId) ?? { total: 0, completed: 0 };
  }

  // ---------------------------------------------------------------------
  // Scheduled run metrics
  // ---------------------------------------------------------------------

  /**
   * Open runs of a project with their last activity and, when linked to a
   * milestone, its due date and untested share. One statement per project.
   */
  private async evaluateScheduledRuns(
    rules: AlertRuleRow[],
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const projectId = rules[0].projectId;
    const rows: any[] = await this.db.$queryRaw`
      SELECT tr.id, tr.name, tr."testRunType", tr.elapsed, p.name AS "projectName",
             m."completedAt" AS "milestoneDueAt", m."isCompleted" AS "milestoneCompleted",
             (SELECT MAX(e."executedAt") FROM "EffectiveCaseStatus" e
               WHERE e."testRunId" = tr.id) AS "lastActivityAt",
             (SELECT COUNT(*)::int FROM "EffectiveCaseStatus" e
               WHERE e."testRunId" = tr.id) AS total,
             (SELECT COUNT(*)::int FROM "EffectiveCaseStatus" e
               WHERE e."testRunId" = tr.id AND e."hasResult" = false) AS untested
      FROM "TestRuns" tr
      JOIN "Projects" p ON p.id = tr."projectId"
      LEFT JOIN "Milestones" m ON m.id = tr."milestoneId" AND m."isDeleted" = false
      WHERE tr."projectId" = ${projectId}
        AND tr."isCompleted" = false
        AND tr."isDeleted" = false
    `;
    const fired: FiredAlert[] = [];
    const now = this.now();
    for (const row of rows) {
      const subject: RunSubject = {
        runId: Number(row.id),
        runName: row.name,
        projectId,
        projectName: row.projectName ?? "",
        testRunType: row.testRunType,
        isCompleted: false,
        elapsed: row.elapsed == null ? null : Number(row.elapsed),
      };
      for (const rule of rules) {
        if (!(await this.runMatchesScope(rule, subject))) continue;
        let outcome: {
          observed: number;
          details: Record<string, unknown>;
        } | null = null;
        if (rule.metric === AlertMetric.RUN_NOT_PROGRESSING) {
          const verdict = evaluateNotProgressing({
            lastActivityAt: row.lastActivityAt
              ? new Date(row.lastActivityAt)
              : null,
            now,
            hours: rule.thresholdValue,
          });
          if (verdict.fired) {
            outcome = {
              observed: verdict.idleHours,
              details: {
                idleHours: verdict.idleHours,
                lastActivityAt: new Date(row.lastActivityAt).toISOString(),
              },
            };
          }
        } else if (rule.metric === AlertMetric.RUN_UNTESTED_SHARE) {
          if (!row.milestoneDueAt || row.milestoneCompleted) continue;
          const verdict = evaluateUntestedShare({
            untested: Number(row.untested ?? 0),
            total: Number(row.total ?? 0),
            dueAt: new Date(row.milestoneDueAt),
            now,
            thresholdPercent: rule.thresholdValue,
            daysRemaining: rule.secondaryValue ?? 0,
          });
          if (verdict.fired) {
            outcome = {
              observed: verdict.untestedPercent,
              details: {
                untestedPercent: verdict.untestedPercent,
                untested: Number(row.untested ?? 0),
                total: Number(row.total ?? 0),
                daysRemaining: verdict.daysRemaining,
                dueAt: new Date(row.milestoneDueAt).toISOString(),
              },
            };
          }
        }
        if (!outcome) continue;
        const event = await this.fire({
          rule,
          subjectType: AlertSubjectType.RUN,
          subjectId: subject.runId,
          subjectName: subject.runName,
          projectId,
          projectName: subject.projectName,
          observedValue: outcome.observed,
          baselineValue: null,
          thresholdValue: rule.thresholdValue,
          details: { ...outcome.details, testRunId: subject.runId },
          testRunId: subject.runId,
          tenantId,
        });
        if (event) fired.push(event);
      }
    }
    return fired;
  }

  // ---------------------------------------------------------------------
  // Project-wide metrics
  // ---------------------------------------------------------------------

  private async evaluateProjectRules(
    projectId: number,
    rules: AlertRuleRow[],
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const project = await this.db.projects.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, isDeleted: true },
    });
    if (!project || project.isDeleted) return [];
    const fired: FiredAlert[] = [];
    let coverage: Map<
      number,
      { linkedCaseCount: number; status: string }
    > | null = null;
    for (const rule of rules) {
      let outcome: {
        observed: number;
        details: Record<string, unknown>;
      } | null = null;
      if (rule.metric === AlertMetric.REQUIREMENT_COVERAGE_BELOW) {
        coverage ??= await getRequirementCoverage(
          projectId,
          { accessibleProjectIds: null },
          undefined,
          this.db
        );
        const total = coverage.size;
        let covered = 0;
        for (const breakdown of coverage.values()) {
          if (
            rule.coverageBasis === "PASSING"
              ? breakdown.status === "PASSED"
              : breakdown.linkedCaseCount > 0
          ) {
            covered += 1;
          }
        }
        const verdict = evaluateShareBelow({
          part: covered,
          total,
          thresholdPercent: rule.thresholdValue,
        });
        if (verdict.fired) {
          outcome = {
            observed: verdict.percent,
            details: {
              coveragePercent: verdict.percent,
              covered,
              total,
              basis: rule.coverageBasis,
            },
          };
        }
      } else if (rule.metric === AlertMetric.STALE_CASES) {
        const days = Math.max(0, rule.secondaryValue ?? 0);
        const stale = await this.countStaleCases(projectId, rule, days);
        const verdict = evaluateCountAbove({
          observed: stale,
          count: rule.thresholdValue,
        });
        if (verdict.fired) {
          outcome = { observed: stale, details: { stale, days } };
        }
      } else if (rule.metric === AlertMetric.AUTOMATION_SHARE_BELOW) {
        const { automated, total } = await this.countAutomationShare(
          projectId,
          rule
        );
        const verdict = evaluateShareBelow({
          part: automated,
          total,
          thresholdPercent: rule.thresholdValue,
        });
        if (verdict.fired) {
          outcome = {
            observed: verdict.percent,
            details: { automatedPercent: verdict.percent, automated, total },
          };
        }
      }
      if (!outcome) continue;
      const event = await this.fire({
        rule,
        subjectType: AlertSubjectType.PROJECT,
        subjectId: projectId,
        subjectName: project.name,
        projectId,
        projectName: project.name,
        observedValue: outcome.observed,
        baselineValue: null,
        thresholdValue: rule.thresholdValue,
        details: outcome.details,
        tenantId,
      });
      if (event) fired.push(event);
    }
    return fired;
  }

  /** The rule's case-set scope as query inputs; nulls mean the whole project. */
  private async caseSetFilter(
    rule: AlertRuleRow
  ): Promise<{ folderIds: number[] | null; tagId: number | null }> {
    if (rule.scopeType === AlertScopeType.FOLDER && rule.scopeId != null) {
      return {
        folderIds: [...(await this.loadFolderSubtree(rule.scopeId))],
        tagId: null,
      };
    }
    if (rule.scopeType === AlertScopeType.TAG && rule.scopeId != null) {
      return { folderIds: null, tagId: rule.scopeId };
    }
    return { folderIds: null, tagId: null };
  }

  /**
   * Live cases in scope, older than `days`, with no result (manual or
   * automated) newer than `days`.
   */
  private async countStaleCases(
    projectId: number,
    rule: AlertRuleRow,
    days: number
  ): Promise<number> {
    const { folderIds, tagId } = await this.caseSetFilter(rule);
    const since = new Date(this.now().getTime() - days * 24 * 60 * 60 * 1000);
    const rows: any[] = await this.db.$queryRaw`
      SELECT COUNT(*)::int AS stale
      FROM "RepositoryCases" rc
      WHERE rc."projectId" = ${projectId}
        AND rc."isDeleted" = false
        AND rc."createdAt" < ${since}
        AND (${folderIds == null} OR rc."folderId" = ANY(${folderIds ?? []}::int[]))
        AND (${tagId == null} OR EXISTS (
          SELECT 1 FROM "RepositoryCaseTag" t
          WHERE t."caseId" = rc.id AND t."tagId" = ${tagId ?? -1}))
        AND NOT EXISTS (
          SELECT 1 FROM "TestRunResults" r
          JOIN "TestRunCases" trc ON trc.id = r."testRunCaseId"
          WHERE trc."repositoryCaseId" = rc.id
            AND r."isDeleted" = false
            AND r."executedAt" >= ${since})
        AND NOT EXISTS (
          SELECT 1 FROM "JUnitTestResult" jr
          WHERE jr."repositoryCaseId" = rc.id
            AND COALESCE(jr."executedAt", jr."createdAt") >= ${since})
    `;
    return Number(rows?.[0]?.stale ?? 0);
  }

  private async countAutomationShare(
    projectId: number,
    rule: AlertRuleRow
  ): Promise<{ automated: number; total: number }> {
    const { folderIds, tagId } = await this.caseSetFilter(rule);
    const rows: any[] = await this.db.$queryRaw`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE rc.automated)::int AS automated
      FROM "RepositoryCases" rc
      WHERE rc."projectId" = ${projectId}
        AND rc."isDeleted" = false
        AND (${folderIds == null} OR rc."folderId" = ANY(${folderIds ?? []}::int[]))
        AND (${tagId == null} OR EXISTS (
          SELECT 1 FROM "RepositoryCaseTag" t
          WHERE t."caseId" = rc.id AND t."tagId" = ${tagId ?? -1}))
    `;
    return {
      automated: Number(rows?.[0]?.automated ?? 0),
      total: Number(rows?.[0]?.total ?? 0),
    };
  }

  // ---------------------------------------------------------------------
  // Webhook metrics
  // ---------------------------------------------------------------------

  /**
   * Failure rate over the last N outbound deliveries of each active webhook
   * in scope. A delivery failed when the dispatcher recorded an error.
   */
  private async evaluateWebhookRules(
    projectId: number,
    rules: AlertRuleRow[],
    tenantId?: string
  ): Promise<FiredAlert[]> {
    const configs: any[] = await this.db.webhookConfig.findMany({
      where: {
        projectId,
        direction: "OUTBOUND",
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        url: true,
        project: { select: { name: true } },
      },
    });
    const fired: FiredAlert[] = [];
    for (const config of configs) {
      const label = config.name || config.url || config.id;
      for (const rule of rules) {
        if (
          rule.scopeType === AlertScopeType.WEBHOOK &&
          rule.scopeText !== config.id
        ) {
          continue;
        }
        if (
          rule.scopeType !== AlertScopeType.WEBHOOK &&
          rule.scopeType !== AlertScopeType.PROJECT
        ) {
          continue;
        }
        const rows: any[] = await this.db.$queryRaw`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE d.error IS NOT NULL)::int AS failed
          FROM (
            SELECT d.error FROM "WebhookDelivery" d
            WHERE d."webhookConfigId" = ${config.id}
              AND d.direction = 'OUTBOUND'
            ORDER BY d."receivedAt" DESC
            LIMIT ${rule.baselineWindow}
          ) d
        `;
        const verdict = evaluateFailureRate({
          failed: Number(rows?.[0]?.failed ?? 0),
          total: Number(rows?.[0]?.total ?? 0),
          thresholdPercent: rule.thresholdValue,
          minSamples: rule.minSamples,
        });
        if (!verdict.fired) continue;
        const event = await this.fire({
          rule,
          subjectType: AlertSubjectType.WEBHOOK,
          subjectId: 0,
          subjectRef: config.id,
          subjectName: label,
          projectId,
          projectName: config.project?.name ?? "",
          observedValue: verdict.failureRate,
          baselineValue: null,
          thresholdValue: rule.thresholdValue,
          details: {
            failureRate: verdict.failureRate,
            failed: Number(rows?.[0]?.failed ?? 0),
            sampleCount: verdict.sampleCount,
            webhookConfigId: config.id,
          },
          tenantId,
        });
        if (event) fired.push(event);
      }
    }
    return fired;
  }

  // ---------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------

  private async loadRules(
    projectId: number | undefined,
    metrics: AlertMetric[]
  ): Promise<AlertRuleRow[]> {
    if (metrics.length === 0) return [];
    return this.db.alertRule.findMany({
      where: {
        ...(projectId != null ? { projectId } : {}),
        isEnabled: true,
        isDeleted: false,
        metric: { in: metrics },
        project: { isDeleted: false },
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        metric: true,
        scopeType: true,
        scopeId: true,
        scopeText: true,
        thresholdValue: true,
        secondaryValue: true,
        direction: true,
        baselineType: true,
        baselineWindow: true,
        minSamples: true,
        resultSource: true,
        evaluateOn: true,
        coverageBasis: true,
        cooldownMinutes: true,
        emitWebhook: true,
      },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Records the firing and delivers it. Returns null when the subject is
   * still inside the rule's cooldown. Delivery failures are logged, never
   * thrown: the event row is the record of truth and a notification hiccup
   * must not fail the job (which would re-run and double-fire).
   */
  private async fire(params: {
    rule: AlertRuleRow;
    subjectType: AlertSubjectType;
    subjectId: number;
    /** String key for subjects without an integer id (webhook configs). */
    subjectRef?: string | null;
    subjectName: string;
    projectId: number;
    projectName: string;
    observedValue: number;
    baselineValue: number | null;
    thresholdValue: number;
    details: Record<string, unknown>;
    testRunId?: number;
    tenantId?: string;
  }): Promise<FiredAlert | null> {
    const { rule } = params;
    const now = this.now();

    const last = await this.db.alertEvent.findFirst({
      where: {
        ruleId: rule.id,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        ...(params.subjectRef ? { subjectRef: params.subjectRef } : {}),
      },
      orderBy: { firedAt: "desc" },
      select: { firedAt: true },
    });
    if (!cooldownElapsed(last?.firedAt ?? null, rule.cooldownMinutes, now)) {
      return null;
    }

    const event = await this.db.alertEvent.create({
      data: {
        ruleId: rule.id,
        projectId: params.projectId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectRef: params.subjectRef ?? null,
        subjectName: params.subjectName,
        observedValue: params.observedValue,
        baselineValue: params.baselineValue,
        thresholdValue: params.thresholdValue,
        details: params.details,
        firedAt: now,
      },
      select: { id: true },
    });
    await this.db.alertRule.update({
      where: { id: rule.id },
      data: { lastFiredAt: now },
    });

    let notified = 0;
    // Who was told, captured now: the audience can change after the fact.
    let recipientIds: string[] = [];
    try {
      const recipients = await resolveAlertRecipients(
        this.db,
        rule.id,
        params.projectId
      );
      await NotificationService.createAlertTriggeredNotification({
        targetUserIds: recipients,
        eventId: event.id,
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        projectId: params.projectId,
        projectName: params.projectName,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        subjectName: params.subjectName,
        observedValue: params.observedValue,
        baselineValue: params.baselineValue,
        thresholdValue: params.thresholdValue,
        testRunId: params.testRunId ?? null,
        details: params.details,
        tenantId: params.tenantId,
      });
      notified = recipients.length;
      recipientIds = recipients;
    } catch (error) {
      console.error(
        `[alerts] rule ${rule.id} fired for ${params.subjectType} ${params.subjectId} but notifying failed:`,
        error
      );
    }

    let webhookEmitted = false;
    if (rule.emitWebhook) {
      try {
        await this.db.$transaction(async (tx: any) => {
          await webhookEvents.emit(
            ALERT_WEBHOOK_EVENT,
            {
              eventId: event.id,
              ruleId: rule.id,
              ruleName: rule.name,
              metric: rule.metric,
              projectId: params.projectId,
              projectName: params.projectName,
              subjectType: params.subjectType,
              subjectId: params.subjectId,
              subjectRef: params.subjectRef ?? null,
              subjectName: params.subjectName,
              subjectUrl: subjectUrl(
                params.subjectType,
                params.projectId,
                params.subjectId,
                params.testRunId
              ),
              observedValue: params.observedValue,
              baselineValue: params.baselineValue,
              thresholdValue: params.thresholdValue,
              details: params.details,
              firedAt: now.toISOString(),
            },
            { projectId: params.projectId, tx, actorUserId: null }
          );
        });
        webhookEmitted = true;
      } catch (error) {
        console.error(
          `[alerts] rule ${rule.id}: webhook emit failed for event ${event.id}:`,
          error
        );
      }
    }

    await this.db.alertEvent.update({
      where: { id: event.id },
      data: { notifiedCount: notified, recipientIds, webhookEmitted },
    });

    console.info(
      `[alerts] rule ${rule.id} "${rule.name}" fired for ${params.subjectType} ${params.subjectId} (observed ${params.observedValue}, threshold ${params.thresholdValue}); notified ${notified}`
    );

    return {
      ruleId: rule.id,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      eventId: event.id,
      notified,
    };
  }
}

function sourceAccepts(
  ruleSource: AlertResultSource,
  resultSource: "MANUAL" | "AUTOMATED"
): boolean {
  return ruleSource === AlertResultSource.BOTH || ruleSource === resultSource;
}

function subjectUrl(
  subjectType: AlertSubjectType,
  projectId: number,
  subjectId: number,
  testRunId?: number | null
): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${subjectPath(subjectType, projectId, subjectId, testRunId)}`;
}
