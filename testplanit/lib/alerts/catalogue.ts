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

/** The rule columns a metric's condition is built from. */
export type AlertRuleField =
  | "thresholdValue"
  | "secondaryValue"
  | "direction"
  | "baselineType"
  | "baselineWindow"
  | "minSamples"
  | "resultSource"
  | "evaluateOn";

/** What `thresholdValue` means for a metric: a percentage or a count. */
export type AlertValueKind = "percent" | "count";

export interface AlertMetricDefinition {
  metric: AlertMetric;
  subjectType: AlertSubjectType;
  path: AlertEvaluationPath;
  /** Which scopes the rule form offers for this metric; PROJECT is always first. */
  scopes: readonly AlertScopeType[];
  /** The rule fields the condition uses, in sentence order. */
  fields: readonly AlertRuleField[];
  valueKind: AlertValueKind;
  /** Form defaults; also the values the evaluator assumes when a field is unused. */
  defaults: {
    thresholdValue: number;
    secondaryValue?: number;
    baselineWindow?: number;
    minSamples?: number;
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

export const ALERT_METRIC_CATALOGUE: readonly AlertMetricDefinition[] = [
  {
    metric: AlertMetric.RESULT_DURATION_DEVIATION,
    subjectType: AlertSubjectType.CASE,
    path: "event",
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
    scopes: CASE_SCOPES,
    fields: ["baselineWindow", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 0, baselineWindow: 3, minSamples: 3 },
  },
  {
    metric: AlertMetric.CONSECUTIVE_FAILURES,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    scopes: CASE_SCOPES,
    fields: ["thresholdValue", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 3 },
  },
  {
    metric: AlertMetric.CASE_FLAKY,
    subjectType: AlertSubjectType.CASE,
    path: "event",
    scopes: CASE_SCOPES,
    fields: ["thresholdValue", "baselineWindow", "resultSource"],
    valueKind: "count",
    defaults: { thresholdValue: 3, baselineWindow: 10, minSamples: 10 },
  },
  {
    metric: AlertMetric.RUN_PASS_RATE_BELOW,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "minSamples", "evaluateOn"],
    valueKind: "percent",
    defaults: { thresholdValue: 90, minSamples: 10 },
  },
  {
    metric: AlertMetric.RUN_FAILURE_COUNT,
    subjectType: AlertSubjectType.RUN,
    path: "event",
    scopes: RUN_SCOPES,
    fields: ["thresholdValue", "evaluateOn"],
    valueKind: "count",
    defaults: { thresholdValue: 5 },
  },
  {
    metric: AlertMetric.MILESTONE_BEHIND,
    subjectType: AlertSubjectType.MILESTONE,
    path: "scheduled",
    scopes: MILESTONE_SCOPES,
    fields: ["thresholdValue", "secondaryValue"],
    valueKind: "percent",
    defaults: { thresholdValue: 80, secondaryValue: 3 },
  },
  {
    metric: AlertMetric.MILESTONE_OVERDUE,
    subjectType: AlertSubjectType.MILESTONE,
    path: "scheduled",
    scopes: MILESTONE_SCOPES,
    fields: [],
    valueKind: "count",
    defaults: { thresholdValue: 0 },
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

/** Metrics evaluated by the daily scheduled job. */
export function scheduledAlertMetrics(): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter((m) => m.path === "scheduled").map(
    (m) => m.metric
  );
}

/** Metrics evaluated when a result is recorded on a case. */
export function caseEventAlertMetrics(): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) => m.path === "event" && m.subjectType === AlertSubjectType.CASE
  ).map((m) => m.metric);
}

/** Metrics evaluated on run results and on run completion. */
export function runEventAlertMetrics(): AlertMetric[] {
  return ALERT_METRIC_CATALOGUE.filter(
    (m) => m.path === "event" && m.subjectType === AlertSubjectType.RUN
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
