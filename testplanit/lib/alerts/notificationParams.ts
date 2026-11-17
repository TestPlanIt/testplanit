import { toHumanReadable } from "~/utils/duration";
import { isSystemSubjectType, subjectPath } from "~/lib/alerts/subjectPath";

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
  subjectType?:
    | "CASE"
    | "RUN"
    | "MILESTONE"
    | "SESSION"
    | "PROJECT"
    | "WEBHOOK"
    | "LLM_INTEGRATION"
    | "CODE_REPOSITORY"
    | "INTEGRATION"
    | "QUEUE"
    | "SYSTEM"
    | string;
  subjectId?: number;
  /** String key of a subject without an integer id (webhooks, queues, system). */
  subjectRef?: string | null;
  subjectName?: string;
  observedValue?: number;
  baselineValue?: number | null;
  thresholdValue?: number;
  testRunId?: number | null;
  details?: Record<string, unknown> | null;
}

/**
 * AI providers bill in USD; the code is fixed on purpose (see the matching
 * note in NotificationContent.tsx). The recipient's locale still decides
 * the grouping and decimal separators.
 */
function usd(value: unknown, locale: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(locale.replace("_", "-"), {
      style: "currency",
      currency: "USD",
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
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
    case "CASE_RECOVERED":
      return {
        key: "alertMetric.CASE_RECOVERED",
        params: {
          failedBefore: int(details.failedBefore ?? data.observedValue),
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
    case "RUN_DURATION_DEVIATION":
      return {
        key: "alertMetric.RUN_DURATION_DEVIATION",
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
    case "RUN_NOT_PROGRESSING":
      return {
        key: "alertMetric.RUN_NOT_PROGRESSING",
        params: {
          idleHours: int(details.idleHours ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "AUTOMATED_EXECUTION_FAILED":
      return {
        key: "alertMetric.AUTOMATED_EXECUTION_FAILED",
        params: {
          status: String(details.status ?? "FAILED"),
          target: String(details.targetName ?? ""),
          error: String(details.error ?? ""),
        },
      };
    case "RUN_UNTESTED_SHARE":
      return {
        key: "alertMetric.RUN_UNTESTED_SHARE",
        params: {
          untestedPercent: num(details.untestedPercent ?? data.observedValue),
          daysRemaining: int(details.daysRemaining),
          threshold: num(threshold),
        },
      };
    case "RUN_ISSUES_OPENED":
      return {
        key: "alertMetric.RUN_ISSUES_OPENED",
        params: {
          issues: int(details.issues ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "NEW_FAILURE_SIGNATURES":
      return {
        key: "alertMetric.NEW_FAILURE_SIGNATURES",
        params: {
          signatures: int(details.newSignatures ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "SESSION_OVERRUN":
      return {
        key: "alertMetric.SESSION_OVERRUN",
        params: {
          elapsed: duration(details.elapsed, locale),
          estimate: duration(details.estimate ?? data.baselineValue, locale),
          overrun: num(details.overrunPercent ?? data.observedValue),
          threshold: num(threshold),
        },
      };
    case "REQUIREMENT_COVERAGE_BELOW":
      return {
        key: "alertMetric.REQUIREMENT_COVERAGE_BELOW",
        params: {
          coverage: num(details.coveragePercent ?? data.observedValue),
          covered: int(details.covered),
          total: int(details.total),
          basis: String(details.basis ?? "LINKED"),
          threshold: num(threshold),
        },
      };
    case "STALE_CASES":
      return {
        key: "alertMetric.STALE_CASES",
        params: {
          stale: int(details.stale ?? data.observedValue),
          days: int(details.days),
          threshold: int(threshold),
        },
      };
    case "AUTOMATION_SHARE_BELOW":
      return {
        key: "alertMetric.AUTOMATION_SHARE_BELOW",
        params: {
          automatedPercent: num(details.automatedPercent ?? data.observedValue),
          automated: int(details.automated),
          total: int(details.total),
          threshold: num(threshold),
        },
      };
    case "WEBHOOK_FAILURE_RATE":
      return {
        key: "alertMetric.WEBHOOK_FAILURE_RATE",
        params: {
          failureRate: num(details.failureRate ?? data.observedValue),
          failed: int(details.failed),
          sampleCount: int(details.sampleCount),
          threshold: num(threshold),
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
    case "LLM_BUDGET_USED":
      return {
        key: "alertMetric.LLM_BUDGET_USED",
        params: {
          percent: num(details.percent ?? data.observedValue),
          spend: usd(details.spend, locale),
          budget: usd(details.budget, locale),
          threshold: num(threshold),
        },
      };
    case "LLM_ERROR_RATE":
      return {
        key: "alertMetric.LLM_ERROR_RATE",
        params: {
          failureRate: num(details.failureRate ?? data.observedValue),
          failed: int(details.failed),
          sampleCount: int(details.sampleCount),
          threshold: num(threshold),
        },
      };
    case "LLM_RATE_LIMITED":
      return {
        key: "alertMetric.LLM_RATE_LIMITED",
        params: {
          blocked: int(details.blocked ?? data.observedValue),
          hours: int(details.hours),
          threshold: int(threshold),
        },
      };
    case "CODE_REPOSITORY_CACHE_FAILING":
      return {
        key: "alertMetric.CODE_REPOSITORY_CACHE_FAILING",
        params: {
          hours: int(details.hours ?? data.observedValue),
          error: String(details.error ?? ""),
          threshold: int(threshold),
        },
      };
    case "INTEGRATION_REAUTH_NEEDED":
      return {
        key: "alertMetric.INTEGRATION_REAUTH_NEEDED",
        params: {
          users: int(details.users ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "QUEUE_FAILED_JOBS":
      return {
        key: "alertMetric.QUEUE_FAILED_JOBS",
        params: {
          failed: int(details.failed ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "QUEUE_BACKLOG":
      return {
        key: "alertMetric.QUEUE_BACKLOG",
        params: {
          minutes: int(details.minutes ?? data.observedValue),
          waiting: int(details.waiting),
          threshold: int(threshold),
        },
      };
    case "AUDIT_BACKLOG":
      return {
        key: "alertMetric.AUDIT_BACKLOG",
        params: {
          minutes: int(details.minutes ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "ACCOUNT_LOCKOUTS":
      return {
        key: "alertMetric.ACCOUNT_LOCKOUTS",
        params: {
          locked: int(details.locked ?? data.observedValue),
          threshold: int(threshold),
        },
      };
    case "NO_AUTOMATED_RESULTS":
      return {
        key: "alertMetric.NO_AUTOMATED_RESULTS",
        params: {
          hours: int(details.hours ?? data.observedValue),
          threshold: int(threshold),
        },
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
  if (!data.subjectType) return null;
  // A system alert's subject lives outside any project.
  if (isSystemSubjectType(data.subjectType)) {
    return subjectPath(data.subjectType, null, data.subjectId ?? 0, null, {
      subjectRef: data.subjectRef,
      details: data.details,
    });
  }
  if (!data.projectId) return null;
  // Webhook subjects carry no integer id; their path is the project's
  // Webhooks page, so the id is not needed.
  if (data.subjectType !== "WEBHOOK" && !data.subjectId) return null;
  return subjectPath(
    data.subjectType,
    data.projectId,
    data.subjectId ?? 0,
    data.testRunId ?? null
  );
}
