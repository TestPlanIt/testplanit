import { describe, expect, it } from "vitest";
import {
  defaultAlertRuleValues,
  formValuesToRuleData,
  ruleToFormValues,
  alertRuleFormSchema,
  valuesForMetricChange,
} from "./alertRuleForm";

function issuesOf(values: unknown) {
  const result = alertRuleFormSchema.safeParse(values);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
}

describe("alertRuleFormSchema", () => {
  it("accepts the defaults with a name", () => {
    expect(issuesOf({ ...defaultAlertRuleValues(), name: "Slow" })).toEqual([]);
  });

  it("requires a scope target for folder, tag, case and milestone scopes", () => {
    expect(
      issuesOf({
        ...defaultAlertRuleValues(),
        name: "x",
        scopeType: "FOLDER",
      })
    ).toContain("scopeId:scopeRequired");
    expect(
      issuesOf({
        ...defaultAlertRuleValues(),
        name: "x",
        scopeType: "RUN_NAME",
      })
    ).toContain("scopeText:runNameRequired");
    expect(
      issuesOf({
        ...defaultAlertRuleValues(),
        name: "x",
        scopeType: "FOLDER",
        scopeId: "12",
      })
    ).toEqual([]);
  });

  it("checks the threshold against the metric's value kind", () => {
    expect(
      issuesOf({
        ...defaultAlertRuleValues(),
        name: "x",
        thresholdValue: 5000,
      })
    ).toContain("thresholdValue:percentRange");
    expect(
      issuesOf({
        ...defaultAlertRuleValues("CONSECUTIVE_FAILURES"),
        name: "x",
        thresholdValue: 2.5,
      })
    ).toContain("thresholdValue:countRange");
    expect(
      issuesOf({
        ...defaultAlertRuleValues("MILESTONE_OVERDUE"),
        name: "x",
        thresholdValue: 99999999,
      })
    ).toEqual([]);
  });

  it("keeps the minimum sample size inside the baseline window and needs days for MILESTONE_BEHIND", () => {
    expect(
      issuesOf({
        ...defaultAlertRuleValues(),
        name: "x",
        baselineWindow: 5,
        minSamples: 6,
      })
    ).toContain("minSamples:minSamplesWindow");
    expect(
      issuesOf({
        ...defaultAlertRuleValues("MILESTONE_BEHIND"),
        name: "x",
        secondaryValue: undefined,
      })
    ).toContain("secondaryValue:daysRange");
  });
});

describe("form <-> rule conversions", () => {
  it("round-trips a rule through the form", () => {
    const rule = {
      name: "Nightly failures",
      description: "Tell the team",
      metric: "RUN_FAILURE_COUNT" as const,
      scopeType: "RUN_NAME" as const,
      scopeId: null,
      scopeText: "Nightly",
      thresholdValue: 5,
      secondaryValue: null,
      direction: "EITHER" as const,
      baselineType: "MEDIAN" as const,
      baselineWindow: 10,
      minSamples: 5,
      resultSource: "BOTH" as const,
      evaluateOn: "AS_RESULTS_ARRIVE" as const,
      coverageBasis: "LINKED" as const,
      cooldownMinutes: 30,
      emitWebhook: true,
      isEnabled: false,
    };
    const values = ruleToFormValues(rule);
    expect(values.scopeText).toBe("Nightly");
    expect(values.scopeId).toBe("");
    expect(formValuesToRuleData(values)).toEqual(rule);
  });

  it("keeps a webhook scope's config id in scopeText and requires one", () => {
    const base = defaultAlertRuleValues("WEBHOOK_FAILURE_RATE");
    const missing = alertRuleFormSchema.safeParse({
      ...base,
      name: "Hooks",
      scopeType: "WEBHOOK",
    });
    expect(missing.success).toBe(false);
    const data = formValuesToRuleData({
      ...base,
      name: "Hooks",
      scopeType: "WEBHOOK",
      scopeText: "cfg_1",
      scopeId: "9",
    });
    expect(data.scopeText).toBe("cfg_1");
    expect(data.scopeId).toBeNull();
  });

  it("normalises unused fields when writing", () => {
    const data = formValuesToRuleData({
      ...defaultAlertRuleValues("MILESTONE_OVERDUE"),
      name: "  Overdue  ",
      description: "   ",
      scopeType: "MILESTONE",
      scopeId: "77",
      scopeText: "ignored",
      thresholdValue: 42,
      secondaryValue: 3,
    });
    expect(data.name).toBe("Overdue");
    expect(data.description).toBeNull();
    expect(data.scopeId).toBe(77);
    expect(data.scopeText).toBeNull();
    expect(data.thresholdValue).toBe(0);
    expect(data.secondaryValue).toBeNull();
  });

  it("resets numbers on a metric change but keeps name, delivery and a still-valid scope", () => {
    const current = {
      ...defaultAlertRuleValues(),
      name: "Keep me",
      cooldownMinutes: 5,
      emitWebhook: true,
      scopeType: "TAG" as const,
      scopeId: "3",
    };
    const next = valuesForMetricChange(current, "RUN_PASS_RATE_BELOW");
    expect(next.name).toBe("Keep me");
    expect(next.cooldownMinutes).toBe(5);
    expect(next.emitWebhook).toBe(true);
    expect(next.thresholdValue).toBe(90);
    expect(next.scopeType).toBe("TAG");
    expect(next.scopeId).toBe("3");

    const milestone = valuesForMetricChange(current, "MILESTONE_OVERDUE");
    expect(milestone.scopeType).toBe("PROJECT");
    expect(milestone.scopeId).toBe("");
  });
});
