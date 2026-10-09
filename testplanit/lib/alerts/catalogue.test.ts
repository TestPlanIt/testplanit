import { AlertMetric, AlertScopeType } from "~/zenstack/models";
import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import {
  caseEventAlertMetrics,
  getAlertMetricDefinition,
  metricUsesField,
  runEventAlertMetrics,
  scheduledAlertMetrics,
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

  it("splits metrics by evaluation path and subject", () => {
    expect(scheduledAlertMetrics()).toEqual([
      AlertMetric.MILESTONE_BEHIND,
      AlertMetric.MILESTONE_OVERDUE,
    ]);
    expect(caseEventAlertMetrics()).toEqual([
      AlertMetric.RESULT_DURATION_DEVIATION,
      AlertMetric.CASE_REGRESSED,
      AlertMetric.CONSECUTIVE_FAILURES,
      AlertMetric.CASE_FLAKY,
    ]);
    expect(runEventAlertMetrics()).toEqual([
      AlertMetric.RUN_PASS_RATE_BELOW,
      AlertMetric.RUN_FAILURE_COUNT,
    ]);
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
