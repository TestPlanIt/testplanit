import {
  AlertMetric,
  AlertScopeType,
  AlertSubjectType,
} from "~/zenstack/models";

/**
 * The threshold metric catalogue (#651): one entry per `AlertMetric`.
 *
 * It is the single description of what each metric watches, which rule
 * fields it reads, which scopes it accepts and how it is evaluated. The rule
 * form reads it to show only the fields a metric uses; the evaluator reads
 * it to route a rule to the right check; `catalogue.test.ts` fails when the
 * enum and this list disagree or when a metric has no translation.
 *
 * Translation keys live under `alerts.metrics.<METRIC>` in en-US:
 * `label`, `description` and `sentence` (the condition rendered as a
 * sentence, with ICU placeholders for the rule's numbers).
 */

export type AlertEvaluationPath = "event" | "scheduled";

/** What starts an event-driven evaluation. */
export type AlertEventTrigger =
  "result" | "run" | "execution" | "session" | "llmUsage";

/** How often the scheduler visits a scheduled metric. */
export type AlertSchedule = "hourly" | "daily";

/** The rule columns a metric's condition is built from. */
export type AlertRuleField =
  | "thresholdValue"
  | "secondaryValue"
  | "direction"
  | "baselineType"
  | "baselineWindow"
  | "minSamples"
  | "resultSource"
  | "evaluateOn"
  | "coverageBasis";

/** What `thresholdValue` means for a metric: a percentage or a count. */
export type AlertValueKind = "percent" | "count";

export interface AlertMetricDefinition {
  metric: AlertMetric;
  subjectType: AlertSubjectType;
  path: AlertEvaluationPath;
  /** Event metrics: what fires the evaluation. Absent for scheduled metrics. */
  trigger?: AlertEventTrigger;
  /** Scheduled metrics: how often. Absent for event metrics. */
  schedule?: AlertSchedule;
  /** Which scopes the rule form offers for this metric; PROJECT is always first. */
  scopes: readonly AlertScopeType[];
  /** The rule fields the condition uses, in sentence order. */
  fields: readonly AlertRuleField[];
  valueKind: AlertValueKind;
  /**
   * The subject is administration-level (an AI model budget), not a
   * project's: rules carry no project, only system administrators create,
   * see or follow them, and they never emit project webhooks.
   */
  system?: boolean;
  /** Form defaults; also the values the evaluator assumes when a field is unused. */
  defaults: {
    thresholdValue: number;
    secondaryValue?: number;
    baselineWindow?: number;
    minSamples?: number;
    cooldownMinutes?: number;
  };
}

const CASE_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.FOLDER,
  AlertScopeType.TAG,
  AlertScopeType.CASE,
] as const;

const RUN_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.TAG,
  AlertScopeType.RUN_NAME,
] as const;

const MILESTONE_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.MILESTONE,
] as const;

/** A set of cases watched as a whole: the project, a folder or a tag. */
const CASE_SET_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.FOLDER,
  AlertScopeType.TAG,
] as const;

const SESSION_SCOPES = [AlertScopeType.PROJECT, AlertScopeType.TAG] as const;

const WEBHOOK_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.WEBHOOK,
] as const;

const PROJECT_ONLY = [AlertScopeType.PROJECT] as const;

/** Every AI model integration, or one of them. */
const LLM_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.LLM_INTEGRATION,
] as const;

/** Every code repository connection, or one of them. */
const CODE_REPOSITORY_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.CODE_REPOSITORY,
] as const;

/** Every issue-tracker integration, or one of them. */
const INTEGRATION_SCOPES = [
  AlertScopeType.PROJECT,
  AlertScopeType.INTEGRATION,
] as const;

/** Every background queue, or one of them (its name in scopeText). */
const QUEUE_SCOPES = [AlertScopeType.PROJECT, AlertScopeType.QUEUE] as const;

