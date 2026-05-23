import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

interface ReviewRequestedData {
  reviewRequestId: string;
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  entityName: string;
  entityUrl?: string;
  fromStateName?: string | null;
  toStateName?: string | null;
  toStateColor?: string | null;
  requesterName?: string | null;
  assigneeUserName?: string | null;
  assigneeRoleName?: string | null;
  commentText?: string | null;
}

function entityLabel(entityType: ReviewableEntityType): string {
  if (entityType === "CASE") return "Test case";
  if (entityType === "RUN") return "Test run";
  return "Session";
}

function entityHref(
  entityType: ReviewableEntityType,
  projectId: number,
  entityId: number,
  fallback?: string
): string {
  if (fallback) return fallback;
  if (entityType === "CASE") return url.case(projectId, entityId);
  if (entityType === "RUN") return url.testRun(projectId, entityId);
  return url.session(projectId, entityId);
}

function describeAssignee(data: ReviewRequestedData): string {
  if (data.assigneeUserName) return data.assigneeUserName;
  if (data.assigneeRoleName) return `${data.assigneeRoleName} (role)`;
  return "(unassigned)";
}

/**
 * Color bar for review-requested: workflow color of the requested target
 * state when present; neutral fallback otherwise so Slack still renders
 * the attachment as an outcome-style card.
 */
const NEUTRAL_COLOR = "#64748b";

export function formatReviewRequestedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as ReviewRequestedData;
  const entityType = data.entityType;
  const href = entityHref(
    entityType,
    data.projectId,
    data.entityId,
    data.entityUrl
  );
  const requester = data.requesterName ?? "Someone";
  const assignee = describeAssignee(data);

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Review requested", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: titleAndProject(data.entityName, projectNameOf(envelope), href),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${entityLabel(entityType)} review requested by *${requester}* from *${assignee}*`,
      },
    },
  ];

  if (data.fromStateName && data.toStateName) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Target state:* ${data.fromStateName} → ${data.toStateName}`,
      },
    });
  } else if (data.toStateName) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Target state:* ${data.toStateName}`,
      },
    });
  }

  if (data.commentText && data.commentText.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: data.commentText },
    });
  }

  return buildBody({
    text: `Review requested: ${data.entityName}`,
    color: data.toStateColor ?? NEUTRAL_COLOR,
    blocks,
  });
}
