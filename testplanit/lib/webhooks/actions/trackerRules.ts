import type {
  WebhookActionTrigger,
  WebhookActionType,
} from "~/zenstack/models";
import { readWebhookActionFilter } from "./schemas";

export interface TrackerRule {
  id: string;
  trigger: WebhookActionTrigger;
  action: WebhookActionType;
  filter: unknown;
  options: unknown;
}

/** What a filter is checked against: the issue as the tracker now has it. */
export interface IssueFacts {
  status: string | null;
  issueTypeId: string | null;
  labels: string[];
  isRequirement: boolean;
}

/** What happened to the issue in TestPlanIt on this event. */
export interface IssueChange {
  /** TestPlanIt didn't have the issue before this event. */
  created: boolean;
  /** The tracker status differs from the one TestPlanIt last stored. */
  statusChanged: boolean;
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether an issue passes a rule's filter. Each list narrows only when it
 * has values: the status must be one of the statuses, the type one of the
 * types, and at least one label one of the labels.
 */
export function issueMatchesFilter(
  filter: unknown,
  issue: IssueFacts
): boolean {
  const f = readWebhookActionFilter(filter);
  if (f.statuses?.length) {
    if (!issue.status || !f.statuses.some((s) => same(s, issue.status!))) {
      return false;
    }
  }
  if (f.issueTypeIds?.length) {
    if (
      !issue.issueTypeId ||
      !f.issueTypeIds.some((t) => same(t, issue.issueTypeId!))
    ) {
      return false;
    }
  }
  if (f.labels?.length) {
    if (!issue.labels.some((l) => f.labels!.some((x) => same(x, l)))) {
      return false;
    }
  }
  if (f.requirementsOnly && !issue.isRequirement) return false;
  return true;
}

/**
 * Whether a tracker rule fires for this event: any event; an issue new to
 * TestPlanIt; or an issue arriving in one of the rule's statuses, which an
 * issue created directly in that status also does. A status rule without
 * statuses never fires.
 */
export function trackerRuleFires(
  rule: Pick<TrackerRule, "trigger" | "filter">,
  change: IssueChange,
  issue: IssueFacts
): boolean {
  switch (rule.trigger) {
    case "ISSUE_EVENT":
      break;
    case "ISSUE_CREATED":
      if (!change.created) return false;
      break;
    case "ISSUE_STATUS_ENTERED": {
      if (!change.created && !change.statusChanged) return false;
      if (!readWebhookActionFilter(rule.filter).statuses?.length) return false;
      break;
    }
    default:
      return false;
  }
  return issueMatchesFilter(rule.filter, issue);
}

export function statusChanged(
  previous: string | null,
  current: string | null
): boolean {
  return (
    (previous ?? "").trim().toLowerCase() !==
    (current ?? "").trim().toLowerCase()
  );
}