export const ALERT_METRIC_CATALOGUE: readonly AlertMetricDefinition[] = [
  {
    metric: AlertMetric.RESULT_DURATION_DEVIATION,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    trigger: "result",
    scopes: CASE_SCOPES,
    fields: [
      "thresholdValue",
      "direction",
      "baselineType",
      "baselineWindow",
      "minSamples",
      "resultSource",
    ],
    valueKind: "percent",
    defaults: { thresholdValue: 50, baselineWindow: 10, minSamples: 5 },
  },
  {
    metric: AlertMetric.CASE_REGRESSED,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    trigger: "result",
    scopes: CASE_SCOPES,
    fields: ["baselineWindow", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 0, baselineWindow: 3, minSamples: 3 },
  },
  {
    metric: AlertMetric.CASE_RECOVERED,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    trigger: "result",
    scopes: CASE_SCOPES,
    fields: ["baselineWindow", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 0, baselineWindow: 3, minSamples: 3 },
  },
  {
    metric: AlertMetric.CONSECUTIVE_FAILURES,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    trigger: "result",
    scopes: CASE_SCOPES,
    fields: ["thresholdValue", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 3 },
  },
  {
    metric: AlertMetric.CASE_FLAKY,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    trigger: "result",
    scopes: CASE_SCOPES,
    fields: ["thresholdValue", "baselineWindow", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 3, baselineWindow: 10, minSamples: 10 },
  },
  {
    metric: AlertMetric.RUN_PASS_RATE_BELOW,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "run",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "minSamples", "evaluateOn"],
    valueKind: "percent",
    defaults: { thresholdValue: 90, minSamples: 10 },
  },
  {
    metric: AlertMetric.RUN_FAILURE_COUNT,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "run",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "evaluateOn"],
    valueKind: "count",
    defaults: { thresholdValue: 5 },
  },
  {
    metric: AlertMetric.RUN_DURATION_DEVIATION,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "run",
    scopes: RUN_SCOPES,
    fields: [
      "thresholdValue",
      "direction",
      "baselineType",
      "baselineWindow",
      "minSamples",
    ],
    valueKind: "percent",
    defaults: { thresholdValue: 50, baselineWindow: 5, minSamples: 3 },
  },
  {
    metric: AlertMetric.RUN_NOT_PROGRESSING,
    subjectType: AlertSubjectType.RUN,
    path: "scheduled",
    schedule: "hourly",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "count",
    defaults: { thresholdValue: 24 },
  },
  {
    metric: AlertMetric.AUTOMATED_EXECUTION_FAILED,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "execution",
    scopes: RUN_SCOPES,
    fields: [],
    valueKind: "count",
    defaults: { thresholdValue: 0 },
  },
  {
    metric: AlertMetric.RUN_UNTESTED_SHARE,
    subjectType: AlertSubjectType.RUN,
    path: "scheduled",
    schedule: "daily",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "secondaryValue"],
    valueKind: "percent",
    defaults: { thresholdValue: 25, secondaryValue: 3 },
  },
  {
    metric: AlertMetric.RUN_ISSUES_OPENED,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "run",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "evaluateOn"],
    valueKind: "count",
    defaults: { thresholdValue: 3 },
  },
  {
    metric: AlertMetric.NEW_FAILURE_SIGNATURES,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    trigger: "run",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "evaluateOn"],
    valueKind: "count",
    defaults: { thresholdValue: 0 },
  },
  {
    metric: AlertMetric.SESSION_OVERRUN,
    subjectType: AlertSubjectType.SESSION,
    path: "event",
    trigger: "session",
    scopes: SESSION_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "percent",
    defaults: { thresholdValue: 25 },
  },
  {
    metric: AlertMetric.MILESTONE_BEHIND,
    subjectType: AlertSubjectType.MILESTONE,
    path: "scheduled",
    schedule: "daily",
    scopes: MILESTONE_SCOPES,
    fields: ["thresholdValue", "secondaryValue"],
    valueKind: "percent",
    defaults: { thresholdValue: 80, secondaryValue: 3 },
  },
  {
    metric: AlertMetric.MILESTONE_OVERDUE,
    subjectType: AlertSubjectType.MILESTONE,
    path: "scheduled",
    schedule: "daily",
    scopes: MILESTONE_SCOPES,
    fields: [],
    valueKind: "count",
    defaults: { thresholdValue: 0 },
  },
  {
    metric: AlertMetric.REQUIREMENT_COVERAGE_BELOW,
    subjectType: AlertSubjectType.PROJECT,
    path: "scheduled",
    schedule: "daily",
    scopes: PROJECT_ONLY,
    fields: ["thresholdValue", "coverageBasis"],
    valueKind: "percent",
    defaults: { thresholdValue: 80 },
  },
  {
    metric: AlertMetric.STALE_CASES,
    subjectType: AlertSubjectType.PROJECT,
    path: "scheduled",
    schedule: "daily",
    scopes: CASE_SET_SCOPES,
    fields: ["thresholdValue", "secondaryValue"],
    valueKind: "count",
    defaults: { thresholdValue: 10, secondaryValue: 30 },
  },
  {
    metric: AlertMetric.AUTOMATION_SHARE_BELOW,
    subjectType: AlertSubjectType.PROJECT,
    path: "scheduled",
    schedule: "daily",
    scopes: CASE_SET_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "percent",
    defaults: { thresholdValue: 50 },
  },
  {
    metric: AlertMetric.WEBHOOK_FAILURE_RATE,
    subjectType: AlertSubjectType.WEBHOOK,
    path: "scheduled",
    schedule: "hourly",
    scopes: WEBHOOK_SCOPES,
    fields: ["thresholdValue", "baselineWindow", "minSamples"],
    valueKind: "percent",
    defaults: { thresholdValue: 25, baselineWindow: 50, minSamples: 10 },
  },
  {
    metric: AlertMetric.LLM_BUDGET_USED,
    subjectType: AlertSubjectType.LLM_INTEGRATION,
    path: "event",
    trigger: "llmUsage",
    scopes: LLM_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "percent",
    system: true,
    // Once per billing period is the natural cadence, so no cooldown.
    defaults: { thresholdValue: 80, cooldownMinutes: 0 },
  },
  {
    metric: AlertMetric.LLM_ERROR_RATE,
    subjectType: AlertSubjectType.LLM_INTEGRATION,
    path: "event",
    trigger: "llmUsage",
    scopes: LLM_SCOPES,
    fields: ["thresholdValue", "baselineWindow", "minSamples"],
    valueKind: "percent",
    system: true,
    defaults: { thresholdValue: 25, baselineWindow: 20, minSamples: 5 },
  },
  {
    metric: AlertMetric.LLM_RATE_LIMITED,
    subjectType: AlertSubjectType.LLM_INTEGRATION,
    path: "event",
    trigger: "llmUsage",
    scopes: LLM_SCOPES,
    fields: ["thresholdValue", "secondaryValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 5, secondaryValue: 24 },
  },
  {
    metric: AlertMetric.CODE_REPOSITORY_CACHE_FAILING,
    subjectType: AlertSubjectType.CODE_REPOSITORY,
    path: "scheduled",
    schedule: "hourly",
    scopes: CODE_REPOSITORY_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 24 },
  },
  {
    metric: AlertMetric.INTEGRATION_REAUTH_NEEDED,
    subjectType: AlertSubjectType.INTEGRATION,
    path: "scheduled",
    schedule: "daily",
    scopes: INTEGRATION_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 5 },
  },
  {
    metric: AlertMetric.QUEUE_FAILED_JOBS,
    subjectType: AlertSubjectType.QUEUE,
    path: "scheduled",
    schedule: "hourly",
    scopes: QUEUE_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 10 },
  },
  {
    metric: AlertMetric.QUEUE_BACKLOG,
    subjectType: AlertSubjectType.QUEUE,
    path: "scheduled",
    schedule: "hourly",
    scopes: QUEUE_SCOPES,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 30 },
  },
  {
    metric: AlertMetric.AUDIT_BACKLOG,
    subjectType: AlertSubjectType.SYSTEM,
    path: "scheduled",
    schedule: "hourly",
    scopes: PROJECT_ONLY,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 30 },
  },
  {
    metric: AlertMetric.ACCOUNT_LOCKOUTS,
    subjectType: AlertSubjectType.SYSTEM,
    path: "scheduled",
    schedule: "hourly",
    scopes: PROJECT_ONLY,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 3 },
  },
  {
    metric: AlertMetric.NO_AUTOMATED_RESULTS,
    subjectType: AlertSubjectType.SYSTEM,
    path: "scheduled",
    schedule: "daily",
    scopes: PROJECT_ONLY,
    fields: ["thresholdValue"],
    valueKind: "count",
    system: true,
    defaults: { thresholdValue: 48 },
  },
];

