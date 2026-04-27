import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface TestRunStateChangedData {
  runId: number;
  runTitle: string;
  from: { stateId: number; stateName: string; isCompleted: boolean };
  to: { stateId: number; stateName: string; isCompleted: boolean };
  isCompletedTransition: boolean;
}

export function formatTestRunStateChangedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunStateChangedData;
  const transitionArrow = `${data.from?.stateName ?? "?"} → ${data.to?.stateName ?? "?"}`;
  const completedSuffix = data.isCompletedTransition ? " (completed)" : "";
  const text = `Test run "${data.runTitle}" state changed: ${transitionArrow}${completedSuffix}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Test run state changed", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Run:*\n${data.runTitle}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        { type: "mrkdwn", text: `*From:*\n${data.from?.stateName ?? "—"}` },
        { type: "mrkdwn", text: `*To:*\n${data.to?.stateName ?? "—"}` },
      ],
    },
  ];

  if (data.isCompletedTransition) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:white_check_mark: This transition marks the run as completed.`,
        },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `eventId: \`${envelope.eventId}\` · ${envelope.eventTimestamp}`,
      },
    ],
  });

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
