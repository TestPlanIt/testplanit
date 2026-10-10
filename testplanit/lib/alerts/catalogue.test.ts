import { AlertMetric, AlertScopeType } from "~/zenstack/models";
import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import {
  alertMetricsForScope,
  caseEventAlertMetrics,
  executionEventAlertMetrics,
  getAlertMetricDefinition,
  isSystemAlertMetric,
  llmUsageAlertMetrics,
  metricUsesField,
  runEventAlertMetrics,
  scheduledAlertMetrics,
  scheduledSystemAlertMetrics,
  sessionEventAlertMetrics,
  ALERT_METRIC_CATALOGUE,
} from "./catalogue";

const metricMessages = (
  enUS as unknown as {
    alerts: {
      metrics: Record<
        string,
        { label?: string; description?: string; summary?: string }
      >;
    };
  }
).alerts.metrics;

describe("threshold metric catalogue", () => {
  it("has exactly one entry per AlertMetric enum value", () => {
    const catalogued = ALERT_METRIC_CATALOGUE.map((e) => e.metric as string);
    expect(new Set(catalogued).size).toBe(catalogued.length);
    expect([...catalogued].sort()).toEqual(
      [...(Object.values(AlertMetric) as string[])].sort()
    );
  });

  it("has an en-US label, description and summary for every metric", () => {
    for (const entry of ALERT_METRIC_CATALOGUE) {
      const strings = metricMessages[entry.metric];
      expect(strings?.label, `${entry.metric} label`).toBeTruthy();
      expect(strings?.description, `${entry.metric} description`).toBeTruthy();
      expect(strings?.summary, `${entry.metric} summary`).toBeTruthy();
    }
  });

  it("has a threshold label for every metric that uses the threshold", () => {
    const labels = (
      enUS as unknown as {
        alerts: { form: { thresholdLabels: Record<string, string> } };
      }
    ).alerts.form.thresholdLabels;
    for (const entry of ALERT_METRIC_CATALOGUE) {
      if (entry.fields.includes("thresholdValue")) {
        expect(
          labels[entry.metric],
          `${entry.metric} threshold label`
        ).toBeTruthy();
      }
    }
  });

  it("offers the whole project as the first scope of every metric", () => {
    for (const entry of ALERT_METRIC_CATALOGUE) {
      expect(entry.scopes[0]).toBe(AlertScopeType.PROJECT);
    }
  });

  it("splits metrics by evaluation path, trigger and schedule", () => {
    expect(scheduledAlertMetrics("daily")).toEqual([
      AlertMetric.RUN_UNTESTED_SHARE,
      AlertMetric.MILESTONE_BEHIND,
      AlertMetric.MILESTONE_OVERDUE,
      AlertMetric.REQUIREMENT_COVERAGE_BELOW,
      AlertMetric.STALE_CASES,
      AlertMetric.AUTOMATION_SHARE_BELOW,
      AlertMetric.INTEGRATION_REAUTH_NEEDED,
      AlertMetric.NO_AUTOMATED_RESULTS,
    ]);
    expect(scheduledAlertMetrics("hourly")).toEqual([
      AlertMetric.RUN_NOT_PROGRESSING,
      AlertMetric.WEBHOOK_FAILURE_RATE,
      AlertMetric.CODE_REPOSITORY_CACHE_FAILING,
      AlertMetric.QUEUE_FAILED_JOBS,
      AlertMetric.QUEUE_BACKLOG,
      AlertMetric.AUDIT_BACKLOG,
      AlertMetric.ACCOUNT_LOCKOUTS,
    ]);
    expect(scheduledAlertMetrics()).toHaveLength(15);
    expect(scheduledSystemAlertMetrics("daily")).toEqual([
      AlertMetric.INTEGRATION_REAUTH_NEEDED,
      AlertMetric.NO_AUTOMATED_RESULTS,
    ]);
    expect(scheduledSystemAlertMetrics()).toHaveLength(7);
    expect(caseEventAlertMetrics()).toEqual([
      AlertMetric.RESULT_DURATION_DEVIATION,
      AlertMetric.CASE_REGRESSED,
      AlertMetric.CASE_RECOVERED,
      AlertMetric.CONSECUTIVE_FAILURES,
      AlertMetric.CASE_FLAKY,
    ]);
    expect(runEventAlertMetrics()).toEqual([
      AlertMetric.RUN_PASS_RATE_BELOW,
      AlertMetric.RUN_FAILURE_COUNT,
      AlertMetric.RUN_DURATION_DEVIATION,
      AlertMetric.RUN_ISSUES_OPENED,
    ]);
    expect(executionEventAlertMetrics()).toEqual([
      AlertMetric.AUTOMATED_EXECUTION_FAILED,
    ]);
    expect(sessionEventAlertMetrics()).toEqual([AlertMetric.SESSION_OVERRUN]);
    expect(llmUsageAlertMetrics()).toEqual([
      AlertMetric.LLM_BUDGET_USED,
      AlertMetric.LLM_ERROR_RATE,
      AlertMetric.LLM_RATE_LIMITED,
    ]);
  });

  it("keeps the AI budget metric on the system side, apart from the project metrics", () => {
    expect(isSystemAlertMetric(AlertMetric.LLM_BUDGET_USED)).toBe(true);
    expect(isSystemAlertMetric(AlertMetric.RUN_FAILURE_COUNT)).toBe(false);
    expect(alertMetricsForScope(true)).toEqual([
      AlertMetric.LLM_BUDGET_USED,
      AlertMetric.LLM_ERROR_RATE,
      AlertMetric.LLM_RATE_LIMITED,
      AlertMetric.CODE_REPOSITORY_CACHE_FAILING,
      AlertMetric.INTEGRATION_REAUTH_NEEDED,
      AlertMetric.QUEUE_FAILED_JOBS,
      AlertMetric.QUEUE_BACKLOG,
      AlertMetric.AUDIT_BACKLOG,
      AlertMetric.ACCOUNT_LOCKOUTS,
      AlertMetric.NO_AUTOMATED_RESULTS,
    ]);
    expect(alertMetricsForScope(false)).toHaveLength(
      ALERT_METRIC_CATALOGUE.length - 10
    );
    expect(
      getAlertMetricDefinition(AlertMetric.LLM_BUDGET_USED)?.defaults
        .cooldownMinutes
    ).toBe(0);
  });

  it("gives every event metric a trigger and every scheduled metric a cadence", () => {
    for (const entry of ALERT_METRIC_CATALOGUE) {
      if (entry.path === "event") {
        expect(entry.trigger, entry.metric).toBeTruthy();
        expect(entry.schedule, entry.metric).toBeUndefined();
      } else {
        expect(entry.schedule, entry.metric).toBeTruthy();
        expect(entry.trigger, entry.metric).toBeUndefined();
      }
    }
  });

  it("has an en-US metric sentence for the bell and email of every metric", () => {
    const sentences = (
      enUS as unknown as {
        components: {
          notifications: { content: { alertMetric: Record<string, string> } };
        };
      }
    ).components.notifications.content.alertMetric;
    for (const entry of ALERT_METRIC_CATALOGUE) {
      expect(sentences[entry.metric], `${entry.metric} sentence`).toBeTruthy();
    }
  });

  it("answers field usage per metric", () => {
    expect(
      metricUsesField(AlertMetric.RESULT_DURATION_DEVIATION, "direction")
    ).toBe(true);
    expect(
      metricUsesField(AlertMetric.MILESTONE_OVERDUE, "thresholdValue")
    ).toBe(false);
    expect(metricUsesField("NOPE", "thresholdValue")).toBe(false);
    expect(getAlertMetricDefinition("NOPE")).toBeUndefined();
  });
});
