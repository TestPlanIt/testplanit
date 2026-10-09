import { toHumanReadable } from "~/utils/duration";
import { subjectPath } from "~/lib/alerts/subjectPath";

/**
 * Turns a ALERT_TRIGGERED notification's `data` into the translation key
 * and parameters both renderers (bell and email) format from, so the two
 * never drift. Numbers are pre-formatted here because the ICU strings take
 * plain placeholders; durations use the recipient's locale.
 */

export interface AlertNotificationData {
  eventId?: number;
  ruleId?: number;
  ruleName?: string;
  metric?: string;
  projectId?: number;
  projectName?: string;
  subjectType?: "CASE" | "RUN" | "MILESTONE" | string;
  subjectId?: number;
  subjectName?: string;
  observedValue?: number;
  baselineValue?: number | null;
  thresholdValue?: number;
  testRunId?: number | null;
  details?: Record<string, unknown> | null;
}

export interface AlertMetricMessage {
  /** Key relative to `components.notifications.content`. */
  key: string;
  params: Record<string, string | number>;
}

function num(value: unknown, decimals = 1): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(decimals));
}

function int(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function duration(seconds: unknown, locale: string): string {
  const n = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(n)) return "";
  return toHumanReadable(n, { isSeconds: true, locale, largest: 2 });
}

export function alertMetricMessage(
  data: AlertNotificationData,
  locale: string
): AlertMetricMessage {
  const details = data.details ?? {};
  const threshold = data.thresholdValue ?? 0;
  switch (data.metric) {
    case "RESULT_DURATION_DEVIATION":
      return {
        key: "alertMetric.RESULT_DURATION_DEVIATION",
        params: {
          elapsed: duration(details.elapsed, locale),
          deviation: num(Math.abs(data.observedValue ?? 0)),
          baseline: duration(
            data.baselineValue ?? details.baselineSeconds,
            locale
          ),
          threshold: num(threshold),
        },
      };
    case "CASE_REGRESSED":
      return {
        key: "alertMetric.CASE_REGRESSED",
        params: {
          passedBefore: int(details.passedBefore ?? data.observedValue),
        },
      };
    case "CONSECUTIVE_FAILURES":
      return {
        key: "alertMetric.CONSECUTIVE_FAILURES",
        params: {
          streak: int(details.streak ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "CASE_FLAKY":
      return {
        key: "alertMetric.CASE_FLAKY",
        params: {
          flips: int(details.flips ?? data.observedValue),
          sampleCount: int(details.sampleCount),
          threshold: int(threshold),
        },
      };
    case "RUN_PASS_RATE_BELOW":
      return {
        key: "alertMetric.RUN_PASS_RATE_BELOW",
        params: {
          passRate: num(details.passRate ?? data.observedValue),
          sampleCount: int(details.sampleCount),
          threshold: num(threshold),
        },
      };
    case "RUN_FAILURE_COUNT":
      return {
        key: "alertMetric.RUN_FAILURE_COUNT",
        params: {
          failed: int(details.failed ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "MILESTONE_BEHIND":
      return {
        key: "alertMetric.MILESTONE_BEHIND",
        params: {
          completion: num(details.completionPercent ?? data.observedValue),
          daysRemaining: int(details.daysRemaining),
          threshold: num(threshold),
        },
      };
    case "MILESTONE_OVERDUE":
      return {
        key: "alertMetric.MILESTONE_OVERDUE",
        params: { daysOverdue: int(details.daysOverdue ?? data.observedValue) },
      };
    default:
      return {
        key: "alertTriggeredRule",
        params: { ruleName: data.ruleName ?? "" },
      };
  }
}

/** In-app path (no locale prefix) of the fired subject. */
export function alertSubjectPath(data: AlertNotificationData): string | null {
  if (!data.projectId || !data.subjectType || !data.subjectId) return null;
  return subjectPath(
    data.subjectType,
    data.projectId,
    data.subjectId,
    data.testRunId ?? null
  );
}
