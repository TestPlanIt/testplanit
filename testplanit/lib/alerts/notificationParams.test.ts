import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import { alertMetricMessage, alertSubjectPath } from "./notificationParams";

const content = (
  enUS as unknown as {
    components: { notifications: { content: Record<string, unknown> } };
  }
).components.notifications.content;

describe("alertMetricMessage", () => {
  it("formats durations and percentages for the deviation metric", () => {
    const message = alertMetricMessage(
      {
        metric: "RESULT_DURATION_DEVIATION",
        observedValue: -81.8181,
        baselineValue: 11,
        thresholdValue: 50,
        details: { elapsed: 125 },
      },
      "en"
    );
    expect(message.key).toBe("alertMetric.RESULT_DURATION_DEVIATION");
    expect(message.params).toEqual({
      elapsed: "2 minutes, 5 seconds",
      deviation: 81.8,
      baseline: "11 seconds",
      threshold: 50,
    });
  });

  it("maps every metric to a key that exists in en-US", () => {
    const metrics = [
      "RESULT_DURATION_DEVIATION",
      "CASE_REGRESSED",
      "CONSECUTIVE_FAILURES",
      "CASE_FLAKY",
      "RUN_PASS_RATE_BELOW",
      "RUN_FAILURE_COUNT",
      "MILESTONE_BEHIND",
      "MILESTONE_OVERDUE",
      "CASE_RECOVERED",
      "RUN_DURATION_DEVIATION",
      "RUN_NOT_PROGRESSING",
      "AUTOMATED_EXECUTION_FAILED",
      "RUN_UNTESTED_SHARE",
      "RUN_ISSUES_OPENED",
      "SESSION_OVERRUN",
      "REQUIREMENT_COVERAGE_BELOW",
      "STALE_CASES",
      "AUTOMATION_SHARE_BELOW",
      "WEBHOOK_FAILURE_RATE",
    ];
    const keys = content.alertMetric as Record<string, string>;
    for (const metric of metrics) {
      const message = alertMetricMessage(
        { metric, observedValue: 3, thresholdValue: 2, details: {} },
        "en"
      );
      expect(message.key).toBe(`alertMetric.${metric}`);
      expect(keys[metric]).toBeTruthy();
      // Every placeholder in the string is supplied.
      for (const placeholder of keys[metric].matchAll(/\{(\w+)[,}]/g)) {
        expect(message.params, `${metric} ${placeholder[1]}`).toHaveProperty(
          placeholder[1]
        );
      }
    }
  });

  it("falls back to the rule name for an unknown metric", () => {
    expect(
      alertMetricMessage({ metric: "SOMETHING_NEW", ruleName: "R" }, "en")
    ).toEqual({ key: "alertTriggeredRule", params: { ruleName: "R" } });
  });

  it("prefers the detail values over the rolled-up observed value", () => {
    expect(
      alertMetricMessage(
        {
          metric: "RUN_PASS_RATE_BELOW",
          observedValue: 1,
          thresholdValue: 90,
          details: { passRate: 66.666, sampleCount: 12 },
        },
        "en"
      ).params
    ).toEqual({ passRate: 66.7, sampleCount: 12, threshold: 90 });
  });
});

describe("alertSubjectPath", () => {
  it("links a case into the run it fired from, and plainly otherwise", () => {
    expect(
      alertSubjectPath({
        projectId: 3,
        subjectType: "CASE",
        subjectId: 7,
        testRunId: 50,
      })
    ).toBe("/projects/runs/3/50?selectedCase=7");
    expect(
      alertSubjectPath({ projectId: 3, subjectType: "CASE", subjectId: 7 })
    ).toBe("/projects/repository/3/7");
    expect(
      alertSubjectPath({ projectId: 3, subjectType: "RUN", subjectId: 50 })
    ).toBe("/projects/runs/3/50");
    expect(
      alertSubjectPath({
        projectId: 3,
        subjectType: "MILESTONE",
        subjectId: 9,
      })
    ).toBe("/projects/milestones/3/9");
    expect(alertSubjectPath({})).toBeNull();
  });
});

describe("alertSubjectPath", () => {
  it("links a webhook subject to the project's webhooks page without an integer id", () => {
    expect(
      alertSubjectPath({
        projectId: 7,
        subjectType: "WEBHOOK",
        subjectId: 0,
        subjectName: "Slack",
      })
    ).toBe("/projects/settings/7/webhooks");
    expect(
      alertSubjectPath({ projectId: 7, subjectType: "RUN", subjectId: 0 })
    ).toBeNull();
  });
});
