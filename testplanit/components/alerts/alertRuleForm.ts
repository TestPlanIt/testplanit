import { z } from "zod/v4";
import {
  AlertBaseline,
  AlertCoverageBasis,
  AlertDirection,
  AlertEvaluateOn,
  AlertMetric,
  AlertResultSource,
  AlertScopeType,
} from "~/zenstack/models";
import {
  getAlertMetricDefinition,
  metricUsesField,
  ALERT_RULE_LIMITS,
} from "~/lib/alerts/catalogue";

/**
 * Form model for an alert rule (#651). The same shape round-trips to the
 * AlertRule row; `scopeId`/`scopeText` are kept as strings while editing
 * because the pickers speak strings.
 */
export const alertRuleFormSchema = z
  .object({
    name: z.string().trim().min(1).max(ALERT_RULE_LIMITS.nameMaxLength),
    description: z.string().max(2000).optional().or(z.literal("")),
    metric: z.enum(AlertMetric),
    scopeType: z.enum(AlertScopeType),
    scopeId: z.string().optional().or(z.literal("")),
    scopeText: z.string().optional().or(z.literal("")),
    thresholdValue: z.number(),
    secondaryValue: z.number().int().optional(),
    direction: z.enum(AlertDirection),
    baselineType: z.enum(AlertBaseline),
    baselineWindow: z
      .number()
      .int()
      .min(ALERT_RULE_LIMITS.baselineWindow.min)
      .max(ALERT_RULE_LIMITS.baselineWindow.max),
    minSamples: z
      .number()
      .int()
      .min(ALERT_RULE_LIMITS.minSamples.min)
      .max(ALERT_RULE_LIMITS.minSamples.max),
    resultSource: z.enum(AlertResultSource),
    evaluateOn: z.enum(AlertEvaluateOn),
    coverageBasis: z.enum(AlertCoverageBasis),
    cooldownMinutes: z
      .number()
      .int()
      .min(ALERT_RULE_LIMITS.cooldownMinutes.min)
      .max(ALERT_RULE_LIMITS.cooldownMinutes.max),
    emitWebhook: z.boolean(),
    isEnabled: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const definition = getAlertMetricDefinition(values.metric);
    if (!definition) return;
    if (
      values.scopeType !== AlertScopeType.PROJECT &&
      values.scopeType !== AlertScopeType.RUN_NAME &&
      values.scopeType !== AlertScopeType.WEBHOOK &&
      !values.scopeId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeId"],
        message: "scopeRequired",
      });
    }
    if (
      values.scopeType === AlertScopeType.RUN_NAME &&
      !(values.scopeText ?? "").trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeText"],
        message: "runNameRequired",
      });
    }
    if (
      values.scopeType === AlertScopeType.WEBHOOK &&
      !(values.scopeText ?? "").trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeText"],
        message: "scopeRequired",
      });
    }
    if (metricUsesField(values.metric, "thresholdValue")) {
      const limits =
        definition.valueKind === "percent"
          ? ALERT_RULE_LIMITS.percent
          : ALERT_RULE_LIMITS.count;
      const isCount = definition.valueKind === "count";
      if (
        !Number.isFinite(values.thresholdValue) ||
        values.thresholdValue < limits.min ||
        values.thresholdValue > limits.max ||
        (isCount && !Number.isInteger(values.thresholdValue))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["thresholdValue"],
          message: isCount ? "countRange" : "percentRange",
        });
      }
    }
    if (metricUsesField(values.metric, "secondaryValue")) {
      const v = values.secondaryValue;
      if (
        v == null ||
        v < ALERT_RULE_LIMITS.secondaryValue.min ||
        v > ALERT_RULE_LIMITS.secondaryValue.max
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["secondaryValue"],
          message: "daysRange",
        });
      }
    }
    if (
      metricUsesField(values.metric, "minSamples") &&
      metricUsesField(values.metric, "baselineWindow") &&
      values.minSamples > values.baselineWindow
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["minSamples"],
        message: "minSamplesWindow",
      });
      ctx.addIssue({
        code: "custom",
        path: ["baselineWindow"],
        message: "windowBelowMinSamples",
      });
    }
  });

export type AlertRuleFormValues = z.infer<typeof alertRuleFormSchema>;

/** The AlertRule columns the form edits. */
export interface AlertRuleLike {
  name: string;
  description?: string | null;
  metric: AlertMetric;
  scopeType: AlertScopeType;
  scopeId?: number | null;
  scopeText?: string | null;
  thresholdValue: number;
  secondaryValue?: number | null;
  direction: AlertDirection;
  baselineType: AlertBaseline;
  baselineWindow: number;
  minSamples: number;
  resultSource: AlertResultSource;
  evaluateOn: AlertEvaluateOn;
  coverageBasis?: AlertCoverageBasis;
  cooldownMinutes: number;
  emitWebhook: boolean;
  isEnabled: boolean;
}

