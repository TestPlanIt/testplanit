import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildBody,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_YELLOW,
  projectNameOf,
  titleAndProject,
  url,
} from "./_shared";

type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

type ReviewDecisionOutcome =
  "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED";

interface ReviewCompletedData {
  reviewRequestId: string;
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  entityName: string;
  entityUrl?: string;
  toStateName?: string | null;
  toStateColor?: string | null;
  decision: ReviewDecisionOutcome;
  deciderName?: string | null;
  requesterName?: string | null;
  decisionComment?: string | null;
}

const NEUTRAL_COLOR = "#64748b";

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

function headerFor(decision: ReviewDecisionOutcome): string {
  if (decision === "APPROVED") return "Review approved";
  if (decision === "CHANGES_REQUESTED") return "Changes requested";
  if (decision === "REJECTED") return "Review rejected";
  return "Review cancelled";
}

function colorFor(decision: ReviewDecisionOutcome): string {
  if (decision === "APPROVED") return COLOR_GREEN;
  if (decision === "REJECTED") return COLOR_RED;
  if (decision === "CHANGES_REQUESTED") return COLOR_YELLOW;
  return NEUTRAL_COLOR;
}

export function formatReviewCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as ReviewCompletedData;
  const href = entityHref(
    data.entityType,
    data.projectId,
    data.entityId,
    data.entityUrl
  );
  const decider = data.deciderName ?? "Someone";
  const requester = data.requesterName ?? "the requester";
  const headerText = headerFor(data.decision);
  const color = colorFor(data.decision);

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: headerText, emoji: false },
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
        text: `Decided by *${decider}* for *${requester}*`,
      },
    },
  ];

  if (data.toStateName) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Target state:* ${data.toStateName}`,
      },
    });
  }

  if (data.decisionComment && data.decisionComment.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: data.decisionComment },
    });
  }

  return buildBody({
    text: `${headerText}: ${data.entityName}`,
    color,
    blocks,
  });
}
