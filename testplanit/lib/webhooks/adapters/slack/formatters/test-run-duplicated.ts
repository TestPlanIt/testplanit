import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface TestRunDuplicatedData {
  newRunId: number;
  sourceRunId: number;
  runTitle: string;
  sourceRunTitle?: string;
}

export function formatTestRunDuplicatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunDuplicatedData;
  const sourceTitle = data.sourceRunTitle ?? `#${data.sourceRunId}`;
  const text = `Test run "${data.runTitle}" duplicated from "${sourceTitle}"`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Test run duplicated", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*New run:*\n${data.runTitle}` },
        { type: "mrkdwn", text: `*Source run:*\n${sourceTitle}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        {
          type: "mrkdwn",
          text: `*Actor:*\n${envelope.actorUserId ?? "system"}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `eventId: \`${envelope.eventId}\` · ${envelope.eventTimestamp}`,
        },
      ],
    },
  ];

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
