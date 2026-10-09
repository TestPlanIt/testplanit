"use client";

import { useTranslations } from "next-intl";
import { AlertSubjectType } from "~/zenstack/models";
import { getAlertMetricDefinition } from "~/lib/alerts/catalogue";
import type { AlertRuleLike } from "./alertRuleForm";

type SummaryInput = Pick<
  AlertRuleLike,
  | "metric"
  | "thresholdValue"
  | "secondaryValue"
  | "direction"
  | "baselineType"
  | "baselineWindow"
  | "minSamples"
  | "resultSource"
  | "evaluateOn"
  | "coverageBasis"
>;

/**
 * The rule's condition read as one sentence, from the same numbers the
 * evaluator uses. Shown in the rule list and live in the form.
 */
export function AlertRuleSummary({
  rule,
  className,
}: {
  rule: SummaryInput;
  className?: string;
}) {
  const t = useTranslations("alerts");
  const definition = getAlertMetricDefinition(rule.metric);
  if (!definition) return null;
  const summary = t(
    `metrics.${rule.metric}.summary` as never,
    {
      threshold: rule.thresholdValue,
      direction: rule.direction,
      baseline: rule.baselineType,
      window: rule.baselineWindow,
      minSamples: rule.minSamples,
      evaluateOn: rule.evaluateOn,
      days: rule.secondaryValue ?? 0,
      basis: rule.coverageBasis ?? "LINKED",
    } as never
  );
  const showSource = definition.subjectType === AlertSubjectType.CASE;
  return (
    <span className={className} data-testid="alert-rule-summary">
      {summary}
      {showSource && (
        <>
          {" "}
          <span className="text-muted-foreground">
            {"("}
            {t("sourceSummary", { source: rule.resultSource })}
            {")"}
          </span>
        </>
      )}
    </span>
  );
}