export function defaultAlertRuleValues(
  metric: AlertMetric = AlertMetric.RESULT_DURATION_DEVIATION
): AlertRuleFormValues {
  const definition = getAlertMetricDefinition(metric);
  return {
    name: "",
    description: "",
    metric,
    scopeType: AlertScopeType.PROJECT,
    scopeId: "",
    scopeText: "",
    thresholdValue: definition?.defaults.thresholdValue ?? 0,
    secondaryValue: definition?.defaults.secondaryValue ?? 0,
    direction: AlertDirection.EITHER,
    baselineType: AlertBaseline.MEDIAN,
    baselineWindow: definition?.defaults.baselineWindow ?? 10,
    minSamples: definition?.defaults.minSamples ?? 5,
    resultSource: AlertResultSource.BOTH,
    evaluateOn: AlertEvaluateOn.RUN_COMPLETION,
    coverageBasis: AlertCoverageBasis.LINKED,
    cooldownMinutes: definition?.defaults.cooldownMinutes ?? 1440,
    emitWebhook: false,
    isEnabled: true,
  };
}

/** Switching metric resets the numbers to that metric's defaults and clears a scope it does not accept. */
export function valuesForMetricChange(
  current: AlertRuleFormValues,
  metric: AlertMetric
): AlertRuleFormValues {
  const next = defaultAlertRuleValues(metric);
  const definition = getAlertMetricDefinition(metric);
  const keepScope = definition?.scopes.includes(current.scopeType) ?? false;
  const wasSystem = getAlertMetricDefinition(current.metric)?.system === true;
  const isSystem = definition?.system === true;
  return {
    ...next,
    name: current.name,
    description: current.description,
    // Crossing between a project and a system metric takes that metric's
    // own cooldown; otherwise the user's choice stands.
    cooldownMinutes:
      wasSystem === isSystem ? current.cooldownMinutes : next.cooldownMinutes,
    emitWebhook: isSystem ? false : current.emitWebhook,
    isEnabled: current.isEnabled,
    scopeType: keepScope ? current.scopeType : AlertScopeType.PROJECT,
    scopeId: keepScope ? current.scopeId : "",
    scopeText: keepScope ? current.scopeText : "",
  };
}

export function ruleToFormValues(rule: AlertRuleLike): AlertRuleFormValues {
  return {
    name: rule.name,
    description: rule.description ?? "",
    metric: rule.metric,
    scopeType: rule.scopeType,
    scopeId: rule.scopeId != null ? String(rule.scopeId) : "",
    scopeText: rule.scopeText ?? "",
    thresholdValue: rule.thresholdValue,
    secondaryValue: rule.secondaryValue ?? 0,
    direction: rule.direction,
    baselineType: rule.baselineType,
    baselineWindow: rule.baselineWindow,
    minSamples: rule.minSamples,
    resultSource: rule.resultSource,
    evaluateOn: rule.evaluateOn,
    coverageBasis: rule.coverageBasis ?? AlertCoverageBasis.LINKED,
    cooldownMinutes: rule.cooldownMinutes,
    emitWebhook: rule.emitWebhook,
    isEnabled: rule.isEnabled,
  };
}

/** The columns to write, with unused fields normalised so a row reads cleanly. */
export function formValuesToRuleData(
  values: AlertRuleFormValues
): Omit<AlertRuleLike, "metric"> & { metric: AlertMetric } {
  const usesScopeText =
    values.scopeType === AlertScopeType.RUN_NAME ||
    values.scopeType === AlertScopeType.WEBHOOK;
  const usesScopeId =
    values.scopeType !== AlertScopeType.PROJECT && !usesScopeText;
  return {
    name: values.name.trim(),
    description: values.description?.trim() ? values.description.trim() : null,
    metric: values.metric,
    scopeType: values.scopeType,
    scopeId: usesScopeId && values.scopeId ? Number(values.scopeId) : null,
    scopeText: usesScopeText ? (values.scopeText ?? "").trim() : null,
    thresholdValue: metricUsesField(values.metric, "thresholdValue")
      ? values.thresholdValue
      : 0,
    secondaryValue: metricUsesField(values.metric, "secondaryValue")
      ? (values.secondaryValue ?? 0)
      : null,
    direction: values.direction,
    baselineType: values.baselineType,
    baselineWindow: values.baselineWindow,
    minSamples: values.minSamples,
    resultSource: values.resultSource,
    evaluateOn: values.evaluateOn,
    coverageBasis: values.coverageBasis,
    cooldownMinutes: values.cooldownMinutes,
    emitWebhook: values.emitWebhook,
    isEnabled: values.isEnabled,
  };
}