const byMetric = new Map<string, AlertMetricDefinition>(
  ALERT_METRIC_CATALOGUE.map((entry) => [entry.metric, entry])
);

export function getAlertMetricDefinition(
  metric: string
): AlertMetricDefinition | undefined {
  return byMetric.get(metric);
}

export function metricUsesField(
  metric: string,
  field: AlertRuleField
): boolean {
  return byMetric.get(metric)?.fields.includes(field) ?? false;
}

/** Metrics evaluated by the scheduled jobs; `schedule` narrows to one cadence. */
export function scheduledAlertMetrics(schedule?: AlertSchedule): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) => m.path === "scheduled" && (!schedule || m.schedule === schedule)
  ).map((m) => m.metric);
}

/** The scheduled metrics that are system alerts (no project). */
export function scheduledSystemAlertMetrics(
  schedule?: AlertSchedule
): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) =>
      m.system === true &&
      m.path === "scheduled" &&
      (!schedule || m.schedule === schedule)
  ).map((m) => m.metric);
}

function eventMetrics(trigger: AlertEventTrigger): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) => m.path === "event" && m.trigger === trigger
  ).map((m) => m.metric);
}

/** Metrics evaluated when a result is recorded on a case. */
export function caseEventAlertMetrics(): AlertMetric[] {
  return eventMetrics("result");
}

