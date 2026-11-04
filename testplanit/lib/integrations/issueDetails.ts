import type { IssueData } from "./adapters/IssueAdapter";

/**
 * Live details of one tracker issue in a single shape for every provider,
 * as the hover popovers render them. A field a tracker has no notion of is
 * null or empty rather than absent, so the client never branches on the
 * provider to know what it may read.
 */
export interface ExternalIssueDetails {
  key: string;
  url: string | null;
  summary: string;
  description?: string;
  status: {
    name: string;
    color: "green" | "blue" | "yellow" | "gray";
  };
  priority: { name: string; iconUrl?: string } | null;
  assignee: { displayName: string; avatarUrl?: string } | null;
  assignees: Array<{ displayName: string; avatarUrl?: string }>;
  reporter: { displayName: string; avatarUrl?: string } | null;
  issueType: { name: string; iconUrl?: string };
  labels: string[];
  /** Hex colour per label name, when the tracker colours its labels. */
  labelColors?: Record<string, string>;
  milestone: { name: string; state?: string; dueDate?: string } | null;
  commentCount: number | null;
  created?: string;
  updated?: string;
}

/**
 * Jira keeps the colour mapping its popover has always used; the open/closed
 * trackers map their two states.
 */
function statusColor(
  provider: string,
  status: string | undefined
): ExternalIssueDetails["status"]["color"] {
  const name = status?.toLowerCase() ?? "";
  if (provider === "JIRA") {
    if (name === "done") return "green";
    if (name === "in progress") return "blue";
    if (name === "to do" || name === "todo") return "yellow";
    return "gray";
  }
  if (["closed", "done", "resolved", "completed"].includes(name)) {
    return "green";
  }
  if (["open", "reopened", "in progress"].includes(name)) return "blue";
  return "gray";
}

const toPerson = (person: { name: string; avatarUrl?: string }) => ({
  displayName: person.name,
  avatarUrl: person.avatarUrl,
});

export function toExternalIssueDetails(
  issue: IssueData,
  provider: string
): ExternalIssueDetails {
  const assignees = issue.assignees?.length
    ? issue.assignees
    : issue.assignee
      ? [issue.assignee]
      : [];
  return {
    key: issue.key ?? issue.id,
    url: issue.url ?? null,
    summary: issue.title,
    description: issue.description,
    status: {
      name: issue.status,
      color: statusColor(provider, issue.status),
    },
    priority: issue.priority ? { name: issue.priority } : null,
    assignee: issue.assignee ? toPerson(issue.assignee) : null,
    assignees: assignees.map(toPerson),
    reporter: issue.reporter ? toPerson(issue.reporter) : null,
    issueType: issue.issueType
      ? { name: issue.issueType.name, iconUrl: issue.issueType.iconUrl }
      : { name: "Issue" },
    labels: issue.labels ?? [],
    labelColors: issue.labelColors,
    milestone: issue.milestone
      ? {
          name: issue.milestone.name,
          state: issue.milestone.state,
          dueDate: issue.milestone.dueDate,
        }
      : null,
    commentCount: issue.commentCount ?? null,
    created: issue.createdAt?.toISOString(),
    updated: issue.updatedAt?.toISOString(),
  };
}