/** Metrics evaluated on run results and on run completion. */
export function runEventAlertMetrics(): AlertMetric[] {
  return eventMetrics("run");
}

/** Metrics evaluated when an automated execution ends badly. */
export function executionEventAlertMetrics(): AlertMetric[] {
  return eventMetrics("execution");
}

/** Metrics evaluated when a session is completed. */
export function sessionEventAlertMetrics(): AlertMetric[] {
  return eventMetrics("session");
}

/** Metrics evaluated when an AI model integration records usage. */
export function llmUsageAlertMetrics(): AlertMetric[] {
  return eventMetrics("llmUsage");
}

/** Whether rules on this metric are system alerts (no project). */
export function isSystemAlertMetric(metric: string): boolean {
  return byMetric.get(metric)?.system === true;
}

/** The metrics offered for a system alert, or for a project alert. */
export function alertMetricsForScope(system: boolean): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) => (m.system === true) === system
  ).map((m) => m.metric);
}

/** Bounds applied by the form and by the server-side validation. */
export const ALERT_RULE_LIMITS = {
  nameMaxLength: 200,
  baselineWindow: { min: 2, max: 200 },
  minSamples: { min: 1, max: 200 },
  cooldownMinutes: { min: 0, max: 60 * 24 * 30 },
  percent: { min: 1, max: 1000 },
  count: { min: 1, max: 100000 },
  secondaryValue: { min: 0, max: 3650 },
} as const;
